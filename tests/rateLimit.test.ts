import { describe, it, expect } from 'vitest'
import {
  checkRateLimit,
  rateLimitResponseBody,
  type RateLimitConfig
} from '../src/utils/rateLimit'

const cfg: RateLimitConfig = { bucket: 'test', limit: 3, windowMs: 60 * 60 * 1000 }

describe('checkRateLimit', () => {
  it('allows requests up to the limit, then denies', () => {
    const sid = `s-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit(sid, '9.9.9.9', cfg)
      expect(r.allowed).toBe(true)
      expect(r.remaining).toBe(3 - i - 1)
    }
    const denied = checkRateLimit(sid, '9.9.9.9', cfg)
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
  })

  it('keeps separate quotas per session on the same IP', () => {
    const ip = `8.8.8.${Math.floor(Math.random() * 250) + 1}`
    const a = checkRateLimit(`a-${Math.random()}`, ip, cfg)
    const b = checkRateLimit(`b-${Math.random()}`, ip, cfg)
    expect(a.allowed).toBe(true)
    expect(b.allowed).toBe(true)
    expect(a.remaining).toBe(2)
    expect(b.remaining).toBe(2)
  })

  it('does not let cookie deletion reset the quota (IP abuse backstop)', () => {
    const ip = `7.7.7.${Math.floor(Math.random() * 250) + 1}`
    const small: RateLimitConfig = { bucket: `backstop-${Math.random()}`, limit: 2, windowMs: 60 * 60 * 1000 }
    // Session quota is 2, IP backstop is 2*10 = 20. Burn through 10 fresh
    // sessions (as if the cookie was deleted each time): the 11th must fail.
    for (let s = 0; s < 10; s++) {
      const sid = `fresh-${Math.random()}`
      expect(checkRateLimit(sid, ip, small).allowed).toBe(true)
      expect(checkRateLimit(sid, ip, small).allowed).toBe(true)
    }
    const freshSid = `fresh-${Math.random()}`
    expect(checkRateLimit(freshSid, ip, small).allowed).toBe(false)
  })

  it('a denied request does not consume extra quota (probe before consume)', () => {
    const sid = `s-${Math.random()}`
    const ip = `6.6.6.${Math.floor(Math.random() * 250) + 1}`
    for (let i = 0; i < 3; i++) checkRateLimit(sid, ip, cfg)
    const d1 = checkRateLimit(sid, ip, cfg)
    const d2 = checkRateLimit(sid, ip, cfg)
    expect(d1.allowed).toBe(false)
    expect(d2.allowed).toBe(false)
    expect(d1.resetAtMs).toBe(d2.resetAtMs)
  })

  it('builds a friendly 429 body', () => {
    const body = rateLimitResponseBody(
      { allowed: false, remaining: 0, limit: 3, resetAtMs: Date.now() + 90_000 },
      'diagnosis'
    )
    expect(body.rate_limited).toBe(true)
    expect(body.limit).toBe(3)
    expect(body.error).toContain('diagnosis')
    expect(body.reset_in_seconds).toBeGreaterThan(0)
  })
})
