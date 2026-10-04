// PHASE 5: Image quality pre-check, run BEFORE the (expensive) AI vision
// call. Cheap, deterministic heuristics only -- no ML, no extra network
// calls. Goal: catch obviously unusable photos early so we don't spend an
// AI call and a confusing result on them, without being so strict that we
// reject legitimate real-world leaf photos.
//
// Cloudflare Workers has no Canvas/Image-decode API, so true pixel-level
// brightness/blur analysis isn't practical here -- we rely on file-level
// signals (type, size, parsed pixel dimensions from image headers) which
// *is* cheap and reliable to compute from raw bytes.

export type ImageQualityIssue = {
  code: string
  message: string
  severity: 'block' | 'warn' // 'block' = don't call AI, 'warn' = proceed but inform user
}

export type ImageQualityReport = {
  ok: boolean // false => should block the AI call entirely
  issues: ImageQualityIssue[]
  width: number | null
  height: number | null
}

const MIN_DIMENSION = 120 // px -- below this, disease detail is unlikely to be visible
const MIN_BYTES_FOR_SIZE = 3 * 1024 // 3KB -- suspiciously tiny for a real photo
const MAX_ASPECT_RATIO = 6 // extremely thin slivers are unlikely to be usable leaf photos

/** Parses width/height from a PNG file's IHDR chunk (bytes 16-23). */
function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature: 8 bytes, then IHDR chunk: 4 length + 4 "IHDR" + 4 width + 4 height
  if (bytes.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/** Parses width/height from a JPEG file by walking its marker segments looking for SOF0-3/5-7/9-15. */
function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null // not JPEG (SOI marker)
  let offset = 2
  const SOF_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ])
  while (offset < bytes.length - 8) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9) break // EOI
    const segLength = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (SOF_MARKERS.has(marker)) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    offset += 2 + segLength
  }
  return null
}

export function parseImageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  if (mimeType.includes('png')) return parsePngDimensions(bytes)
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return parseJpegDimensions(bytes)
  // Try both as a fallback in case the declared mime type is wrong.
  return parsePngDimensions(bytes) || parseJpegDimensions(bytes)
}

export function checkImageQuality(bytes: Uint8Array, mimeType: string, sizeBytes: number): ImageQualityReport {
  const issues: ImageQualityIssue[] = []
  const dims = parseImageDimensions(bytes, mimeType)

  if (sizeBytes < MIN_BYTES_FOR_SIZE) {
    issues.push({
      code: 'file_too_small',
      message:
        'This file is unusually small for a real photo, which often means it is corrupted, a thumbnail, or a screenshot with very little detail.',
      severity: 'block'
    })
  }

  if (!dims) {
    // Couldn't determine dimensions -- warn but don't hard-block, since some
    // valid images (e.g. progressive/unusual encodings) can fail this cheap parser.
    issues.push({
      code: 'dimensions_unknown',
      message: 'Could not verify the image resolution. The photo will still be analyzed, but results may be less reliable.',
      severity: 'warn'
    })
  } else {
    if (dims.width < MIN_DIMENSION || dims.height < MIN_DIMENSION) {
      issues.push({
        code: 'resolution_too_low',
        message: `Image resolution is very low (${dims.width}x${dims.height}px). Disease details like spots and discoloration may not be visible.`,
        severity: 'block'
      })
    }
    const aspect = Math.max(dims.width, dims.height) / Math.max(1, Math.min(dims.width, dims.height))
    if (aspect > MAX_ASPECT_RATIO) {
      issues.push({
        code: 'unusual_aspect_ratio',
        message: 'This image has an unusually thin/wide shape for a leaf photo. Please make sure the leaf fills most of the frame.',
        severity: 'warn'
      })
    }
  }

  const blockingIssues = issues.filter((i) => i.severity === 'block')
  return { ok: blockingIssues.length === 0, issues, width: dims?.width ?? null, height: dims?.height ?? null }
}

/** Friendly, actionable guidance shown to the user when an image is rejected pre-AI-call. */
export function retakePhotoAdvice(): string[] {
  return [
    'Move closer so the affected leaf fills most of the frame',
    'Use good, even natural lighting -- avoid strong backlight or deep shadow',
    'Hold the camera steady and make sure the leaf is in focus',
    'Photograph a single leaf or a small cluster, not the whole plant from far away'
  ]
}
