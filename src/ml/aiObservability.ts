// AI Observability: lightweight, best-effort logging of every AI (LLM) API
// call made by the app. Used later for AI evaluation, feedback correlation,
// and cost/latency analytics. Deliberately never stores user content (no
// image data, no chat/diagnosis text) -- only call metadata.
//
// IMPORTANT: logging must never break a real AI request. Every write here is
// wrapped so a D1/logging failure is swallowed (and reported to console for
// local `wrangler dev` visibility) instead of surfacing to the caller.

export type AiRequestType = 'diagnosis' | 'chat' | 'library_cultivation' | 'library_disease'

export type AiLogParams = {
  db: D1Database
  requestType: AiRequestType
  model: string
  promptVersion?: string
  sessionId?: string | null
  success: boolean
  errorType?: string
  errorMessage?: string
  latencyMs: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  fallbackUsed?: boolean
  fallbackModel?: string
  toolCallsUsed?: boolean
}

// Best-effort, approximate per-1K-token cost rates (USD). These are
// placeholder estimates for RELATIVE cost tracking/trending only -- they are
// NOT accurate billing figures for the underlying model/proxy. Update these
// constants if/when real pricing information becomes available.
const COST_PER_1K_PROMPT_TOKENS_USD = 0.00125
const COST_PER_1K_COMPLETION_TOKENS_USD = 0.01

function estimateCostUsd(promptTokens?: number, completionTokens?: number): number | null {
  if (typeof promptTokens !== 'number' && typeof completionTokens !== 'number') return null
  const p = promptTokens ?? 0
  const c = completionTokens ?? 0
  const cost = (p / 1000) * COST_PER_1K_PROMPT_TOKENS_USD + (c / 1000) * COST_PER_1K_COMPLETION_TOKENS_USD
  // Round to 6 decimal places -- these are tiny fractions of a cent per call.
  return Math.round(cost * 1e6) / 1e6
}

export async function logAiCall(params: AiLogParams): Promise<void> {
  try {
    const cost = estimateCostUsd(params.promptTokens, params.completionTokens)
    await params.db
      .prepare(
        `INSERT INTO ai_call_logs
          (request_type, model, prompt_version, session_id, success, error_type, error_message,
           latency_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
           fallback_used, fallback_model, tool_calls_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.requestType,
        params.model,
        params.promptVersion ?? null,
        params.sessionId ?? null,
        params.success ? 1 : 0,
        params.errorType ?? null,
        params.errorMessage ? params.errorMessage.slice(0, 300) : null,
        params.latencyMs,
        params.promptTokens ?? null,
        params.completionTokens ?? null,
        params.totalTokens ?? null,
        cost,
        params.fallbackUsed ? 1 : 0,
        params.fallbackModel ?? null,
        params.toolCallsUsed ? 1 : 0
      )
      .run()
  } catch (e: any) {
    // Never let an observability failure break a successful/failed AI request.
    console.error('[ai-observability] failed to log AI call:', e?.message || e)
  }
}
