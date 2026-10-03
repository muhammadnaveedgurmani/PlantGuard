import { describe, it, expect } from 'vitest'
import { assessWeatherDiseaseRisk } from '../src/services/riskService'
import type { WeatherForecast } from '../src/services/weatherService'

function forecast(over: Partial<WeatherForecast['current']> = {}, dailyOver: Partial<WeatherForecast['daily'][0]> = {}): WeatherForecast {
  return {
    city: 'Lahore',
    country: 'PK',
    current: {
      temp: 30,
      feels_like: 32,
      condition: 'Sunny',
      humidity: '55%',
      wind: '10 km/h',
      precipitation: '0 mm',
      ...over
    },
    daily: [
      {
        date: '2026-10-03',
        temp_max: 32,
        temp_min: 24,
        condition: 'Sunny',
        humidity: '50%',
        wind: '10 km/h',
        precipitation_chance: '10%',
        ...dailyOver
      }
    ]
  }
}

describe('assessWeatherDiseaseRisk', () => {
  it('reports insufficient info when there is no weather data', () => {
    const r = assessWeatherDiseaseRisk(null)
    expect(r.insufficient_info).toBe(true)
    expect(r.alerts).toHaveLength(0)
  })

  it('stays quiet on benign weather with no disease context', () => {
    const r = assessWeatherDiseaseRisk(forecast())
    expect(r.alerts).toHaveLength(0)
  })

  it('raises a heat-stress alert on extreme forecast highs', () => {
    const r = assessWeatherDiseaseRisk(forecast({}, { temp_max: 43 }))
    const heat = r.alerts.find((a) => a.title.includes('Heat stress'))
    expect(heat).toBeDefined()
    expect(heat?.level).toBe('high')
  })

  it('raises a spread alert for a fungal-like disease in high humidity', () => {
    const r = assessWeatherDiseaseRisk(
      forecast({ humidity: '80%' }),
      { plant_name: 'Tomato', disease_name: 'Early blight', is_healthy: false }
    )
    const spread = r.alerts.find((a) => a.title.includes('may spread faster'))
    expect(spread).toBeDefined()
    expect(spread?.level).toBe('moderate')
  })

  it('warns about spray timing when heavy rain is forecast', () => {
    const r = assessWeatherDiseaseRisk(
      forecast({}, { precipitation_chance: '85%' }),
      { plant_name: 'Apple', disease_name: 'Apple scab', is_healthy: false }
    )
    expect(r.alerts.some((a) => a.title.includes('Rain expected'))).toBe(true)
  })

  it('does not raise disease-spread alerts for a healthy plant', () => {
    const r = assessWeatherDiseaseRisk(
      forecast({ humidity: '90%' }),
      { plant_name: 'Tomato', disease_name: 'Healthy', is_healthy: true }
    )
    expect(r.alerts.some((a) => a.title.includes('may spread faster'))).toBe(false)
  })
})
