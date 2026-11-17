/**
 * RTK grep / ripgrep filter.
 *
 * Re-groups `path:line:content` output by file (the repeated path is the
 * expensive part), caps the number of match lines, keeps the context lines
 * adjacent to the matches that survive, and names the cap explicitly. When the
 * output is not greppable line-oriented output — or when a line cannot be
 * parsed — the text is returned unchanged, because dropping a line here would
 * silently hide a match.
 */

import {
  commandMatches,
  commandOf,
  configNumber,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
  truncateEnd,
} from './shared.js'

const SEARCH_COMMAND_RE = /(^|[;&|]\s*)(?:grep|egrep|fgrep|rg|ag|ack|ripgrep)\b/
const MATCH_LINE_RE = /^(.*?)([:\-])(\d+)\2(.*)$/
const MAX_MATCHES = 60
const CONTEXT_AFTER = 2
const CONTEXT_PENDING = 3
const MAX_WIDTH = 300

export const grepFilter = {
  name: 'grep',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)
    const tool = typeof ctx?.toolName === 'string' ? ctx.toolName.toLowerCase() : ''

    if (['grep', 'rg', 'search', 'ripgrep'].includes(tool)) return true
    if (commandMatches(command, SEARCH_COMMAND_RE)) return true

    let parsed = 0
    let total = 0
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed === '--') continue
      total += 1
      if (parseMatchLine(line) !== undefined) parsed += 1
    }
    return parsed >= 2 && parsed >= total * 0.6
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = Math.min(configNumber(config, 'longLineChars', 420, 80, 2_000), MAX_WIDTH)
      return compactMatches(text, maxWidth)
    } catch {
      return text
    }
  },
}

/** Parse one greppable line, returning undefined for anything else. */
function parseMatchLine(line) {
  const source = line.replace(/\r$/, '')
  // Log lines, indented stack frames and timestamped prose are never grep
  // match lines; parsing them would group unrelated output by "file".
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(source)) return undefined
  if (/^\s/.test(source)) return undefined
  const match = MATCH_LINE_RE.exec(source)
  if (match === null) return undefined
  const file = match[1]
  if (file === '' || /^\d+$/.test(file)) return undefined
  if (file.includes(' (') || file.includes('\t')) return undefined
  const lineNumber = Number.parseInt(match[3], 10)
  if (!Number.isFinite(lineNumber)) return undefined
  return { file, line: lineNumber, isMatch: match[2] === ':', content: match[4] }
}

function compactMatches(text, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const files = new Map()
  let totalMatches = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === '--') continue
    const parsed = parseMatchLine(line)
    if (parsed === undefined) return text // faithfulness guard
    if (!files.has(parsed.file)) files.set(parsed.file, [])
    files.get(parsed.file).push(parsed)
    if (parsed.isMatch) totalMatches += 1
  }

  if (files.size === 0 || totalMatches === 0) return text

  const output = []
  let shownMatches = 0
  let stopped = false

  for (const [file, entries] of files) {
    if (stopped) break
    const fileMatches = entries.filter((entry) => entry.isMatch).length
    const kept = []
    let after = 0
    let pending = []

    for (const entry of entries) {
      if (entry.isMatch) {
        if (shownMatches >= MAX_MATCHES) {
          stopped = true
          break
        }
        for (const context of pending) kept.push(context)
        pending = []
        kept.push(entry)
        shownMatches += 1
        after = 0
      } else if (kept.length > 0 && after < CONTEXT_AFTER) {
        kept.push(entry)
        after += 1
      } else {
        pending.push(entry)
        if (pending.length > CONTEXT_PENDING) pending.shift()
      }
    }

    if (kept.length === 0) continue
    output.push(`[file] ${truncateEnd(file, 160)} (${fileMatches}):`)
    for (const entry of kept) {
      const number = String(entry.line).padStart(4)
      const separator = entry.isMatch ? ':' : '-'
      const content = truncateEnd(entry.content.trim(), maxWidth)
      output.push(`  ${number}${separator} ${content}`)
    }
  }

  const omitted = totalMatches - shownMatches
  if (omitted > 0) output.push(`... +${omitted} more matches`)

  const header =
    omitted > 0
      ? `${shownMatches} of ${totalMatches} matches in ${files.size}F:`
      : `${totalMatches} matches in ${files.size}F:`
  return neverWorse(joinLines([header, ...output], trailing), text)
}
