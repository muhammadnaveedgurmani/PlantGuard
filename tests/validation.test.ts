import { describe, it, expect } from 'vitest'
import { validateDiagnosisRaw } from '../src/ml/validation'

function validDiagnosis() {
  return {
    is_leaf: true,
    is_healthy: false,
    plant_name: 'Tomato',
    disease_name: 'Early blight',
    confidence: 82,
    severity: 'Moderate',
    symptoms: ['brown spots'],
    spread: ['wind'],
    treatment: ['fungicide'],
    prevention: ['crop rotation'],
    notes: 'test',
    secondary_possibilities: []
  }
}

describe('validateDiagnosisRaw', () => {
  it('accepts a complete valid diagnosis unchanged', () => {
    const r = validateDiagnosisRaw(validDiagnosis())
    expect(r.status).toBe('ok')
    expect(r.value?.plant_name).toBe('Tomato')
    expect(r.value?.disease_name).toBe('Early blight')
    expect(r.value?.confidence).toBe(82)
    expect(r.value?.confidence_level).toBe('high')
    expect(r.issues).toHaveLength(0)
  })

  it('fails on non-object input', () => {
    for (const bad of [null, undefined, 'oops', 42]) {
      const r = validateDiagnosisRaw(bad)
      expect(r.status).toBe('failed')
      expect(r.value).toBeNull()
    }
  })

  it('fails instead of inventing a missing plant name for a leaf', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), plant_name: '  ' })
    expect(r.status).toBe('failed')
    expect(r.value).toBeNull()
    expect(r.issues.some((i) => i.field === 'plant_name')).toBe(true)
  })

  it('fails instead of inventing a missing disease name for a diseased plant', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), disease_name: '' })
    expect(r.status).toBe('failed')
    expect(r.value).toBeNull()
  })

  it('defaults disease name to Healthy for a healthy plant', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), is_healthy: true, disease_name: '' })
    expect(r.status).not.toBe('failed')
    expect(r.value?.disease_name).toBe('Healthy')
  })

  it('clamps out-of-range confidence instead of failing', () => {
    const high = validateDiagnosisRaw({ ...validDiagnosis(), confidence: 140 })
    expect(high.value?.confidence).toBe(100)
    expect(high.status).toBe('recovered')
    const low = validateDiagnosisRaw({ ...validDiagnosis(), confidence: -5 })
    expect(low.value?.confidence).toBe(0)
    expect(low.status).toBe('recovered')
  })

  it('defaults missing confidence to 50', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), confidence: undefined })
    expect(r.value?.confidence).toBe(50)
    expect(r.status).toBe('recovered')
  })

  it('defaults an invalid severity value', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), severity: 'Extreme' })
    expect(r.value?.severity).toBe('Moderate')
    expect(r.status).toBe('recovered')
  })

  it('defaults non-string arrays to empty lists', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), symptoms: 'spots', treatment: [1, 2] })
    expect(r.value?.symptoms).toEqual([])
    expect(r.value?.treatment).toEqual([])
    expect(r.status).toBe('recovered')
  })

  it('flags plant/disease mismatch as a warning, not a block', () => {
    const r = validateDiagnosisRaw({ ...validDiagnosis(), plant_name: 'Tomato', disease_name: 'Apple scab' })
    expect(r.status).not.toBe('failed')
    expect(r.value).not.toBeNull()
    expect(r.issues.some((i) => i.field === 'plant_disease_consistency')).toBe(true)
  })

  it('caps secondary possibilities at 3 and clamps their confidence', () => {
    const r = validateDiagnosisRaw({
      ...validDiagnosis(),
      secondary_possibilities: [
        { disease_name: 'A', confidence: 10 },
        { disease_name: 'B', confidence: 200 },
        { disease_name: 'C', confidence: 5 },
        { disease_name: 'D', confidence: 1 }
      ]
    })
    expect(r.value?.secondary_possibilities).toHaveLength(3)
    expect(r.value?.secondary_possibilities[1].confidence).toBe(100)
  })

  it('buckets confidence levels correctly', () => {
    expect(validateDiagnosisRaw({ ...validDiagnosis(), confidence: 80 }).value?.confidence_level).toBe('high')
    expect(validateDiagnosisRaw({ ...validDiagnosis(), confidence: 60 }).value?.confidence_level).toBe('medium')
    expect(validateDiagnosisRaw({ ...validDiagnosis(), confidence: 20 }).value?.confidence_level).toBe('low')
  })
})
