import type { MiddlewareHandler } from 'hono'
import type { Bindings } from '../types'
import { configureAiModels } from '../ml/ai'

// Per-request middleware: allow the AI model to be overridden per-deployment
// via the AI_MODEL / AI_FALLBACK_MODEL vars (defaults live in src/config.ts).
// Also documents that local dev (`npm run dev` with Vite) picks up keys from
// process.env, while production gets them from Cloudflare secrets (c.env).
//
// Extracted to src/middleware/aiModelConfig.ts during the Phase 2
// restructure; previously inline in the app entry. Behavior is unchanged.
export const applyAiModelConfig: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  configureAiModels(c.env.AI_MODEL, c.env.AI_FALLBACK_MODEL)
  await next()
}
