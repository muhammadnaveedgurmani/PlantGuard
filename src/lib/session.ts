import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

const SESSION_COOKIE = 'pg_session'

// Generates/retrieves an anonymous per-browser session id. No login is
// required for PlantGuard; this id just scopes diagnosis history, chat
// history, and "who liked what" so multiple visitors don't collide.
export function getOrCreateSessionId(c: Context): string {
  let sid = getCookie(c, SESSION_COOKIE)
  if (!sid) {
    sid = crypto.randomUUID()
    // 2026-10-03: only mark the cookie Secure on HTTPS. Hardcoding
    // secure:true broke sessions entirely on plain-HTTP deployments
    // (browsers refuse to store Secure cookies over HTTP), which also
    // silently disabled rate limiting there.
    const isHttps = new URL(c.req.url).protocol === 'https:'
    setCookie(c, SESSION_COOKIE, sid, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps,
      path: '/',
      maxAge: 60 * 60 * 24 * 365 // 1 year
    })
  }
  return sid
}
