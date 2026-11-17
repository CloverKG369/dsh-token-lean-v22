/**
 * Persistent savings telemetry.
 *
 * Two views:
 *   - `engines`: per-engine pass counters (how each layer performed)
 *   - `tool`:    one entry per adopted tool-result compression (true savings)
 *
 * Counters are written on a short debounce so a burst of tool calls costs one
 * disk write, while a crash loses at most the last second of counters.
 */

import path from 'node:path'
import { resolveDshHome } from './config.js'
import { JsonStore } from './config.js'

const EMPTY = {
  engines: {
    sessionDedup: { before: 0, after: 0, calls: 0, hits: 0 },
    lite: { before: 0, after: 0, calls: 0, hits: 0 },
    headroom: { before: 0, after: 0, calls: 0, hits: 0 },
    rtk: { before: 0, after: 0, calls: 0, hits: 0 },
  },
  tool: { before: 0, after: 0, calls: 0, hits: 0 },
  spills: 0,
  updatedAt: 0,
}

export class StatsStore {
  constructor(home = resolveDshHome()) {
    this.filePath = path.join(home, 'token-lean', 'stats.json')
    this.store = new JsonStore(this.filePath, EMPTY)
    this.state = this.normalize(this.store.load())
    this.timer = undefined
  }

  normalize(input) {
    const out = structuredClone(EMPTY)
    for (const id of Object.keys(out.engines)) {
      const src = input?.engines?.[id] ?? {}
      out.engines[id] = {
        before: nonNegative(src.before),
        after: nonNegative(src.after),
        calls: nonNegative(src.calls),
        hits: nonNegative(src.hits),
      }
    }
    // Legacy files (v1) had no tool-level counters: seed them from the engine
    // totals so the dashboard never drops to zero after an upgrade.
    const legacy = Object.values(out.engines).reduce(
      (acc, engine) => ({
        before: acc.before + engine.before,
        after: acc.after + engine.after,
        calls: acc.calls + engine.calls,
        hits: acc.hits + engine.hits,
      }),
      { before: 0, after: 0, calls: 0, hits: 0 },
    )
    const tool = input?.tool === undefined ? legacy : input.tool
    out.tool = {
      before: nonNegative(tool?.before),
      after: nonNegative(tool?.after),
      calls: nonNegative(tool?.calls),
      hits: nonNegative(tool?.hits),
    }
    out.spills = nonNegative(input?.spills)
    out.updatedAt = nonNegative(input?.updatedAt)
    return out
  }

  /** Record one engine pass. A pass with no byte reduction counts a call but not a hit. */
  record(engineId, beforeBytes, afterBytes) {
    const engine = this.state?.engines?.[engineId]
    if (!engine) return
    const before = nonNegative(beforeBytes)
    const after = nonNegative(afterBytes)
    engine.before += before
    engine.after += after
    engine.calls += 1
    if (after < before) engine.hits += 1
    this.scheduleSave()
  }

  /** Record one adopted tool-result compression (before = raw result bytes). */
  recordTool(beforeBytes, afterBytes) {
    const before = nonNegative(beforeBytes)
    const after = nonNegative(afterBytes)
    this.state.tool.before += before
    this.state.tool.after += after
    this.state.tool.calls += 1
    if (after < before) this.state.tool.hits += 1
    this.scheduleSave()
  }

  addSpill() {
    this.state.spills += 1
    this.scheduleSave()
  }

  reset() {
    this.state = this.normalize(EMPTY)
    this.flush()
  }

  snapshot() {
    const out = this.normalize(this.state)
    out.total = { ...out.tool }
    return out
  }

  scheduleSave() {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, 250)
    this.timer.unref?.()
  }

  flush() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.state.updatedAt = Date.now()
    this.store.save(this.state)
  }
}

function nonNegative(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}
