/**
 * Configuration model, defaults, validation and persistence for dsh-token-lean.
 *
 * Live settings live in `$DSH_HOME/token-lean/config.json`; the bundle's YAML
 * `config:` block provides deployment defaults, and the saved document wins.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { clampNumber, deepMerge, isPlainObject } from './util.js'

export const ENGINE_IDS = ['sessionDedup', 'lite', 'headroom', 'rtk']
export const STYLE_IDS = ['caveman', 'yagni', 'ponytail', 'adhd', 'antislop']
export const STYLE_LEVELS = ['off', 'lite', 'full', 'ultra']

/** Upstream level sets per style. A level outside this map is not accepted. */
export const STYLE_LEVELS_BY_ID = {
  caveman: ['full', 'ultra'],
  yagni: ['full'],
  ponytail: ['lite', 'full', 'ultra'],
  adhd: ['full'],
  antislop: ['full'],
}

export const STYLE_DEFAULT_LEVEL = {
  caveman: 'full',
  yagni: 'full',
  ponytail: 'full',
  adhd: 'full',
  antislop: 'full',
}

export const ENGINE_META = {
  sessionDedup: {
    label: 'Session dedup',
    short: 'Drop byte-identical tool output repeated across turns.',
  },
  lite: {
    label: 'Lite',
    short: 'Safe whitespace, ANSI and inline image-data cleanup.',
  },
  headroom: {
    label: 'Headroom',
    short: 'Lossless tabular compaction of uniform JSON arrays.',
  },
  rtk: {
    label: 'RTK',
    short: 'Command-aware filtering for git, grep, find, ls, logs, builds and tables.',
  },
}

export const STYLE_META = {
  caveman: { label: 'Caveman', short: 'Terse caveman prose: drop filler, keep facts.' },
  yagni: { label: 'YAGNI', short: 'Build the smallest thing that works; no speculative code.' },
  ponytail: { label: 'Ponytail', short: 'Lazy senior dev mode: minimal code, maximal restraint.' },
  adhd: { label: 'I have ADHD', short: 'Action first, short numbered steps, no preamble.' },
  antislop: { label: 'Antislop', short: 'Reject generic AI prose, hollow framing and slop patterns.' },
}

export const DEFAULTS = Object.freeze({
  master: true,
  engines: {
    sessionDedup: {
      enabled: true,
      ttlMs: 600_000,
      ttlOverrides: {},
      minBytes: 2_000,
    },
    lite: {
      enabled: true,
      minBytes: 800,
      stripAnsi: true,
      normalizeNewlines: true,
      trimTrailingSpaces: true,
      collapseBlankLines: true,
      trimImageDataUrls: true,
    },
    headroom: {
      enabled: true,
      minBytes: 3_000,
      minRows: 8,
      jsonlMinLines: 8,
      maxRows: 5_000,
      keepRatioMax: 0.85,
    },
    rtk: {
      enabled: true,
      minBytes: 1_400,
      errorMinBytes: 6_000,
      skipSourceReads: true,
      maxLines: 160,
      headLines: 100,
      tailLines: 60,
      keepRatioMax: 0.72,
      errorLines: 25,
      longLineChars: 420,
      truncateMiddle: true,
    },
  },
  styles: {
    caveman: { enabled: false, level: 'full' },
    yagni: { enabled: false, level: 'full' },
    ponytail: { enabled: false, level: 'full' },
    adhd: { enabled: false, level: 'full' },
    antislop: { enabled: false, level: 'full' },
  },
  styleOrder: [...STYLE_IDS],
  spill: { enabled: true, maxBytes: 8_000_000, keepFiles: 500 },
  notice: { detailedFirst: 3 },
  web: { allowLan: false },
})

/** Resolve the DSH home the same way the host does. */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

/** Per-tool dedup TTL overrides: tool name -> milliseconds (0 disables). */
function normalizeOverrides(value) {
  const out = {}
  if (!isPlainObject(value)) return out
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || key === '' || key.length > 120) continue
    out[key] = clampNumber(raw, 0, 0, 86_400_000)
  }
  return out
}

/** Validate and normalize one engine section. */
function normalizeEngine(id, value, base) {  const source = isPlainObject(value) ? value : {}
  const out = { ...base }
  out.enabled = typeof source.enabled === 'boolean' ? source.enabled : base.enabled

  if (id === 'sessionDedup') {
    out.ttlMs = clampNumber(source.ttlMs, base.ttlMs, 0, 86_400_000)
    out.ttlOverrides = normalizeOverrides(source.ttlOverrides)
    out.minBytes = clampNumber(source.minBytes, base.minBytes, 64, 10_000_000)
  }
  if (id === 'lite') {
    out.minBytes = clampNumber(source.minBytes, base.minBytes, 64, 10_000_000)
    for (const flag of ['stripAnsi', 'normalizeNewlines', 'trimTrailingSpaces', 'collapseBlankLines', 'trimImageDataUrls']) {
      if (typeof source[flag] === 'boolean') out[flag] = source[flag]
    }
  }
  if (id === 'headroom') {
    out.minBytes = clampNumber(source.minBytes, base.minBytes, 128, 10_000_000)
    out.minRows = clampNumber(source.minRows, base.minRows, 2, 100_000)
    out.jsonlMinLines = clampNumber(source.jsonlMinLines, base.jsonlMinLines, 2, 100_000)
    out.maxRows = clampNumber(source.maxRows, base.maxRows, out.minRows, 1_000_000)
    out.keepRatioMax = clampNumber(source.keepRatioMax, base.keepRatioMax, 0.1, 1)
  }
  if (id === 'rtk') {
    out.minBytes = clampNumber(source.minBytes, base.minBytes, 128, 10_000_000)
    out.errorMinBytes = clampNumber(source.errorMinBytes, base.errorMinBytes, 0, 10_000_000)
    if (typeof source.skipSourceReads === 'boolean') out.skipSourceReads = source.skipSourceReads
    out.maxLines = clampNumber(source.maxLines, base.maxLines, 20, 100_000)
    out.headLines = clampNumber(source.headLines, base.headLines, 1, out.maxLines)
    out.tailLines = clampNumber(source.tailLines, base.tailLines, 0, out.maxLines)
    out.keepRatioMax = clampNumber(source.keepRatioMax, base.keepRatioMax, 0.1, 1)
    out.errorLines = clampNumber(source.errorLines, base.errorLines, 0, 1_000)
    out.longLineChars = clampNumber(source.longLineChars, base.longLineChars, 80, 100_000)
    if (typeof source.truncateMiddle === 'boolean') out.truncateMiddle = source.truncateMiddle
    if (isPlainObject(source.filters)) out.filters = { ...source.filters }
  }
  return out
}

/** Validate and normalize one style section. The prompt text is fixed by the
 * shipped upstream preset; only the enable flag and the upstream level remain
 * user-configurable. */
function normalizeStyle(id, value, base) {
  const source = isPlainObject(value) ? value : {}
  const allowed = STYLE_LEVELS_BY_ID[id] ?? STYLE_LEVELS
  const level = allowed.includes(source.level) ? source.level : STYLE_DEFAULT_LEVEL[id]
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : base.enabled,
    level,
  }
}

/**
 * Resolve a partial configuration over the shipped defaults.
 * Unknown keys are ignored; every numeric field is clamped to its safe range.
 */
export function resolveConfig(input) {
  const source = isPlainObject(input) ? input : {}
  const engines = {}
  for (const id of ENGINE_IDS) engines[id] = normalizeEngine(id, source.engines?.[id], DEFAULTS.engines[id])

  const styles = {}
  for (const id of STYLE_IDS) styles[id] = normalizeStyle(id, source.styles?.[id], DEFAULTS.styles[id])

  const order = Array.isArray(source.styleOrder)
    ? source.styleOrder.filter((id, index, arr) => STYLE_IDS.includes(id) && arr.indexOf(id) === index)
    : [...DEFAULTS.styleOrder]
  for (const id of STYLE_IDS) if (!order.includes(id)) order.push(id)

  return {
    master: typeof source.master === 'boolean' ? source.master : DEFAULTS.master,
    engines,
    styles,
    styleOrder: order,
    spill: {
      enabled: typeof source.spill?.enabled === 'boolean' ? source.spill.enabled : DEFAULTS.spill.enabled,
      maxBytes: clampNumber(source.spill?.maxBytes, DEFAULTS.spill.maxBytes, 0, 200_000_000),
      keepFiles: clampNumber(source.spill?.keepFiles, DEFAULTS.spill.keepFiles, 0, 100_000),
    },
    notice: {
      detailedFirst: clampNumber(source.notice?.detailedFirst, DEFAULTS.notice.detailedFirst, 0, 1_000),
    },
    web: {
      allowLan: typeof source.web?.allowLan === 'boolean' ? source.web.allowLan : DEFAULTS.web.allowLan,
    },
  }
}

/** Small atomic JSON file store used by config and stats. */
export class JsonStore {
  constructor(filePath, fallback) {
    this.filePath = filePath
    this.fallback = fallback
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return isPlainObject(parsed) ? parsed : structuredClone(this.fallback)
    } catch {
      return structuredClone(this.fallback)
    }
  }

  save(value) {
    try {
      const dir = path.dirname(this.filePath)
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${this.filePath}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
      fs.renameSync(tmp, this.filePath)
      return true
    } catch {
      return false
    }
  }
}

/** Persistent configuration document. */
export class ConfigStore {
  constructor(home = resolveDshHome()) {
    this.dir = path.join(home, 'token-lean')
    this.filePath = path.join(this.dir, 'config.json')
    this.store = new JsonStore(this.filePath, {})
  }

  /** Deployment defaults merged with the persisted document. */
  load(deploymentDefaults = {}) {
    return resolveConfig(deepMerge(deepMerge(DEFAULTS, deploymentDefaults), this.store.load()))
  }

  save(config) {
    return this.store.save(config)
  }
}
