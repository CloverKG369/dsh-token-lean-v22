/**
 * Tool-result compression pipeline.
 *
 * Order is deliberate and fixed:
 *   session-dedup → lite → headroom → RTK
 * Dedup runs first because a byte-identical replay should never be re-compressed
 * (the second copy is pure waste). Lite is a lossless cleanup that gives the
 * later engines a smaller, cleaner input. Headroom handles structured JSON
 * before RTK's command-aware text filters see it.
 *
 * Reversibility is a hard precondition: when spill is enabled, a result is only
 * replaced when its exact original reached disk. Engine counters are recorded
 * only after the replacement is adopted, so the dashboard never counts a pass
 * the caller discarded.
 */

import { formatBytes, shortHash, utf8Bytes } from '../util.js'
import { headroomCompress } from './headroom.js'
import { liteClean } from './lite.js'
import { rtkCompress } from './rtk/index.js'

const ENGINE_ORDER = ['sessionDedup', 'lite', 'headroom', 'rtk']

const SOURCE_EXTENSION_RE =
  /\.(?:py|pyi|js|jsx|mjs|cjs|ts|tsx|cs|csproj|sln|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|rb|php|scala|sql|sh|bash|zsh|ps1|psm1|html|htm|css|scss|sass|less|vue|svelte|astro|md|mdx|ya?ml|toml|ini|cfg|gradle|properties)$/i

/** A `read` of source/config text: RTK must not window it. */
function isSourceRead(toolName, args) {
  if (typeof toolName !== 'string' || toolName.toLowerCase() !== 'read') return false
  if (args === null || typeof args !== 'object') return false
  for (const key of ['file_path', 'filePath', 'path', 'file']) {
    const value = args[key]
    if (typeof value === 'string' && SOURCE_EXTENSION_RE.test(value.trim())) return true
  }
  return false
}

export function createPipeline({ getConfig, deduper, spill, stats, log = () => {} }) {
  return async function compressToolResult({ text, toolName, args, sessionId }) {
    const config = getConfig()
    if (!config.master) return { changed: false, applied: [] }
    if (typeof text !== 'string' || text.length === 0) return { changed: false, applied: [] }

    const original = text
    const originalBytes = utf8Bytes(original)
    const hasSession = typeof sessionId === 'string' && sessionId.length > 0
    let current = original
    const applied = []
    const detail = {}

    // 1) Cross-turn dedup: replace a byte-identical replay with a stub.
    // Require a session id: without one a 'global' bucket would dedup across
    // unrelated sessions, pointing a stub at context the caller cannot see.
    if (hasSession && config.engines.sessionDedup.enabled) {
      const duplicate = deduper.check({ sessionId, toolName, args, text: original })
      if (duplicate !== undefined) {
        const saved = config.spill.enabled ? spill.save(original) : undefined
        const stub = deduper.buildStub({
          secondsAgo: duplicate.secondsAgo,
          id: duplicate.id,
          spillPath: saved?.path,
        })
        const afterBytes = utf8Bytes(stub)
        stats.record('sessionDedup', originalBytes, afterBytes)
        stats.recordTool(originalBytes, afterBytes)
        if (saved) stats.addSpill()
        return {
          changed: true,
          text: stub,
          applied: ['session-dedup'],
          dedup: true,
          spill: saved,
          before: originalBytes,
          after: afterBytes,
        }
      }
    }

    // 2) Lite — lossless cleanup, only above its configured entry threshold.
    if (config.engines.lite.enabled && utf8Bytes(current) >= config.engines.lite.minBytes) {
      const result = liteClean(current, config.engines.lite)
      if (result.changed && result.after < result.before) {
        const saved = result.before - result.after
        if (saved >= 64) {
          detail.lite = { before: result.before, after: result.after, passes: result.passes }
          current = result.text
          applied.push('lite')
        }
      }
    }

    // 3) Headroom — lossless tabular JSON compaction.
    if (config.engines.headroom.enabled) {
      const result = headroomCompress(current, config.engines.headroom)
      if (result !== undefined) {
        detail.headroom = { before: result.before, after: result.after, rows: result.rows, name: result.name }
        current = result.text
        applied.push('headroom')
      }
    }

    // 4) RTK — command-aware filtering and never-worse truncation.
    // Source-file reads are exempt: head/tail windowing cuts the middle of the
    // code the model needs to edit. API/JSON reads still use Headroom above.
    const sourceRead = config.engines.rtk.skipSourceReads !== false && isSourceRead(toolName, args)
    if (config.engines.rtk.enabled && !sourceRead) {
      try {
        const result = rtkCompress({ text: current, toolName, args }, config.engines.rtk)
        if (result !== undefined && result.text.length < current.length) {
          detail.rtk = { before: utf8Bytes(current), after: utf8Bytes(result.text), filter: result.filter }
          current = result.text
          applied.push('rtk')
        }
      } catch (error) {
        log(`rtk engine failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Remember the ORIGINAL even when nothing was adopted: a later identical
    // result should still be elided.
    if (hasSession) deduper.remember({ sessionId, toolName, args, text: original, id: shortHash(original) })

    if (applied.length === 0) return { changed: false, applied: [] }

    // Reversibility gate: spill must succeed when the store is enabled.
    const saved = config.spill.enabled ? spill.save(original) : undefined
    if (config.spill.enabled && saved === undefined) {
      log('spill unavailable; keeping the original result')
      return { changed: false, applied: [] }
    }
    if (saved) stats.addSpill()

    const { text: finalText, afterBytes } = composeFinal({ config, applied, detail, spill: saved, before: originalBytes, current })

    // Counters are committed only now, once the replacement is certain.
    for (const engine of applied) {
      const entry = detail[engine]
      if (entry !== undefined) stats.record(engine, entry.before, entry.after)
    }
    stats.recordTool(originalBytes, afterBytes)

    return {
      changed: true,
      text: finalText,
      applied,
      detail,
      spill: saved,
      before: originalBytes,
      after: afterBytes,
    }
  }
}

/** Render the notice with the real final byte count (iterate until stable). */
function composeFinal({ config, applied, detail, spill, before, current }) {
  const payloadBytes = utf8Bytes(current)
  let afterGuess = payloadBytes + 160
  let finalText = ''
  let actual = afterGuess
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const notice = renderNotice({ config, applied, detail, spill, before, after: afterGuess })
    finalText = `${notice}\n${current}`
    actual = utf8Bytes(finalText)
    if (actual === afterGuess) break
    afterGuess = actual
  }
  return { text: finalText, afterBytes: actual }
}

/** Render the reversible-notice header prepended to every compressed result. */
export function renderNotice({ config, applied, detail, spill, before, after }) {
  const id = spill?.id ?? shortHash(`${before}:${after}:${applied.join(',')}`)
  const mode = applied.join('+')
  const pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0
  const detailFirst = Number(config?.notice?.detailedFirst) || 0
  if (noticeSeen.size > 5_000) noticeSeen.clear()
  const seen = noticeSeen.get(id) ?? 0
  noticeSeen.set(id, seen + 1)

  if (seen >= detailFirst) {
    return `[token-lean #${id} | ${mode} | ${formatBytes(before)} → ${formatBytes(after)} (-${pct}%)]`
  }

  const parts = []
  for (const engine of ENGINE_ORDER) {
    const entry = detail?.[engine]
    if (entry === undefined) continue
    const saved = entry.before - entry.after
    parts.push(`${engine}: -${formatBytes(saved)}`)
  }
  const retrieval = spill
    ? `Full original (byte-exact): ${spill.path} — read that file if the elided detail matters.`
    : 'Full original not spilled (spill disabled).'
  return (
    `[token-lean #${id} | ${mode} | ${formatBytes(before)} → ${formatBytes(after)} (-${pct}%)` +
    `${parts.length > 0 ? ` | ${parts.join(', ')}` : ''}]\n` +
    `[token-lean] ${retrieval}`
  )
}

const noticeSeen = new Map()
