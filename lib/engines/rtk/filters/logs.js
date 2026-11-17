/**
 * RTK log filter.
 *
 * Collapses repeated log lines — normalised across timestamps, UUIDs, hex
 * literals, long numbers and paths — into one line with an explicit `(xN)`
 * count, while keeping every distinct line and every error line. Blank runs are
 * collapsed and the result is capped, with errors exempt from the cap.
 * Inspired by upstream RTK's `log` analyzer (Apache-2.0); the marker is `(xN)`
 * here so the count reads as part of the message.
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

const LOG_COMMAND_RE =
  /(^|[;&|]\s*)(?:tail|journalctl|docker\s+logs|kubectl\s+logs|podman\s+logs|Get-Content|Get-EventLog|cat)\b/
const LOG_FILE_RE = /\.(?:log|log\.\d+|out|err)(?:\s|$)/i
const TIMESTAMP_RE = /^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s*/
const BRACKET_TIME_RE = /^\[\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]\s*/
const SYSLOG_RE = /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s/
const LEVEL_RE = /^(?:\[[A-Z]+\]|[A-Z]{4,8}\s|\d{4}.*\b(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\b)/

export const logFilter = {
  name: 'logs',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    const shaped = looksLikeLog(text)
    if (commandMatches(command, LOG_COMMAND_RE)) {
      if (shaped) return true
      return LOG_FILE_RE.test(command)
    }
    return shaped
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const cap = configNumber(config, 'maxLines', 240, 20, 2_000)
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactLogs(text, cap, maxWidth)
    } catch {
      return text
    }
  },
}

function looksLikeLog(text) {
  let timestamps = 0
  let levels = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (TIMESTAMP_RE.test(trimmed) || BRACKET_TIME_RE.test(trimmed) || SYSLOG_RE.test(trimmed)) timestamps += 1
    if (LEVEL_RE.test(trimmed)) levels += 1
  }
  return timestamps >= 3 || levels >= 3
}

function normalize(line) {
  let value = line
  value = value.replace(TIMESTAMP_RE, '')
  value = value.replace(BRACKET_TIME_RE, '')
  value = value.replace(SYSLOG_RE, '')
  value = value.replace(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
    '<UUID>',
  )
  value = value.replace(/0x[0-9a-fA-F]+/g, '<HEX>')
  value = value.replace(/\b\d{4,}\b/g, '<NUM>')
  value = value.replace(/\/[\w./\-]+/g, '<PATH>')
  return value.trim()
}

function compactLogs(text, cap, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const groups = new Map()
  let blanks = 0

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '').trimEnd()
    if (line.trim() === '') {
      blanks += 1
      continue
    }
    blanks = 0
    const key = normalize(line)
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { sample: truncateEnd(line, maxWidth), count: 1, error: isErrorLine(line) })
    } else {
      existing.count += 1
      if (isErrorLine(line)) existing.error = true
    }
  }

  const entries = [...groups.values()]
  if (entries.length === 0) return text

  const rendered = []
  let omitted = 0
  for (const entry of entries) {
    const savings = (entry.count - 1) * entry.sample.length > 6
    if (entry.count > 1 && savings) {
      rendered.push(`${entry.sample} (x${entry.count})`)
    } else {
      for (let index = 0; index < entry.count; index += 1) rendered.push(entry.sample)
    }
  }

  let output = rendered
  if (output.length > cap) {
    const rest = output.slice(cap)
    omitted = rest.length
    output = output.slice(0, cap)
    // Errors never fall off the cap, even when the cap is otherwise full.
    for (const line of rest) if (isErrorLine(line)) output.push(line)
  }
  if (omitted > 0) output.push(`... (${omitted} unique log lines omitted)`)

  const joined = joinLines(output, trailing || blanks > 0)
  return neverWorse(joined, text)
}
