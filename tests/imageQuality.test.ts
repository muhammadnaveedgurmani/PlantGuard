import { describe, it, expect } from 'vitest'
import {
  parseImageDimensions,
  checkImageQuality,
  retakePhotoAdvice
} from '../src/ml/imageQuality'

/** Minimal PNG: 8-byte signature + length + 'IHDR' + width + height (24 bytes). */
function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0x00, 0x00, 0x00, 0x0d], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  b[16] = (width >>> 24) & 0xff
  b[17] = (width >>> 16) & 0xff
  b[18] = (width >>> 8) & 0xff
  b[19] = width & 0xff
  b[20] = (height >>> 24) & 0xff
  b[21] = (height >>> 16) & 0xff
  b[22] = (height >>> 8) & 0xff
  b[23] = height & 0xff
  return b
}

/** Minimal JPEG: SOI + SOF0 segment with the given dimensions (13 bytes). */
function jpegBytes(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0a, // segment length = 10
    0x08, // precision
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01 // components
  ])
}

describe('parseImageDimensions', () => {
  it('parses PNG dimensions from the IHDR chunk', () => {
    expect(parseImageDimensions(pngBytes(800, 600), 'image/png')).toEqual({ width: 800, height: 600 })
  })

  it('parses JPEG dimensions from the SOF0 marker', () => {
    expect(parseImageDimensions(jpegBytes(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 })
  })

  it('returns null for garbage bytes', () => {
    expect(parseImageDimensions(new Uint8Array([1, 2, 3, 4]), 'image/png')).toBeNull()
  })

  it('does not fall back when the mime type claims png (returns null)', () => {
    // NOTE: parseImageDimensions tries ONLY the png parser when the mime
    // includes 'png' -- the both-parsers fallback runs solely when the mime
    // matches neither. Spotted during test-writing; left as-is (behavior
    // preservation), flagged in the Phase 2 report.
    expect(parseImageDimensions(jpegBytes(320, 240), 'image/png')).toBeNull()
  })
})

describe('checkImageQuality', () => {
  it('passes a healthy photo', () => {
    const r = checkImageQuality(pngBytes(800, 600), 'image/png', 50_000)
    expect(r.ok).toBe(true)
    expect(r.issues).toHaveLength(0)
    expect(r.width).toBe(800)
    expect(r.height).toBe(600)
  })

  it('blocks suspiciously tiny files', () => {
    const r = checkImageQuality(pngBytes(800, 600), 'image/png', 500)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'file_too_small' && i.severity === 'block')).toBe(true)
  })

  it('blocks very low resolution photos', () => {
    const r = checkImageQuality(pngBytes(100, 100), 'image/png', 50_000)
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'resolution_too_low')).toBe(true)
  })

  it('warns (but does not block) on unknown dimensions', () => {
    const r = checkImageQuality(new Uint8Array(50_000), 'image/png', 50_000)
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'dimensions_unknown' && i.severity === 'warn')).toBe(true)
  })

  it('warns on extreme aspect ratios', () => {
    const r = checkImageQuality(pngBytes(1200, 120), 'image/png', 50_000)
    expect(r.ok).toBe(true)
    expect(r.issues.some((i) => i.code === 'unusual_aspect_ratio')).toBe(true)
  })
})

describe('retakePhotoAdvice', () => {
  it('returns actionable guidance', () => {
    const tips = retakePhotoAdvice()
    expect(tips.length).toBeGreaterThan(0)
    expect(tips.every((t) => typeof t === 'string' && t.length > 0)).toBe(true)
  })
})
