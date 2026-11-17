/**
 * RTK `tree` filter.
 *
 * Removes the trailing `N directories, M files` summary, caps the rendered
 * depth (default 3) and the total number of entries, and reports both omissions
 * explicitly. Tree glyphs are left untouched so the surviving structure still
 * reads as a tree. Mirrors upstream RTK's tree filter (Apache-2.0).
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

const TREE_COMMAND_RE = /(^|[;&|]\s*)tree(?:\s|$)/
const GLYPH_RE = /[\u2500-\u257F]/
const SUMMARY_RE = /^\s*\d+\s+director(?:y|ies),\s*\d+\s+files?\s*$/
const PREFIX_RE = /^[\s\u2500-\u257F]*/
const MAX_DEPTH = 3

export const treeFilter = {
  name: 'tree',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    if (commandMatches(command, TREE_COMMAND_RE)) return true
    const glyphLines = text.split('\n').filter((line) => GLYPH_RE.test(line)).length
    return glyphLines >= 3
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const cap = configNumber(config, 'maxLines', 240, 20, 2_000)
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactTree(text, cap, maxWidth)
    } catch {
      return text
    }
  },
}

function compactTree(text, cap, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  const errors = []
  let tooDeep = 0
  let overCap = 0

  for (const line of lines) {
    if (SUMMARY_RE.test(line)) continue
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (isErrorLine(trimmed) && /^(?:tree|error|fatal):/i.test(trimmed)) {
      errors.push(truncateEnd(trimmed, maxWidth))
      continue
    }
    const prefix = PREFIX_RE.exec(line)[0]
    const depth = Math.round(prefix.length / 4)
    if (depth > MAX_DEPTH) {
      tooDeep += 1
      continue
    }
    if (kept.length >= cap) {
      overCap += 1
      continue
    }
    kept.push(truncateEnd(line.trimEnd(), maxWidth))
  }

  if (kept.length === 0) return neverWorse(errors.join('\n'), text)

  const output = [...kept]
  if (tooDeep > 0) output.push(`... (${tooDeep} entries below depth ${MAX_DEPTH} omitted)`)
  if (overCap > 0) output.push(`... (${overCap} entries omitted)`)
  output.push(...errors)

  return neverWorse(joinLines(output, trailing), text)
}
