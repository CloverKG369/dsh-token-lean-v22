/**
 * RTK Kubernetes filter (kubectl / helm).
 *
 * `get` tables keep the header and the first rows; `describe` keeps status,
 * conditions, events and error lines; `logs` keeps warnings/errors and the tail;
 * `apply`/`rollout` keep the outcome lines. Every elision is counted.
 */

import {
  commandMatches,
  configNumber,
  isErrorLine,
  joinLines,
  linesOf,
  plural,
  textOf,
  truncateEnd,
} from './shared.js'

const K8S_COMMAND_RE = /(^|[;&|]\s*)(?:kubectl|oc|helm)\s+(?:get|describe|logs|apply|create|delete|rollout|top|events|install|upgrade|status)\b/
const TABLE_HEAD_RE = /^(?:NAME\s+READY|NAME\s+STATUS|NAME\s+TYPE|NAMESPACE\s+NAME|NAME\s+AGE|NAME\s+DESIRED)/
const TABLE_ROW_RE = /^\s*\S+\s{2,}\S+/
const DESCRIBE_KEEP_RE =
  /^(?:Name:|Namespace:|Status:|Labels:|Annotations:|Image:|State:|Reason:|Message:|Restart Count:|Conditions:|Type:|Events:|Warning|Error|Failed|FailedMount|Unhealthy|BackOff|Created container|Started container|Pulled|Pulling|Scheduled|Normal|MountVolume)/i
const LOG_KEEP_RE = /(?:error|exception|fatal|panic|traceback|failed|warning|timeout|denied|refused|OOMKilled|CrashLoopBackOff)/i
const OUTCOME_RE = /(?:configured|created|unchanged|deleted|rolled out|deployment .* successfully|release .* deployed|STATUS: deployed|Error from server|error:|cannot)/i

export const k8sFilter = {
  name: 'k8s',

  match(ctx) {
    return commandMatches(ctx.command, K8S_COMMAND_RE)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const maxRows = Math.max(5, Math.min(100, Number(config.headLines) || 25))
      const command = typeof _ctx?.command === 'string' ? _ctx.command : ''
      if (/\blogs\b/.test(command)) return compactLogs(text, maxWidth, maxRows)
      return compactK8s(text, maxWidth, maxRows, /\bdescribe\b/.test(command))
    } catch {
      return text
    }
  },
}

function compactK8s(text, maxWidth, maxRows, describe) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let header = null
  const rows = []
  let omitted = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (TABLE_HEAD_RE.test(trimmed)) {
      header = truncateEnd(line.trimEnd(), maxWidth)
      continue
    }
    if (header !== null && TABLE_ROW_RE.test(line) && !describe) {
      if (rows.length < maxRows) rows.push(truncateEnd(line.trimEnd(), maxWidth))
      else omitted += 1
      continue
    }
    if (describe ? DESCRIBE_KEEP_RE.test(trimmed) : OUTCOME_RE.test(trimmed) || isErrorLine(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (isErrorLine(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    omitted += 1
  }

  if (header !== null) kept.unshift(header, ...rows)
  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[kubectl output: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}

function compactLogs(text, maxWidth, maxRows) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let omitted = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (LOG_KEEP_RE.test(trimmed)) kept.push(truncateEnd(line.trimEnd(), maxWidth))
    else omitted += 1
  }
  const tail = lines.filter((line) => line.trim() !== '').slice(-maxRows)
  for (const line of tail) {
    const rendered = truncateEnd(line.trimEnd(), maxWidth)
    if (!kept.includes(rendered)) kept.push(rendered)
  }
  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[kubectl logs: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
