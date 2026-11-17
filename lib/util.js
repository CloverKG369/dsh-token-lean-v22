/**
 * Shared helpers for dsh-token-lean.
 *
 * Everything here is deterministic and side-effect free so both the host plugin
 * and the unit tests can call it directly.
 */

import { createHash } from 'node:crypto'

const encoder = new TextEncoder()

/** UTF-8 byte length of a string. */
export function utf8Bytes(value) {
  return typeof value === 'string' ? encoder.encode(value).length : 0
}

/** Unicode code-point length (surrogate pairs count once). */
export function charCount(value) {
  return typeof value === 'string' ? Array.from(value).length : 0
}

/**
 * Cheap token estimate used by the never-worse gates.
 * DeepSeek-class tokenizers average roughly 3.6 characters per token for mixed
 * text; 4 is the conservative (never over-reporting savings) divisor.
 */
export function estimateTokens(value) {
  return Math.ceil(charCount(value) / 4)
}

/** Lowercase SHA-256 hex digest. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** First 12 hex chars of the SHA-256 digest of a string. */
export function shortHash(value) {
  return sha256(value).slice(0, 12)
}

/** Clamp a numeric config value into a safe range. */
export function clampNumber(value, fallback, min, max) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

/** Deep-merge plain objects; arrays and scalars are replaced wholesale. */
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

/** True for non-null, non-array objects. */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Join every text block; returns undefined when the content is not all text. */
export function readTextContent(content) {
  if (!Array.isArray(content) || content.length === 0) return undefined
  const parts = []
  for (const block of content) {
    if (!block || block.type !== 'text' || typeof block.text !== 'string') return undefined
    parts.push(block.text)
  }
  return parts.join('\n\n')
}

/** Build the single-text-block replacement for a compressed result. */
export function textContent(text) {
  return [{ type: 'text', text }]
}

/** Marker every compressed result carries; used to avoid double compression. */
export const LEAN_MARKER = '[token-lean'

/** Whether a text already carries a token-lean notice. */
export function isAlreadyCompressed(text) {
  return typeof text === 'string' && text.includes(LEAN_MARKER)
}

/** Human-readable byte count. */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** Strip a UTF-8 BOM that Windows tools sometimes prepend. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
