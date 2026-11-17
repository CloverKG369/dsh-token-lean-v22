/**
 * RTK `ls` filter.
 *
 * Turns a long listing into a per-entry compact shape — directories first,
 * `octal name/` for directories and `octal name size` for files when the caller
 * asked for `-l` — filters noisy build directories unless `-a` was passed,
 * deduplicates, and caps the result with an explicit `... (N more, M filtered)`
 * note. Plain `ls` output is deduplicated and capped only.
 * Modelled on upstream RTK's compact ls renderer (Apache-2.0).
 */

import {
  commandMatches,
  commandOf,
  configNumber,
  isErrorLine,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
  truncateEnd,
} from './shared.js'

const LS_COMMAND_RE = /(^|[;&|]\s*)(?:ls|dir|Get-ChildItem|gci)\b/
const PERMS_RE = /^([-dlbcps])([rwx-]{9})[.@+]?$/
const NOISE_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  '__pycache__',
  '.next',
  'dist',
  'build',
  'coverage',
  '.venv',
  'vendor',
  '.cache',
  '.turbo',
])
const CAP_INVENTORY = 50
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

export const lsFilter = {
  name: 'ls',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    if (commandMatches(command, LS_COMMAND_RE)) return true

    // Unix long listing.
    let longLines = 0
    let plainNames = 0
    let dirNames = 0
    for (const raw of text.split('\n')) {
      const line = raw.replace(ANSI_RE, '').trimEnd()
      if (line.trim() === '' || /^total \d+/.test(line)) continue
      if (PERMS_RE.test(line.trim().split(/\s+/)[0] ?? '')) longLines += 1
      else if (/^[^\s:]+$/.test(line.trim())) {
        plainNames += 1
        if (line.trim().endsWith('/')) dirNames += 1
      }
    }
    if (longLines >= 2) return true
    // Plain name listing that is mostly directories (find's path-list sniff
    // rejects trailing slashes, so no earlier filter claims it).
    return plainNames >= 4 && dirNames >= Math.ceil(plainNames * 0.3)
  },

  apply(text, ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      return compactLs(text, ctx, config)
    } catch {
      return text
    }
  },
}

function compactLs(text, ctx, config) {
  const command = commandOf(ctx)
  const showAll = /\s-[a-zA-Z]*a[a-zA-Z]*\b/.test(command) || /\s--all\b/i.test(command) || /-Force\b/i.test(command)
  const longRequested = /\s-[a-zA-Z]*l[a-zA-Z]*\b/.test(command)
  const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)

  const { lines, trailing } = linesOf(text)
  const errors = []
  const dirs = []
  const files = []
  const filtered = []
  const seen = new Set()
  let parsedEntries = 0
  let sawLong = false

  for (const raw of lines) {
    const line = raw.replace(ANSI_RE, '').replace(/\r$/, '').trimEnd()
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (/^total \d+$/.test(trimmed)) continue
    if (isErrorLine(trimmed) && /^(?:ls|dir|Get-ChildItem):/i.test(trimmed)) {
      errors.push(trimmed)
      continue
    }
    // `ls -R` section header (`src:`).
    if (/^[^\s:]+:$/.test(trimmed)) {
      files.push(trimmed)
      continue
    }

    const tokens = trimmed.split(/\s+/)
    const perms = PERMS_RE.exec(tokens[0] ?? '')
    if (perms !== null && tokens.length >= 5) {
      sawLong = true
      parsedEntries += 1
      const type = perms[1]
      const mode = permsToOctal(perms[2])
      const size = Number.parseInt(tokens[4], 10) || 0
      let nameStart = 8
      // macOS lists the year instead of the time; both are one token, so the
      // name still starts at the same index. Guard short lines.
      if (nameStart >= tokens.length) nameStart = Math.max(5, tokens.length - 1)
      const name = tokens.slice(nameStart).join(' ')
      if (name === '') continue
      addEntry(type === 'd', mode, name, size, { dirs, files, filtered, seen, showAll })
      continue
    }

    // Plain name listing.
    if (/\s/.test(trimmed) && !/^(?:[A-Za-z]:\\|\/)/.test(trimmed)) {
      // A multi-word line is not a single directory entry; keep it verbatim.
      files.push({ name: truncateEnd(trimmed, maxWidth), mode: '', size: 0 })
      continue
    }
    parsedEntries += 1
    const isDir = trimmed.endsWith('/')
    addEntry(isDir, '', isDir ? trimmed.replace(/\/+$/, '') : trimmed, 0, {
      dirs,
      files,
      filtered,
      seen,
      showAll,
    })
  }

  if (parsedEntries === 0) {
    if (errors.length > 0) return neverWorse(joinLines(errors, trailing), text)
    return text
  }
  if (dirs.length === 0 && files.length === 0 && filtered.length === 0) return text

  const showMode = longRequested || sawLong
  const allLines = []
  for (const entry of dirs) {
    allLines.push(showMode && entry.mode !== '' ? `${entry.mode}  ${entry.name}/` : `${entry.name}/`)
  }
  for (const entry of files) {
    allLines.push(formatFile(entry, showMode, maxWidth))
  }

  let truncated = []
  if (allLines.length > CAP_INVENTORY) truncated = allLines.splice(CAP_INVENTORY)
  if (dirs.length === 0 && files.length === 0) allLines.push('(empty)')

  const output = [...errors, ...allLines]
  const notes = []
  if (truncated.length > 0) notes.push(`${truncated.length} more`)
  if (filtered.length > 0) notes.push(`${filtered.length} filtered`)
  if (notes.length > 0) output.push(`... (${notes.join(', ')})`)

  return neverWorse(joinLines(output, trailing), text)
}

function addEntry(isDir, mode, name, size, state) {
  const clean = name.replace(/\/+$/, '')
  if (clean === '' || clean === '.' || clean === '..') return
  if (!state.showAll && NOISE_DIRS.has(clean)) {
    state.seen.add(clean)
    state.filtered.push(clean)
    return
  }
  const key = `${isDir ? 'd' : 'f'}:${clean}`
  if (state.seen.has(key)) return
  state.seen.add(key)
  const entry = { name: clean, mode, size }
  if (isDir) state.dirs.push(entry)
  else state.files.push(entry)
}

function formatFile(entry, showMode, maxWidth) {
  const name = truncateEnd(entry.name, maxWidth)
  if (!showMode) return name
  return `${entry.mode !== '' ? `${entry.mode}  ` : ''}${name}${entry.size > 0 ? `  ${humanSize(entry.size)}` : ''}`
}

function permsToOctal(perms) {
  const bits = { r: 4, w: 2, x: 1, s: 1, t: 1, S: 0, T: 0 }
  let octal = ''
  for (let index = 0; index < 9; index += 3) {
    let value = 0
    for (let offset = 0; offset < 3; offset += 1) {
      value += bits[perms[index + offset]] ?? 0
    }
    octal += String(value)
  }
  return octal
}

function humanSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${bytes}B`
}
