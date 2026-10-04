// Cloudflare bindings available to every Hono route in this app.
export type Bindings = {
  DB: D1Database
  /** R2 is optional — image storage is best-effort when unbound. */
  IMAGES?: R2Bucket
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  /** Phase 1 security: Bearer-token secret guarding /api/admin/* (except /health). */
  ADMIN_SECRET?: string
  AI_MODEL?: string
  AI_FALLBACK_MODEL?: string
}
