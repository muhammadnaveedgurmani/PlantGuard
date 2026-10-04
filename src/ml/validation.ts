// PHASE 6: AI Reliability Guardrails.
//
// Cheap, deterministic validation applied to AI JSON output AFTER it comes
// back, before it is ever shown to a user or saved as a trusted record.
// Intentionally does NOT make another AI call -- it only checks shape,
// ranges, and a few known plant<->disease consistency rules.
//
// Recovery philosophy: fix what's safely fixable (clamp a confidence value,
// default a missing array to []), but never invent missing required content
// (e.g. a disease name) -- those failures are surfaced as a controlled error
// instead of being silently papered over.

export type ValidationIssue = { field: string; problem: string; recovered: boolean }

export type ValidationOutcome<T> = {
  status: 'ok' | 'recovered' | 'failed'
  value: T | null
  issues: ValidationIssue[]
}

const VALID_SEVERITIES = ['None', 'Low', 'Moderate', 'High', 'Critical']

// A small, deliberately limited set of well-known plant/disease pairings used
// only as a sanity check (not a source of truth) -- if the AI says a disease
// name that's clearly for a different plant family, we flag it, we don't
// silently trust it.
const KNOWN_DISEASE_PLANT_HINTS: Record<string, string[]> = {
  'early blight': ['tomato', 'potato'],
  'late blight': ['tomato', 'potato'],
  'apple scab': ['apple'],
  'cedar apple rust': ['apple'],
  'black rot': ['apple', 'grape'],
  'powdery mildew': ['cherry', 'squash', 'grape'],
  'common rust': ['corn', 'maize'],
  'northern leaf blight': ['corn', 'maize'],
  'bacterial spot': ['peach', 'bell pepper', 'pepper', 'tomato'],
  'leaf mold': ['tomato'],
  'septoria leaf spot': ['tomato'],
  'yellow leaf curl virus': ['tomato'],
  'mosaic virus': ['tomato']
}

export function validateDiagnosisRaw(parsed: any): ValidationOutcome<{
  is_leaf: boolean
  is_healthy: boolean
  plant_name: string
  disease_name: string
  confidence: number
  confidence_level: 'high' | 'medium' | 'low'
  severity: string
  symptoms: string[]
  spread: string[]
  treatment: string[]
  prevention: string[]
  notes: string
  secondary_possibilities: { disease_name: string; confidence: number }[]
}> {
  const issues: ValidationIssue[] = []
  let recovered = false

  if (parsed == null || typeof parsed !== 'object') {
    return { status: 'failed', value: null, issues: [{ field: 'root', problem: 'AI response was not a JSON object', recovered: false }] }
  }

  const is_leaf = typeof parsed.is_leaf === 'boolean' ? parsed.is_leaf : true
  if (typeof parsed.is_leaf !== 'boolean') {
    issues.push({ field: 'is_leaf', problem: 'missing/invalid, defaulted to true', recovered: true })
    recovered = true
  }

  const is_healthy = typeof parsed.is_healthy === 'boolean' ? parsed.is_healthy : false
  if (typeof parsed.is_healthy !== 'boolean') {
    issues.push({ field: 'is_healthy', problem: 'missing/invalid, defaulted to false', recovered: true })
    recovered = true
  }

  // plant_name: required for a leaf result -- if truly missing/empty, this is
  // a hard failure rather than a silent invention (Phase 6 requirement).
  let plant_name = typeof parsed.plant_name === 'string' ? parsed.plant_name.trim() : ''
  if (is_leaf && !plant_name) {
    return {
      status: 'failed',
      value: null,
      issues: [...issues, { field: 'plant_name', problem: 'empty/missing plant name for a leaf image', recovered: false }]
    }
  }
  if (!plant_name) plant_name = 'Unknown'

  let disease_name = typeof parsed.disease_name === 'string' ? parsed.disease_name.trim() : ''
  if (is_leaf && !is_healthy && !disease_name) {
    return {
      status: 'failed',
      value: null,
      issues: [...issues, { field: 'disease_name', problem: 'empty/missing disease name for a diseased plant', recovered: false }]
    }
  }
  if (!disease_name) disease_name = is_healthy ? 'Healthy' : 'Unknown'

  let confidence = typeof parsed.confidence === 'number' && isFinite(parsed.confidence) ? parsed.confidence : NaN
  if (isNaN(confidence)) {
    issues.push({ field: 'confidence', problem: 'missing/invalid, defaulted to 50', recovered: true })
    confidence = 50
    recovered = true
  } else if (confidence < 0 || confidence > 100) {
    issues.push({ field: 'confidence', problem: `out of range (${confidence}), clamped to 0-100`, recovered: true })
    confidence = Math.max(0, Math.min(100, confidence))
    recovered = true
  }

  let severity = typeof parsed.severity === 'string' ? parsed.severity : ''
  if (!VALID_SEVERITIES.includes(severity)) {
    issues.push({ field: 'severity', problem: `invalid value "${severity}", defaulted`, recovered: true })
    severity = is_healthy ? 'None' : 'Moderate'
    recovered = true
  }

  const asStringArray = (v: any, field: string): string[] => {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v
    if (v !== undefined) {
      issues.push({ field, problem: 'not a string array, defaulted to []', recovered: true })
      recovered = true
    }
    return []
  }

  const symptoms = asStringArray(parsed.symptoms, 'symptoms')
  const spread = asStringArray(parsed.spread, 'spread')
  const treatment = asStringArray(parsed.treatment, 'treatment')
  const prevention = asStringArray(parsed.prevention, 'prevention')
  const notes = typeof parsed.notes === 'string' ? parsed.notes : ''

  // Confidence level bucket (Phase 4: AI-estimated, not calibrated probability)
  const confidence_level: 'high' | 'medium' | 'low' = confidence >= 75 ? 'high' : confidence >= 45 ? 'medium' : 'low'

  // secondary_possibilities (Phase 4: ambiguous / multiple possible diseases)
  let secondary_possibilities: { disease_name: string; confidence: number }[] = []
  if (Array.isArray(parsed.secondary_possibilities)) {
    secondary_possibilities = parsed.secondary_possibilities
      .filter((s: any) => s && typeof s.disease_name === 'string')
      .map((s: any) => ({
        disease_name: s.disease_name,
        confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(100, s.confidence)) : 0
      }))
      .slice(0, 3)
  }

  // Plant/disease consistency sanity check (best-effort, non-fatal warning only)
  const diseaseLower = disease_name.toLowerCase()
  const plantLower = plant_name.toLowerCase()
  for (const [key, plants] of Object.entries(KNOWN_DISEASE_PLANT_HINTS)) {
    if (diseaseLower.includes(key)) {
      const matches = plants.some((p) => plantLower.includes(p))
      if (!matches) {
        issues.push({
          field: 'plant_disease_consistency',
          problem: `"${disease_name}" is not commonly associated with "${plant_name}" -- flagged for review, not blocked`,
          recovered: false
        })
      }
      break
    }
  }

  return {
    status: recovered ? 'recovered' : 'ok',
    value: {
      is_leaf,
      is_healthy,
      plant_name,
      disease_name,
      confidence,
      confidence_level,
      severity,
      symptoms,
      spread,
      treatment,
      prevention,
      notes,
      secondary_possibilities
    },
    issues
  }
}
