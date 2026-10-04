// PHASE 9: Weather x Diagnosis Risk Engine.
//
// Deterministic, explainable rule-based logic connecting real weather data
// with disease/plant characteristics. Deliberately NOT an LLM call -- every
// alert here must be traceable to a specific rule (condition -> reason ->
// recommendation), and the code must be able to say "insufficient
// information" rather than fabricate a claim.
//
// This is intentionally a small, honest ruleset. It does not claim
// scientific/agronomic authority; each result carries the explanation so a
// user (or agronomist) can judge it, not just the alert.

import type { WeatherForecast } from './weatherService'

export type RiskLevel = 'low' | 'moderate' | 'high'

export type RiskAlert = {
  level: RiskLevel
  title: string
  reason: string
  recommendation: string
  weather_factor: string
}

export type RiskAssessment = {
  alerts: RiskAlert[]
  has_meaningful_alert: boolean
  insufficient_info: boolean
}

// Diseases/pests broadly favored by warm, humid, or wet conditions (fungal &
// bacterial pathogens that thrive on leaf moisture). This is a simplified,
// non-exhaustive classification used only to decide WHICH rule applies.
const FUNGAL_KEYWORDS = [
  'blight', 'mildew', 'rust', 'rot', 'mold', 'scab', 'spot', 'esca', 'anthracnose'
]
const DRY_TREATMENT_KEYWORDS = ['spray', 'fungicide', 'apply', 'dust']

function isFungalOrBacterialLike(diseaseName: string): boolean {
  const d = diseaseName.toLowerCase()
  return FUNGAL_KEYWORDS.some((k) => d.includes(k))
}

function parsePercent(v: string | undefined): number | null {
  if (!v) return null
  const m = v.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function parseTemp(v: number | undefined): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null
}

/**
 * Core deterministic rule set. Given a weather forecast (current + first
 * upcoming day) and optional diagnosis context (plant/disease), returns
 * explainable alerts. All thresholds are simple, commonly-cited heuristics
 * (high humidity >=70%, heat stress >=38C, heavy rain probability >=60%) --
 * intentionally conservative and clearly labeled as guidance, not verified
 * agronomic fact.
 */
export function assessWeatherDiseaseRisk(
  weather: WeatherForecast | null,
  diagnosis?: { plant_name?: string; disease_name?: string; is_healthy?: boolean } | null
): RiskAssessment {
  if (!weather) {
    return { alerts: [], has_meaningful_alert: false, insufficient_info: true }
  }

  const alerts: RiskAlert[] = []
  const humidity = parsePercent(weather.current?.humidity)
  const rainProb = weather.daily?.[0] ? parsePercent(weather.daily[0].precipitation_chance) : null
  const tempMax = weather.daily?.[0] ? weather.daily[0].temp_max : parseTemp(weather.current?.temp)
  const hasDiseaseContext = !!diagnosis && diagnosis.disease_name && !diagnosis.is_healthy

  // Rule 1: High humidity + fungal/bacterial-type disease already diagnosed
  if (hasDiseaseContext && humidity !== null && humidity >= 70 && isFungalOrBacterialLike(diagnosis!.disease_name!)) {
    alerts.push({
      level: humidity >= 85 ? 'high' : 'moderate',
      title: `Elevated risk: ${diagnosis!.disease_name} may spread faster`,
      reason: `Current humidity is ${humidity}%. Many fungal and bacterial leaf diseases (including diseases like "${diagnosis!.disease_name}") spread more readily when humidity stays above 70%.`,
      recommendation: 'Improve air circulation around plants, avoid overhead watering, and monitor nearby healthy plants closely for new symptoms.',
      weather_factor: `Humidity ${humidity}%`
    })
  }

  // Rule 2: Rain forecast + a treatment that typically requires dry conditions
  if (hasDiseaseContext && rainProb !== null && rainProb >= 60) {
    alerts.push({
      level: rainProb >= 80 ? 'high' : 'moderate',
      title: 'Rain expected -- spray/treatment timing matters',
      reason: `There is a ${rainProb}% chance of rain. Sprayed treatments (fungicides, foliar sprays) are often washed off by rain before they can work.`,
      recommendation: 'If your treatment plan involves spraying, consider waiting for a drier window, or reapply after rain per the product label.',
      weather_factor: `Rain probability ${rainProb}%`
    })
  }

  // Rule 3: Extreme heat -- general heat-stress alert (independent of a
  // specific disease, since heat stress affects most crops)
  if (tempMax !== null && tempMax >= 38) {
    alerts.push({
      level: tempMax >= 42 ? 'high' : 'moderate',
      title: 'Heat stress risk for sensitive crops',
      reason: `Forecast high of ${Math.round(tempMax)}°C. Sustained heat above ~38°C can stress many crops (wilting, flower/fruit drop, sunscald), independent of any disease.`,
      recommendation: 'Water in early morning or evening, provide shade if practical for sensitive plants, and avoid midday fertilizer/pesticide application.',
      weather_factor: `Forecast high ${Math.round(tempMax)}°C`
    })
  }

  // Rule 4: Excess moisture (high humidity, no specific disease diagnosed yet)
  // -- general preventive note, only shown if nothing more specific applies.
  if (!hasDiseaseContext && humidity !== null && humidity >= 85) {
    alerts.push({
      level: 'moderate',
      title: 'High humidity -- general fungal disease risk',
      reason: `Current humidity is ${humidity}%. Prolonged high humidity is one of the most common conditions that allow fungal leaf diseases to start and spread.`,
      recommendation: 'Inspect plants regularly for early spotting/discoloration, and avoid wetting leaves when watering.',
      weather_factor: `Humidity ${humidity}%`
    })
  }

  return {
    alerts,
    has_meaningful_alert: alerts.length > 0,
    insufficient_info: false
  }
}
