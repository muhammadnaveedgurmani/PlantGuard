import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runEvaluation } from '../lib/evalHarness'

const admin = new Hono<{ Bindings: Bindings }>()

// C2 fix (2026-10-03): every admin route except /health requires the admin
// secret as a Bearer token. The comparison is constant-time to avoid timing
// side-channels. If no secret is configured, all protected routes fail closed.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

admin.use(async (c, next) => {
  // /health stays public for uptime monitors: it performs no AI calls and
  // exposes no usage or cost data.
  if (c.req.path === '/api/admin/health') return next()

  const secret = c.env.ADMIN_SECRET
  if (!secret) {
    return c.json({ error: 'Admin access is not configured.' }, 503)
  }
  const auth = c.req.header('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !constantTimeEqual(token, secret)) {
    return c.json({ error: 'Unauthorized.' }, 401)
  }
  return next()
})

// GET /api/admin/health -- Phase 32: health & monitoring.
// Deliberately does a cheap D1 ping so "healthy" actually reflects DB
// reachability, not just that the Worker booted. Never throws -- degraded
// dependencies are reported in the body, not as a 500.
admin.get('/health', async (c) => {
  const checks: Record<string, string> = {}
  let overall = 'ok'

  try {
    await c.env.DB.prepare('SELECT 1').first()
    checks.database = 'ok'
  } catch (e: any) {
    checks.database = 'error'
    overall = 'degraded'
  }

  try {
    // R2 binding presence check only (a real .list() call would cost a request)
    checks.storage = c.env.IMAGES ? 'ok' : 'not_configured'
  } catch {
    checks.storage = 'error'
    overall = 'degraded'
  }

  checks.ai_config = c.env.OPENAI_API_KEY && c.env.OPENAI_BASE_URL ? 'ok' : 'not_configured'
  if (checks.ai_config !== 'ok') overall = 'degraded'

  return c.json({ status: overall, checks, timestamp: new Date().toISOString() })
})

// GET /api/admin/observability-summary -- Phase 2/32: quick rollup of AI
// call logs for internal visibility (latency, success rate, cost, fallback
// usage) without needing a separate BI tool.
admin.get('/observability-summary', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         request_type,
         model,
         COUNT(*) as total_calls,
         SUM(success) as successful_calls,
         ROUND(AVG(latency_ms), 1) as avg_latency_ms,
         SUM(fallback_used) as fallback_calls,
         SUM(tool_calls_used) as tool_calls,
         ROUND(SUM(COALESCE(estimated_cost_usd, 0)), 6) as total_estimated_cost_usd
       FROM ai_call_logs
       GROUP BY request_type, model
       ORDER BY request_type`
    ).all()
    return c.json({ summary: results })
  } catch (e: any) {
    return c.json({ error: 'Failed to load observability summary', detail: e?.message || String(e) }, 500)
  }
})

// POST /api/admin/eval/run -- Phase 13: trigger the evaluation harness.
admin.post('/eval/run', async (c) => {
  try {
    const summary = await runEvaluation(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, c.env.DB)
    return c.json(summary)
  } catch (e: any) {
    return c.json({ error: `Evaluation run failed: ${e?.message || e}` }, 500)
  }
})

// GET /api/admin/eval/history -- past evaluation runs
admin.get('/eval/history', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, run_at, prompt_version, model, total_cases, passed, failed, pass_rate FROM eval_runs ORDER BY run_at DESC LIMIT 20`
  ).all()
  return c.json({ runs: results })
})

export default admin
