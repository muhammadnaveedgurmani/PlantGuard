import type { MiddlewareHandler } from 'hono'
import type { Bindings } from '../types'

// C2 fix (2026-10-03): every admin route except /health requires the admin
// secret as a Bearer token. The comparison is constant-time to avoid timing
// side-channels. If no secret is configured, all protected routes fail closed.
//
// Extracted to src/middleware/adminAuth.ts during the Phase 2 restructure so
// the auth logic lives in one place instead of inside the admin route file.
// Behavior is unchanged.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export const requireAdminAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
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
}
