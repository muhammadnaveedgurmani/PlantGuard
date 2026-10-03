// App-wide constants. Single source of truth for values that were
// previously hard-coded in individual modules (Phase 2 restructure).

/** Name of the anonymous session cookie (see src/utils/session.ts). */
export const SESSION_COOKIE_NAME = 'pg_session'

/** Default AI models, overridable per-deployment via AI_MODEL / AI_FALLBACK_MODEL. */
export const DEFAULT_AI_MODEL = 'gpt-5'
export const DEFAULT_AI_FALLBACK_MODEL = 'gpt-5-mini'
