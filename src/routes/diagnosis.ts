import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getOrCreateSessionId } from '../utils/session'
import { checkImageQuality, retakePhotoAdvice } from '../ml/imageQuality'
import { validateDiagnosisRaw } from '../ml/validation'
import { CNN_CLASSES, cnnLabelToDiagnosisRaw, CNN_THRESHOLD_DEFAULT } from '../ml/cnnLabels'
import { checkRateLimit, getClientIp, rateLimitResponseBody, RATE_LIMITS } from '../utils/rateLimit'

const diagnosis = new Hono<{ Bindings: Bindings }>()

// Server-controlled CNN config. Threshold stays tunable without a frontend redeploy.
const CNN_MODEL_VERSION = 'v1'
const CNN_MODEL_URL = `/static/models/plantguard-cnn/${CNN_MODEL_VERSION}/model.json`
const CNN_LABELS_URL = `/static/models/plantguard-cnn/${CNN_MODEL_VERSION}/labels.json`

// GET /api/diagnosis/cnn-config -- no auth needed.
// Tells the browser where the on-device model lives and which confidence
// threshold qualifies a CNN result (below it the server asks for a clearer
// photo instead of guessing).
diagnosis.get('/cnn-config', async (c) => {
  return c.json({
    enabled: true,
    modelUrl: CNN_MODEL_URL,
    labelsUrl: CNN_LABELS_URL,
    threshold: CNN_THRESHOLD_DEFAULT,
    version: CNN_MODEL_VERSION,
    numClasses: CNN_CLASSES.length
  })
})

// POST /api/diagnosis/analyze
// Accepts multipart/form-data with field "image".
// Pipeline: rate-limit -> image quality pre-check -> on-device CNN result
// (sent by the browser) -> deterministic guardrail validation -> R2 image
// store -> D1 save -> response. The CNN is the only diagnosis engine: no
// cloud model is ever consulted.
diagnosis.post('/analyze', async (c) => {
  const sessionId = getOrCreateSessionId(c)

  // PHASE 1: rate limiting -- protect against AI cost abuse per session.
  // Keyed on client IP + session cookie (2026-10-03): clearing cookies alone
  // no longer resets the quota.
  const rl = checkRateLimit(sessionId, getClientIp(c), RATE_LIMITS.diagnosis)
  if (!rl.allowed) {
    return c.json(rateLimitResponseBody(rl, 'diagnosis'), 429)
  }

  const body = await c.req.parseBody()
  const file = body['image']

  if (!(file instanceof File)) {
    return c.json({ error: 'No image uploaded. Please attach a leaf photo.' }, 400)
  }

  const MAX_BYTES = 8 * 1024 * 1024 // 8MB
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'Image too large. Please upload a photo under 8MB.' }, 400)
  }
  if (!file.type.startsWith('image/')) {
    return c.json({ error: 'File must be an image (png/jpg/jpeg).' }, 400)
  }

  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  // PHASE 5: Image quality pre-check BEFORE spending an AI call.
  const quality = checkImageQuality(bytes, file.type, file.size)
  if (!quality.ok) {
    const blocking = quality.issues.filter((i) => i.severity === 'block')
    return c.json(
      {
        is_leaf: null,
        image_rejected: true,
        problems: blocking.map((i) => i.message),
        how_to_retake: retakePhotoAdvice()
      },
      400
    )
  }
  const qualityWarnings = quality.issues.filter((i) => i.severity === 'warn').map((i) => i.message)

  // On-device CNN prediction from the browser (see cnnClient.js).
  // The CNN is the project's only diagnosis engine: no cloud vision model
  // is consulted. A missing or below-threshold prediction is answered with
  // a low-confidence response asking for a clearer photo -- never a guess.
  const cnnPrediction = typeof body['cnn_prediction'] === 'string' ? body['cnn_prediction'].trim() : ''
  const cnnConfidenceRaw = body['cnn_confidence']
  const cnnConfidence =
    typeof cnnConfidenceRaw === 'string' && cnnConfidenceRaw !== ''
      ? Number(cnnConfidenceRaw)
      : typeof cnnConfidenceRaw === 'number'
        ? cnnConfidenceRaw
        : NaN
  const cnnEligible =
    cnnPrediction !== '' &&
    Number.isFinite(cnnConfidence) &&
    cnnConfidence >= CNN_THRESHOLD_DEFAULT &&
    CNN_CLASSES.includes(cnnPrediction)

  let engine: 'cnn' = 'cnn'
  let cnnRaw: ReturnType<typeof cnnLabelToDiagnosisRaw> = null
  // ONLY ENGINE: on-device PlantGuard CNN (MobileNetV2, 38 classes, 76.8% test).
  // The project has moved fully to the owner's CNN: when the browser's
  // prediction is missing or below the server-controlled confidence
  // threshold, the request is answered low-confidence with a retake prompt.
  if (cnnEligible) {
    cnnRaw = cnnLabelToDiagnosisRaw(cnnPrediction, cnnConfidence)
  } else {
    return c.json(
      {
        low_confidence: true,
        engine: 'cnn',
        confidence: Number.isFinite(cnnConfidence) ? Math.round(cnnConfidence * 1000) / 1000 : null,
        message:
          'The on-device model was not confident enough about this photo. Please upload a clearer, closer photo of a single leaf in good light and try again.'
      },
      200
    )
  }

  // PHASE 6: deterministic guardrail validation of the structured output.
  // For the CNN path the "raw" object is built deterministically from the
  // predicted label, so validation only clamps/defaults safe fields.
  const validation = validateDiagnosisRaw(cnnRaw)
  if (validation.status === 'failed' || !validation.value) {
    return c.json(
      {
        error:
          'The AI returned a result we could not reliably validate (missing required fields). Please try again, ideally with a clearer photo.',
        validation_issues: validation.issues.map((i) => i.problem)
      },
      502
    )
  }
  const result = validation.value

  if (!result.is_leaf) {
    return c.json({
      is_leaf: false,
      message: 'This image does not appear to contain a plant leaf. Please upload a clear leaf photo.'
    })
  }

  // Store image in R2 (best-effort; diagnosis still returns if this fails)
  let imageKey: string | null = null
  try {
    if (!c.env.IMAGES) throw new Error('R2 not bound')
    imageKey = `diagnoses/${sessionId}/${Date.now()}-${crypto.randomUUID()}.${file.type.split('/')[1] || 'jpg'}`
    await c.env.IMAGES.put(imageKey, arrayBuffer, { httpMetadata: { contentType: file.type } })
  } catch {
    imageKey = null
  }

  let insertedId: number | null = null
  try {
    const insertRes = await c.env.DB.prepare(
      `INSERT INTO diagnoses
        (session_id, image_key, plant_name, disease_name, is_healthy, confidence, severity, symptoms, spread, treatment, prevention, raw_ai_response,
         confidence_level, secondary_possibilities, image_quality_warnings, validation_status, prompt_version, engine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        sessionId,
        imageKey,
        result.plant_name,
        result.disease_name,
        result.is_healthy ? 1 : 0,
        result.confidence,
        result.severity,
        JSON.stringify(result.symptoms),
        JSON.stringify(result.spread),
        JSON.stringify(result.treatment),
        JSON.stringify(result.prevention),
        JSON.stringify({ engine: 'cnn', cnn_prediction: cnnPrediction, cnn_confidence: cnnConfidence }),
        result.confidence_level,
        JSON.stringify(result.secondary_possibilities),
        JSON.stringify(qualityWarnings),
        validation.status,
        `plantguard-cnn-${CNN_MODEL_VERSION}`,
        engine
      )
      .run()
    insertedId = (insertRes.meta as any)?.last_row_id ?? null
  } catch (e) {
    // Non-fatal: still return the diagnosis even if history save fails
  }

  return c.json({
    ...result,
    id: insertedId,
    image_key: imageKey,
    image_quality_warnings: qualityWarnings,
    engine,
    model_used: `plantguard-cnn-${CNN_MODEL_VERSION}`,
    fallback_used: false
  })
})

// GET /api/diagnosis/history -- search/filter/pagination (Phase 15)
diagnosis.get('/history', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const dateFilter = c.req.query('date') // YYYY-MM-DD optional
  const plantFilter = c.req.query('plant')
  const diseaseFilter = c.req.query('disease')
  const searchQ = c.req.query('q')
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('page_size') || '10', 10) || 10))

  const conditions: string[] = ['session_id = ?']
  const params: any[] = [sessionId]

  if (dateFilter) {
    conditions.push('date(created_at) = ?')
    params.push(dateFilter)
  }
  if (plantFilter) {
    conditions.push('plant_name LIKE ?')
    params.push(`%${plantFilter}%`)
  }
  if (diseaseFilter) {
    conditions.push('disease_name LIKE ?')
    params.push(`%${diseaseFilter}%`)
  }
  if (searchQ) {
    conditions.push('(plant_name LIKE ? OR disease_name LIKE ?)')
    params.push(`%${searchQ}%`, `%${searchQ}%`)
  }

  const whereClause = conditions.join(' AND ')

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM diagnoses WHERE ${whereClause}`)
    .bind(...params)
    .first()
  const totalMatching = (countRow as any)?.cnt ?? 0

  const offset = (page - 1) * pageSize
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM diagnoses WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all()

  const parsed = results.map((r: any) => ({
    ...r,
    symptoms: safeParse(r.symptoms),
    spread: safeParse(r.spread),
    treatment: safeParse(r.treatment),
    prevention: safeParse(r.prevention),
    secondary_possibilities: safeParse(r.secondary_possibilities),
    image_quality_warnings: safeParse(r.image_quality_warnings)
  }))

  // Stats computed over the user's FULL history (not just this page/filtered view)
  const { results: allForStats } = await c.env.DB.prepare(
    `SELECT confidence, created_at FROM diagnoses WHERE session_id = ?`
  )
    .bind(sessionId)
    .all()
  const total = allForStats.length
  const avgConfidence =
    total > 0 ? (allForStats as any[]).reduce((sum, r) => sum + (r.confidence || 0), 0) / total : 0
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayCount = (allForStats as any[]).filter((r) => (r.created_at || '').slice(0, 10) === todayStr).length

  return c.json({
    records: parsed,
    page,
    page_size: pageSize,
    total_matching: totalMatching,
    total_pages: Math.max(1, Math.ceil(totalMatching / pageSize)),
    stats: { total, avg_confidence: Math.round(avgConfidence * 10) / 10, today_count: todayCount }
  })
})

// GET /api/diagnosis/history/:id -- single record (used by report/chat context)
diagnosis.get('/history/:id', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`SELECT * FROM diagnoses WHERE id = ? AND session_id = ?`)
    .bind(id, sessionId)
    .first()
  if (!row) return c.json({ error: 'Record not found.' }, 404)
  const r = row as any
  return c.json({
    ...r,
    symptoms: safeParse(r.symptoms),
    spread: safeParse(r.spread),
    treatment: safeParse(r.treatment),
    prevention: safeParse(r.prevention),
    secondary_possibilities: safeParse(r.secondary_possibilities),
    image_quality_warnings: safeParse(r.image_quality_warnings)
  })
})

// DELETE /api/diagnosis/history/:id
diagnosis.delete('/history/:id', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM diagnoses WHERE id = ? AND session_id = ?`).bind(id, sessionId).run()
  return c.json({ success: true })
})

// GET /api/diagnosis/image/:key -- serves the stored leaf image from R2.
// 2026-10-03 (H3 fix): the image is only served to the session that created
// the diagnosis, exactly like every other diagnosis endpoint (scoped by
// session_id). Returns 404 for non-owners so key existence is not leaked.
diagnosis.get('/image/*', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const key = c.req.path.replace('/api/diagnosis/image/', '')
  const owns = await c.env.DB.prepare(
    `SELECT id FROM diagnoses WHERE image_key = ? AND session_id = ?`
  )
    .bind(key, sessionId)
    .first()
  if (!owns) return c.json({ error: 'Image not found.' }, 404)
  if (!c.env.IMAGES) return c.notFound()
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.notFound()
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg' }
  })
})

// POST /api/diagnosis/:id/feedback  { feedback: 'helpful' | 'not_helpful' }  (Phase 3)
diagnosis.post('/:id/feedback', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')
  const { feedback } = await c.req.json<{ feedback: string }>()
  if (feedback !== 'helpful' && feedback !== 'not_helpful') {
    return c.json({ error: 'feedback must be "helpful" or "not_helpful"' }, 400)
  }

  const owns = await c.env.DB.prepare(`SELECT id FROM diagnoses WHERE id = ? AND session_id = ?`)
    .bind(id, sessionId)
    .first()
  if (!owns) return c.json({ error: 'Diagnosis not found.' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO ai_feedback (request_type, target_type, target_id, session_id, feedback)
     VALUES ('diagnosis', 'diagnosis', ?, ?, ?)
     ON CONFLICT(target_type, target_id, session_id) DO UPDATE SET feedback = excluded.feedback, created_at = CURRENT_TIMESTAMP`
  )
    .bind(id, sessionId, feedback)
    .run()

  return c.json({ success: true })
})

function safeParse(v: any) {
  try {
    return JSON.parse(v)
  } catch {
    return []
  }
}

export default diagnosis
