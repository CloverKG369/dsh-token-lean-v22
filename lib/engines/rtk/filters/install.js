/**
 * RTK package-install filter (npm / pnpm / yarn / bun / pip / uv / cargo /
 * go mod / dotnet restore / composer / gem).
 *
 * Install output is mostly progress and download noise; this filter keeps
 * errors, warnings, vulnerability lines and the final package summary.
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

const INSTALL_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci)\b|pip3?\s+install\b|uv\s+(?:add|sync|pip\s+install)\b|poetry\s+(?:install|add|update)\b|pdm\s+(?:install|add)\b|cargo\s+(?:install|fetch)\b|go\s+(?:mod\s+download|get)\b|dotnet\s+(?:restore|add\s+package)\b|composer\s+(?:install|require)\b|gem\s+install\b)/

const KEEP_RE =
  /(?:ERR!|error|warn(?:ing)?|vulnerabilit|audited|added \d+|removed \d+|changed \d+|packages? in \d+|Successfully installed|Installing collected packages|Requirement already satisfied|Resolved \d+ packages?|Downloaded \d+|Installed \d+|Restored \S+)/i
const NOISE_RE =
  /^(?:Progress|Downloading|Downloaded|Fetching|Resolving|Resolved|Locking|Updating|Adding|Preparing|Building|Compiling|Installing|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|\[?\s*[=#>-]+\s*\]?|\s*\d{1,3}%\s*)/i

export const installFilter = {
  name: 'install',

  match(ctx) {
    return commandMatches(ctx.command, INSTALL_COMMAND_RE)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactInstall(text, maxWidth)
    } catch {
      return text
    }
  },
}

function compactInstall(text, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let omitted = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (NOISE_RE.test(trimmed)) {
      omitted += 1
      continue
    }
    if (KEEP_RE.test(trimmed) || isErrorLine(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    omitted += 1
  }

  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[install output: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
