// Real weather data via Open-Meteo (free, no API key required) +
// ip-api.com for IP-based geolocation. Replaces the old fake
// np.random-based forecast from the Streamlit prototype.

export type GeoLocation = {
  latitude: number
  longitude: number
  city: string
  country: string
}

export async function detectLocationFromIp(ip: string | null): Promise<GeoLocation> {
  const fallback: GeoLocation = {
    latitude: 31.5204,
    longitude: 74.3587,
    city: 'Lahore',
    country: 'Pakistan'
  }
  try {
    const url = ip && ip !== '127.0.0.1' ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json/'
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return fallback
    const data = await res.json<any>()
    if (data.status !== 'success') return fallback
    return {
      latitude: data.lat ?? fallback.latitude,
      longitude: data.lon ?? fallback.longitude,
      city: data.city || fallback.city,
      country: data.country || fallback.country
    }
  } catch {
    return fallback
  }
}

export async function geocodeCity(cityName: string): Promise<GeoLocation | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json<any>()
    const r = data?.results?.[0]
    if (!r) return null
    return { latitude: r.latitude, longitude: r.longitude, city: r.name, country: r.country }
  } catch {
    return null
  }
}

const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Dense Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  80: 'Rain Showers',
  81: 'Rain Showers',
  82: 'Violent Rain Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with Hail',
  99: 'Thunderstorm with Hail'
}

function describeCode(code: number): string {
  return WEATHER_CODE_MAP[code] || 'Unknown'
}

export type WeatherForecast = {
  city: string
  country: string
  current: {
    temp: number
    feels_like: number
    condition: string
    humidity: string
    wind: string
    precipitation: string
  }
  daily: Array<{
    date: string
    temp_max: number
    temp_min: number
    condition: string
    humidity: string
    wind: string
    precipitation_chance: string
  }>
}

export async function getRealWeatherForecast(loc: GeoLocation): Promise<WeatherForecast | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max,relative_humidity_2m_mean` +
      `&timezone=auto&forecast_days=7`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json<any>()

    const cur = data.current
    const daily = data.daily

    const dailyList = daily.time.map((dateStr: string, i: number) => {
      const d = new Date(dateStr)
      const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })
      return {
        date: dateLabel,
        temp_max: Math.round(daily.temperature_2m_max[i]),
        temp_min: Math.round(daily.temperature_2m_min[i]),
        condition: describeCode(daily.weather_code[i]),
        humidity: `${Math.round(daily.relative_humidity_2m_mean?.[i] ?? 0)}%`,
        wind: `${Math.round(daily.wind_speed_10m_max[i])} km/h`,
        precipitation_chance: `${Math.round(daily.precipitation_probability_max?.[i] ?? 0)}%`
      }
    })

    return {
      city: loc.city,
      country: loc.country,
      current: {
        temp: Math.round(cur.temperature_2m),
        feels_like: Math.round(cur.apparent_temperature),
        condition: describeCode(cur.weather_code),
        humidity: `${Math.round(cur.relative_humidity_2m)}%`,
        wind: `${Math.round(cur.wind_speed_10m)} km/h`,
        precipitation: `${cur.precipitation ?? 0} mm`
      },
      daily: dailyList
    }
  } catch {
    return null
  }
}
