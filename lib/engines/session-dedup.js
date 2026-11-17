/**
 * Session dedup: content-addressed cross-turn deduplication.
 *
 * A tool result whose session id, tool name, arguments and exact text were
 * already seen within the TTL is replaced by a short stub that points at the
 * earlier occurrence (and at the spilled original). Byte-exact fingerprints
 * make the replacement information-safe: nothing that differs can collide.
 */

import { sha256, utf8Bytes } from '../util.js'

export class SessionDeduper {
  constructor(config = {}) {
    this.ttlMs = Number(config.ttlMs) || 600_000
    this.ttlOverrides = { ...(config.ttlOverrides ?? {}) }
    this.minBytes = Number(config.minBytes) || 2_000
    this.maxEntries = 4_000
    this.entries = new Map()
  }

  configure(config = {}) {
    const ttl = Number(config.ttlMs)
    if (Number.isFinite(ttl)) this.ttlMs = ttl
    if (config.ttlOverrides && typeof config.ttlOverrides === 'object' && !Array.isArray(config.ttlOverrides)) {
      this.ttlOverrides = { ...config.ttlOverrides }
    }
    this.minBytes = Number(config.minBytes) || this.minBytes
  }

  /** Effective TTL for a tool call: per-tool override wins over the global value. */
  ttlFor(toolName) {
    if (typeof toolName === 'string' && Object.hasOwn(this.ttlOverrides, toolName)) {
      const override = Number(this.ttlOverrides[toolName])
      if (Number.isFinite(override)) return Math.max(0, override)
    }
    return this.ttlMs
  }

  /**
   * Canonical fingerprint of one tool result.
   *
   * Content-addressed on `sessionId + text`: identical bytes are the same
   * information regardless of which tool produced them, and the earlier result
   * the stub points at is just as valid for a different tool name or argument
   * set. Session id stays in the key so one session never points at another.
   */
  fingerprint({ sessionId, text }) {
    return sha256(JSON.stringify([sessionId ?? 'global', text]))
  }

  /**
   * Look up a prior byte-identical result.
   * @returns {{id: string, secondsAgo: number}|undefined}
   */
  check({ sessionId, toolName, args, text }) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    if (typeof text !== 'string' || utf8Bytes(text) < this.minBytes) return undefined
    const ttl = this.ttlFor(toolName)
    if (ttl <= 0) return undefined
    this.prune()
    const key = this.fingerprint({ sessionId, toolName, args, text })
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    if (Date.now() - hit.at > hit.ttl) {
      this.entries.delete(key)
      return undefined
    }
    return { id: hit.id, secondsAgo: Math.max(0, Math.round((Date.now() - hit.at) / 1000)) }
  }

  /** Remember a result after the pipeline accepted it as unique. */
  remember({ sessionId, toolName, args, text, id }) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    if (typeof text !== 'string' || utf8Bytes(text) < this.minBytes) return
    const ttl = this.ttlFor(toolName)
    if (ttl <= 0) return
    const key = this.fingerprint({ sessionId, toolName, args, text })
    this.entries.set(key, { id: id ?? key.slice(0, 12), at: Date.now(), ttl })
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
  }

  prune() {
    const now = Date.now()
    for (const [key, value] of this.entries) {
      if (now - value.at > value.ttl) this.entries.delete(key)
    }
  }

  clear() {
    this.entries.clear()
  }

  /** Stub text that replaces a duplicate. */
  buildStub({ secondsAgo, id, spillPath }) {
    const where = spillPath ? ` Full original: ${spillPath}` : ''
    return (
      `[token-lean dedup] This output is byte-identical to a result from ${secondsAgo}s ago in this session ` +
      `(ref ${id}). Reuse that earlier result instead of re-reading this one.${where}`
    )
  }
}

/** JSON.stringify with sorted object keys, so argument order cannot break dedup. */
export function stableStringify(value) {
  try {
    return JSON.stringify(sortValue(value))
  } catch {
    return String(value)
  }
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key])
    return out
  }
  return value
}
