import { Hono } from 'hono'
import type { Bindings } from '../types'
import { detectLocationFromIp, geocodeCity, getRealWeatherForecast } from '../services/weatherService'
import { assessWeatherDiseaseRisk } from '../services/riskService'
import { getOrCreateSessionId } from '../utils/session'

const weather = new Hono<{ Bindings: Bindings }>()

// GET /api/weather/detect -- IP-based location detection
weather.get('/detect', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || null
  const loc = await detectLocationFromIp(ip)
  return c.json(loc)
})

// GET /api/weather/forecast?city=Lahore  OR  ?lat=..&lon=..&city=..&country=..
// &diagnosis_id=123 (optional -- Phase 9: connect diagnosis + weather risk)
weather.get('/forecast', async (c) => {
  const city = c.req.query('city')
  const lat = c.req.query('lat')
  const lon = c.req.query('lon')
  const country = c.req.query('country') || ''
  const diagnosisId = c.req.query('diagnosis_id')

  let loc
  if (lat && lon) {
    loc = { latitude: parseFloat(lat), longitude: parseFloat(lon), city: city || 'Unknown', country }
  } else if (city) {
    loc = await geocodeCity(city)
    if (!loc) return c.json({ error: `Could not find location "${city}".` }, 404)
  } else {
    return c.json({ error: 'Provide either city, or lat+lon.' }, 400)
  }

  const forecast = await getRealWeatherForecast(loc)
  if (!forecast) return c.json({ error: 'Weather service unavailable. Please try again.' }, 502)

  // PHASE 9: deterministic weather x diagnosis risk engine.
  let diagnosisContext: { plant_name?: string; disease_name?: string; is_healthy?: boolean } | null = null
  if (diagnosisId) {
    const sessionId = getOrCreateSessionId(c)
    const row = await c.env.DB.prepare(`SELECT plant_name, disease_name, is_healthy FROM diagnoses WHERE id = ? AND session_id = ?`)
      .bind(diagnosisId, sessionId)
      .first()
    if (row) diagnosisContext = row as any
  }

  const risk = assessWeatherDiseaseRisk(forecast, diagnosisContext)

  return c.json({ ...forecast, risk })
})

// GET /api/weather/risk-summary -- lightweight risk-only check for dashboard
// widget, using the user's most recent diagnosis (if any) + detected location.
weather.get('/risk-summary', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const ip = c.req.header('CF-Connecting-IP') || null
  const loc = await detectLocationFromIp(ip)
  const forecast = await getRealWeatherForecast(loc)

  const recentDiagnosis = await c.env.DB.prepare(
    `SELECT plant_name, disease_name, is_healthy FROM diagnoses WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
  )
    .bind(sessionId)
    .first()

  const risk = assessWeatherDiseaseRisk(forecast, (recentDiagnosis as any) || null)

  return c.json({
    city: forecast?.city ?? loc.city,
    country: forecast?.country ?? loc.country,
    risk
  })
})

export default weather
