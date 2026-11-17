/**
 * RTK `find` filter.
 *
 * Deduplicates and caps a path listing, then folds it by directory:
 *
 *   42F 6D:
 *   src/ a.js b.js c.js
 *   lib/ d.js
 *   ext: .js(30) .ts(9) .md(3)
 *
 * Mirrors upstream RTK's find renderer (Apache-2.0): files are sorted, the
 * directory name is emitted once instead of on every path, and a `+N more`
 * line stands in for entries past the inventory cap.
 */

import {
  commandMatches,
  commandOf,
  isErrorLine,
  joinLines,
  linesOf,
  neverWorse,
  plural,
  textOf,
  truncateEnd,
} from './shared.js'

const FIND_COMMAND_RE = /(^|[;&|]\s*)(?:find|fd)\s+/
const CAP_INVENTORY = 50
const PATH_LINE_RE = /^(?:[A-Za-z]:)?(?:[^\s:*?"<>|\\/]+\/)*[^\s:*?"<>|\\/]+$/

export const findFilter = {
  name: 'find',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)
    const tool = typeof ctx?.toolName === 'string' ? ctx.toolName.toLowerCase() : ''

    if (commandMatches(command, FIND_COMMAND_RE)) return true
    if (tool === 'glob' || tool === 'find' || tool === 'fd') return looksLikePathList(text)
    // No command available: only a dense list of bare paths is unambiguous.
    return command === '' && looksLikePathList(text) && countPathLines(text) >= 8
  },

  apply(text, _ctx, _config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      return compactPaths(text)
    } catch {
      return text
    }
  },
}

function looksLikePathList(text) {
  if (typeof text !== 'string') return false
  let seen = 0
  let pathish = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (!PATH_LINE_RE.test(trimmed)) return false
    if (trimmed.includes('/') || trimmed.includes('.')) pathish += 1
    seen += 1
  }
  return seen >= 5 && pathish >= Math.ceil(seen * 0.5)
}

function countPathLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length
}

function compactPaths(text) {
  const { lines, trailing } = linesOf(text)
  const errors = []
  const seen = new Set()
  const files = []

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (isErrorLine(line) && /^(?:find|fd):/i.test(line)) {
      errors.push(line)
      continue
    }
    const normalised = stripDotSlash(line)
    if (normalised === '' || seen.has(normalised)) continue
    if (!PATH_LINE_RE.test(normalised)) {
      // Not a path and not a `find:` diagnostic: keep it verbatim rather than
      // inventing a filename out of it.
      errors.push(truncateEnd(normalised, 200))
      continue
    }
    seen.add(normalised)
    files.push(normalised)
  }

  if (files.length === 0) return neverWorse(errors.join('\n'), text)

  files.sort()
  const displayed = files.slice(0, CAP_INVENTORY)
  const byDir = new Map()
  for (const file of displayed) {
    const slash = file.lastIndexOf('/')
    const dir = slash === -1 ? '.' : file.slice(0, slash)
    const name = slash === -1 ? file : file.slice(slash + 1)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(name)
  }

  const dirs = [...byDir.keys()].sort()
  const output = [`${files.length}F ${dirs.length}D:`, '']
  for (const dir of dirs) {
    const names = byDir.get(dir)
    names.sort()
    output.push(`${shortDir(dir)}/ ${names.join(' ')}`)
  }
  if (displayed.length < files.length) output.push(`+${files.length - displayed.length} more`)

  const byExt = new Map()
  for (const file of files) {
    const base = file.slice(file.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 ? base.slice(dot) : 'none'
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
  }
  if (byExt.size > 1) {
    const summary = [...byExt.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext}(${count})`)
      .join(' ')
    output.push('', `ext: ${summary}`)
  }
  if (errors.length > 0) output.push('', `... (${plural(errors.length, 'path error')})`, ...errors)

  return neverWorse(joinLines(output, trailing), text)
}

function stripDotSlash(path) {
  let value = path
  while (value.startsWith('./')) value = value.slice(2)
  return value
}

function shortDir(dir) {
  if (dir === '.') return '.'
  const trimmed = dir.replace(/\/+$/, '')
  return truncateEnd(trimmed, 50)
}
