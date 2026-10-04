// PHASE 13: AI Evaluation Harness.
//
// A small, repeatable evaluation framework for the diagnosis vision model.
// Each case is a real leaf photo with a KNOWN plant and (where applicable)
// a known disease category the model should broadly identify. For every
// run we score:
//   - Structured output validity (via the same validateDiagnosisRaw guardrail
//     used in production -- Phase 6)
//   - Required fields present
//   - Confidence within 0-100
//   - Correctness vs ground truth where ground truth exists (plant name
//     match is objective; disease match is a keyword/category match since
//     exact wording varies -- we don't pretend to have perfect ground truth
//     for subjective diagnosis wording)
//   - Overall failure rate
//
// This is intentionally NOT trying to claim clinical accuracy -- it exists
// to demonstrate that AI output quality is measured on a fixed dataset
// across prompt/model versions, not assumed.

import { diagnoseLeafImage, DIAGNOSIS_PROMPT_VERSION } from './ai'
import { validateDiagnosisRaw } from './validation'

export type EvalCase = {
  id: string
  image_url: string
  expected_plant_keywords: string[] // any one match counts as a plant match
  expected_healthy: boolean | null // null = not asserted
  expected_disease_keywords: string[] // any one match counts as a disease category match; [] if not asserted
  description: string
}

// Small, fixed, publicly-hosted reference photos with well-documented
// ground truth (university extension / plant pathology references).
export const EVAL_DATASET: EvalCase[] = [
  {
    id: 'tomato-early-blight-1',
    image_url:
      'https://sspark.genspark.ai/cfimages?u1=whiTsqWRzfvzvoo85uN5%2FZfBG%2BhxDK1XibPV980XQEkKP%2BYiB7pnSsy3n9WryPVFFasyFxdAVpf2w%2Bx9ywvo%2FDECF5X9YRo%3D&u2=2YA0KH%2FC7NyPvFKi&width=2560',
    expected_plant_keywords: ['tomato'],
    expected_healthy: false,
    expected_disease_keywords: ['early blight', 'blight', 'alternaria'],
    description: 'NC State Extension reference photo of tomato early blight leaf spots'
  },
  {
    id: 'apple-scab-1',
    image_url:
      'https://sspark.genspark.ai/cfimages?u1=NdCgAE40tN%2BXQ3ymhl5zY19bE5KKJPKCikB%2BODJwk77JQZ46FimIO7Cmf1IrZJXY1V7Av3ha371RDBl1TffZIZRebjCl%2FUwnbeTJaJQqz7EzgjePuSEM%2BYR7ig5VabOfwHL0sJMUpaAfBPCADgD%2FDOwFDJ3I7%2F7B&u2=wJIwq%2BTnEGE3n7OZ&width=2560',
    expected_plant_keywords: ['apple'],
    expected_healthy: false,
    expected_disease_keywords: ['scab', 'venturia'],
    description: 'Ohioline (OSU) reference photo of apple scab on leaves'
  },
  {
    id: 'healthy-tomato-1',
    image_url:
      'https://sspark.genspark.ai/cfimages?u1=U%2FesH0mIV9ibkrUHzKldyaIvz5XGnyeJWv3rk%2BF7YU0L4XMc298OG5rt3eupizaIVuj7vvD6%2BNzsFky%2BHLbfIBLUFAKM0tCKeFdzYN4sEaVv750%2FONfZmsaGxNNY2Y7ptmLJuqp8a6Q4uz4tdeRmHQUX1VYPUMnKMfEVVU4L8B55pokS02gt%2BT%2B4Xt39Ht7718cmtFHvNeQq%2BH5nhDAnbVOJDBNkAQBz5t2uFgRi2ZG0353puI%2Fldehbrh1bg5ngm%2BtS%2FlNLXM%2BsS6jw2eEHgyzag%2F3FONTAJVyItajkZM6ydByLkhn4MBkm4Vx8l5Qdj74L%2FBn%2BMBcmc6c%3D&u2=PMfMUAZvbsyOvx47&width=2560',
    expected_plant_keywords: ['tomato'],
    expected_healthy: true,
    expected_disease_keywords: [],
    description: 'PxHere CC0 photo of a healthy green tomato plant/leaves'
  }
]

export type EvalCaseResult = {
  case_id: string
  passed: boolean
  structured_valid: boolean
  validation_status: string
  plant_match: boolean | null
  healthy_match: boolean | null
  disease_category_match: boolean | null
  confidence: number | null
  latency_ms: number
  error: string | null
}

export type EvalRunSummary = {
  total_cases: number
  passed: number
  failed: number
  pass_rate: number
  model: string
  prompt_version: string
  results: EvalCaseResult[]
}

function keywordMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const lower = text.toLowerCase()
  return keywords.some((k) => lower.includes(k.toLowerCase()))
}

export async function runEvaluation(
  apiKey: string,
  baseUrl: string,
  db: D1Database
): Promise<EvalRunSummary> {
  const results: EvalCaseResult[] = []
  let modelUsed = 'unknown'

  for (const testCase of EVAL_DATASET) {
    const startedAt = Date.now()
    try {
      const outcome = await diagnoseLeafImage(apiKey, baseUrl, testCase.image_url, db, `eval-${testCase.id}`)
      modelUsed = outcome.modelUsed
      const validation = validateDiagnosisRaw(outcome.raw)
      const latency_ms = Date.now() - startedAt

      if (validation.status === 'failed' || !validation.value) {
        results.push({
          case_id: testCase.id,
          passed: false,
          structured_valid: false,
          validation_status: validation.status,
          plant_match: null,
          healthy_match: null,
          disease_category_match: null,
          confidence: null,
          latency_ms,
          error: 'Structured output validation failed'
        })
        continue
      }

      const v = validation.value
      const plantMatch = keywordMatch(v.plant_name, testCase.expected_plant_keywords)
      const healthyMatch = testCase.expected_healthy === null ? null : v.is_healthy === testCase.expected_healthy
      const diseaseMatch =
        testCase.expected_disease_keywords.length === 0
          ? null
          : keywordMatch(v.disease_name, testCase.expected_disease_keywords)

      const confidenceValid = v.confidence >= 0 && v.confidence <= 100
      const passed =
        confidenceValid &&
        plantMatch &&
        (healthyMatch === null || healthyMatch) &&
        (diseaseMatch === null || diseaseMatch)

      results.push({
        case_id: testCase.id,
        passed,
        structured_valid: true,
        validation_status: validation.status,
        plant_match: plantMatch,
        healthy_match: healthyMatch,
        disease_category_match: diseaseMatch,
        confidence: v.confidence,
        latency_ms,
        error: null
      })
    } catch (e: any) {
      results.push({
        case_id: testCase.id,
        passed: false,
        structured_valid: false,
        validation_status: 'error',
        plant_match: null,
        healthy_match: null,
        disease_category_match: null,
        confidence: null,
        latency_ms: Date.now() - startedAt,
        error: e?.message || String(e)
      })
    }
  }

  const passed = results.filter((r) => r.passed).length
  const total = results.length
  const summary: EvalRunSummary = {
    total_cases: total,
    passed,
    failed: total - passed,
    pass_rate: total > 0 ? Math.round((passed / total) * 1000) / 10 : 0,
    model: modelUsed,
    prompt_version: DIAGNOSIS_PROMPT_VERSION,
    results
  }

  try {
    await db
      .prepare(
        `INSERT INTO eval_runs (prompt_version, model, total_cases, passed, failed, pass_rate, metrics_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(summary.prompt_version, summary.model, summary.total_cases, summary.passed, summary.failed, summary.pass_rate, JSON.stringify(results))
      .run()
  } catch (e) {
    console.error('[eval-harness] failed to persist eval run:', e)
  }

  return summary
}
