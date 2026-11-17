/**
 * RTK container filter (docker / podman).
 *
 * `ps`/`images` tables keep the header and the first rows; build/pull output
 * keeps errors, warnings and the final status; layer progress is dropped.
 * Nothing is removed silently: each elision carries a count.
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

const CONTAINER_COMMAND_RE = /(^|[;&|]\s*)(?:docker|podman)\s+(?:ps|images|build|pull|push|run|logs|compose|inspect|rm|rmi|exec)\b/
const TABLE_HEAD_RE = /^(?:CONTAINER ID|REPOSITORY|IMAGE\s+ID|NAME\s+IMAGE|NAME\s+COMMAND)/
const TABLE_ROW_RE = /^\s*\S+\s{2,}\S+/
const PROGRESS_RE = /^(?:[0-9a-f]{12}: |Step \d+\/\d+ :|---> |Removing intermediate container|Pulling fs layer|Waiting|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete|Digest:|Status: Downloaded|Sending build context)/i
const KEEP_RE =
  /(?:Successfully built|Successfully tagged|ERROR|error|failed|denied|not found|warning|WARNING|Unable to find image|is up-to-date|healthy|unhealthy)/i

export const containerFilter = {
  name: 'container',

  match(ctx) {
    return commandMatches(ctx.command, CONTAINER_COMMAND_RE)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const headRows = Math.max(5, Math.min(50, Number(config.headLines) || 20))
      return compactContainer(text, maxWidth, headRows)
    } catch {
      return text
    }
  },
}

function compactContainer(text, maxWidth, headRows) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let header = null
  const tableRows = []
  let omitted = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (PROGRESS_RE.test(trimmed)) {
      omitted += 1
      continue
    }
    if (TABLE_HEAD_RE.test(trimmed)) {
      header = truncateEnd(line.trimEnd(), maxWidth)
      continue
    }
    if (header !== null && TABLE_ROW_RE.test(line)) {
      if (tableRows.length < headRows) tableRows.push(truncateEnd(line.trimEnd(), maxWidth))
      else omitted += 1
      continue
    }
    if (KEEP_RE.test(trimmed) || isErrorLine(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    omitted += 1
  }

  if (header !== null) kept.unshift(header, ...tableRows)
  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[container output: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
