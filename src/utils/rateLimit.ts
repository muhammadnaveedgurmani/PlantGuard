// PHASE 1: Session-based rate limiting for AI-cost-incurring endpoints.
//
// Design: in-memory sliding-window counters. Each request is checked against
// a per-session bucket (`${clientIp}:${sessionId}:${bucket}`) AND a per-IP
// abuse-backstop bucket (`${clientIp}:${bucket}`, 10x the session limit), so
// deleting the `pg_session` cookie no longer resets the quota (2026-10-03
// hardening). This is per-Worker-isolate (not globally distributed across all
// tradeoff for a lightweight Cloudflare Pages app -- it still meaningfully
// throttles a single abusive session/browser without needing a separate KV/D1
// write on every single request (which would add latency + cost to every
// legitimate AI call).
// If stronger global guarantees are ever needed, swap the Map for a
// Cloudflare KV-backed counter using the same interface.

import type { Context } from 'hono'

type Bucket = {
  count: number
  windowStartMs: number
}

const buckets = new Map<string, Bucket>()

// Periodically prevent unbounded memory growth in long-lived isolates.
let lastSweep = Date.now()
function sweepIfNeeded(windowMs: number) {
  const now = Date.now()
  if (now - lastSweep < 5 * 60 * 1000) return // sweep at most every 5 min
  lastSweep = now
  for (const [key, b] of buckets) {
    if (now - b.windowStartMs > windowMs) buckets.delete(key)
  }
}

export type RateLimitConfig = {
  /** Logical name of the limited resource, e.g. 'diagnosis', 'chat', 'library'. */
  bucket: string
  /** Max requests allowed per window. */
  limit: number
  /** Window size in milliseconds. */
  windowMs: number
}

// Configurable per-endpoint limits (Phase 1 requirement: "keep limits
// configurable"). Numbers chosen to comfortably support a real user working
// through the app while making sustained AI-cost abuse impractical.
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  diagnosis: { bucket: 'diagnosis', limit: 15, windowMs: 60 * 60 * 1000 }, // 15/hour
  chat: { bucket: 'chat', limit: 40, windowMs: 60 * 60 * 1000 }, // 40/hour
  library: { bucket: 'library', limit: 30, windowMs: 60 * 60 * 1000 } // 30/hour (AI-generated lookups only; cache hits aren't limited)
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  limit: number
  resetAtMs: number
}

/**
 * Best-effort client IP for rate-limit keying. Prefers Cloudflare's
 * CF-Connecting-IP, then the first entry of X-Forwarded-For. Never throws.
 */
export function getClientIp(c: Context): string {
  const cfIp = c.req.header('CF-Connecting-IP')
  if (cfIp) return cfIp.trim()
  const xff = c.req.header('X-Forwarded-For')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return 'unknown'
}

/**
 * Single shared rate-limit check/consume function used by every AI route,
 * so limiting logic is defined once (Phase 1: "do not duplicate rate-limit
 * logic unnecessarily").
 *
 * The quota is enforced on two keys:
 *   1. `${clientIp}:${sessionId}:${bucket}` — per-browser quota (UX-friendly).
 *   2. `${clientIp}:${bucket}` — per-IP abuse backstop, so clearing cookies
 *      alone does not grant a fresh quota (2026-10-03 hardening).
 * A request is allowed only if BOTH buckets allow it; both are consumed.
 * The IP bucket uses a multiple of the per-session limit so legitimate
 * shared-IP users (households, offices, mobile CGNAT) are not affected
 * while cookie-deleting abuse is capped.
 */
const IP_BUCKET_MULTIPLIER = 10

/** Non-consuming quota check, so denied requests don't burn quota. */
function peekBucket(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const b = buckets.get(key)
  if (!b || now - b.windowStartMs >= windowMs) {
    return { allowed: true, remaining: limit, limit, resetAtMs: now + windowMs }
  }
  const resetAtMs = b.windowStartMs + windowMs
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, limit, resetAtMs }
  }
  return { allowed: true, remaining: limit - b.count, limit, resetAtMs }
}

function consumeBucket(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  let b = buckets.get(key)

  if (!b || now - b.windowStartMs >= windowMs) {
    b = { count: 0, windowStartMs: now }
    buckets.set(key, b)
  }

  const resetAtMs = b.windowStartMs + windowMs

  if (b.count >= limit) {
    return { allowed: false, remaining: 0, limit, resetAtMs }
  }

  b.count += 1
  return { allowed: true, remaining: limit - b.count, limit, resetAtMs }
}

export function checkRateLimit(sessionId: string, clientIp: string, config: RateLimitConfig): RateLimitResult {
  sweepIfNeeded(config.windowMs)
  const now = Date.now()

  const sessionKey = `${clientIp}:${sessionId}:${config.bucket}`
  const ipKey = `${clientIp}:${config.bucket}:ip`
  const ipLimit = config.limit * IP_BUCKET_MULTIPLIER

  // Probe both buckets BEFORE consuming, so a denied request does not burn
  // quota on the other bucket.
  const sessionProbe = peekBucket(sessionKey, config.limit, config.windowMs, now)
  if (!sessionProbe.allowed) return sessionProbe
  const ipProbe = peekBucket(ipKey, ipLimit, config.windowMs, now)
  if (!ipProbe.allowed) return ipProbe

  const sessionRes = consumeBucket(sessionKey, config.limit, config.windowMs, now)
  const ipRes = consumeBucket(ipKey, ipLimit, config.windowMs, now)

  // Report the tighter of the two remaining quotas.
  return sessionRes.remaining <= ipRes.remaining ? sessionRes : ipRes
}

/** Builds a friendly, actionable 429 JSON body + headers for a rate-limited request. */
export function rateLimitResponseBody(result: RateLimitResult, resourceLabel: string) {
  const secondsLeft = Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000))
  const minutesLeft = Math.ceil(secondsLeft / 60)
  return {
    error: `You've reached the ${resourceLabel} limit (${result.limit} per hour) for this session. Please try again in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
    rate_limited: true,
    limit: result.limit,
    reset_in_seconds: secondsLeft
  }
}
