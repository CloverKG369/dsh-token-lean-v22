/**
 * RTK table filter.
 *
 * For long pipe/tabular output (database dumps, `docker ps`, `psql` results),
 * keeps the header, the separator rule, a head block, a tail block and evenly
 * strided samples from the middle. Every sampled data row is prefixed with
 * `L<n>: ` where `n` is its original 1-based line number, so the agent can ask
 * for the exact rows around a value it saw.
 */

import {
  configNumber,
  isErrorLine,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
  truncateEnd,
} from './shared.js'

const HEAD_ROWS = 5
const TAIL_ROWS = 5
const STRIDE_ROWS = 5
const MIN_ROWS = 20
const SEPARATOR_RE = /^[\s|:+-]+$/

export const tableFilter = {
  name: 'table',

  match(ctx) {
    const text = textOf(ctx)
    const pipeLines = text.split('\n').filter((line) => (line.match(/\|/g)?.length ?? 0) >= 2)
    if (pipeLines.length >= 4 && looksTabular(pipeLines)) return true
    const tabLines = text.split('\n').filter((line) => (line.match(/\t/g)?.length ?? 0) >= 2)
    return tabLines.length >= 5
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactTable(text, maxWidth)
    } catch {
      return text
    }
  },
}

/**
 * True for a real pipe table: a consistent column count, plus either a rule
 * line or rows that both start and end with a pipe. This is what keeps JS
 * `a || b` lines from being mistaken for a table.
 */
function looksTabular(lines) {
  const counts = new Map()
  for (const line of lines) {
    const count = line.match(/\|/g)?.length ?? 0
    counts.set(count, (counts.get(count) ?? 0) + 1)
  }
  let dominant = 0
  for (const count of counts.values()) dominant = Math.max(dominant, count)
  if (dominant < lines.length * 0.7) return false
  if (lines.some((line) => SEPARATOR_RE.test(line.trim()) && line.includes('|'))) return true
  const framed = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length
  return framed >= 2
}

function compactTable(text, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const pipeCount = lines.filter((line) => (line.match(/\|/g)?.length ?? 0) >= 2).length
  const tabCount = lines.filter((line) => (line.match(/\t/g)?.length ?? 0) >= 2).length
  const delimiter = pipeCount >= tabCount ? '|' : '\t'
  const contains = (line) => delimiter === '|' ? line.includes('|') : line.includes('\t')

  const rows = []
  const errors = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (!contains(line)) {
      if (isErrorLine(line)) errors.push(truncateEnd(line.trim(), maxWidth))
      continue
    }
    rows.push({ index: index + 1, line: truncateEnd(line.trimEnd(), maxWidth) })
  }
  if (rows.length < MIN_ROWS) return text

  const header = rows[0]
  const separator = rows.length > 1 && SEPARATOR_RE.test(rows[1].line.trim()) ? rows[1] : undefined
  const data = rows.slice(separator !== undefined ? 2 : 1)
  if (data.length < MIN_ROWS) return text

  const head = data.slice(0, HEAD_ROWS)
  const tail = data.slice(Math.max(HEAD_ROWS, data.length - TAIL_ROWS))
  const middleStart = HEAD_ROWS
  const middleEnd = Math.max(HEAD_ROWS, data.length - TAIL_ROWS)
  const middle = data.slice(middleStart, middleEnd)

  const sampled = []
  if (middle.length > 0) {
    const slots = Math.min(STRIDE_ROWS, middle.length)
    const step = Math.max(1, Math.ceil(middle.length / slots))
    for (let offset = 0; offset < middle.length && sampled.length < slots; offset += step) {
      sampled.push(middle[offset])
    }
  }

  const seen = new Set()
  const ordered = []
  for (const row of [...head, ...sampled, ...tail]) {
    if (seen.has(row.index)) continue
    seen.add(row.index)
    ordered.push(row)
  }
  ordered.sort((a, b) => a.index - b.index)
  const omitted = rows.length - ordered.length - (separator !== undefined ? 2 : 1)

  const output = [header.line]
  if (separator !== undefined) output.push(separator.line)
  for (const row of ordered) output.push(`L${row.index}: ${row.line}`)
  if (omitted > 0) output.push(`... (${omitted} table rows omitted; strided sample)`)
  output.push(...errors)

  return neverWorse(joinLines(output, trailing), text)
}
