/**
 * RTK lint/type-check filter (ruff / mypy / flake8 / pylint / sqlfluff /
 * dotnet format / eslint / black / isort).
 *
 * Keeps every diagnostic and the final count; drops headers, progress and the
 * "file unchanged" chatter. Diagnostics are capped so a huge lint run cannot
 * keep more than `maxLines` entries; the spill still holds the original.
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

const LINT_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:ruff\s+(?:check|format))|mypy\b|flake8\b|pylint\b|sqlfluff\s+(?:lint|format)|dotnet\s+format\b|eslint\b|black\s+--check\b|isort\s+--check(?:-only)?\b)/

const DIAG_RE =
  /^(?:\S+\.(?:py|pyi|ts|tsx|js|jsx|cs|sql|cfg|ini|toml):\d+(?::\d+)?:|\S+\(\d+,\d+\):)\s*(?:\[[A-Z]+\d+\]\s*)?(?:error|warning|[A-Z]\d+|E\d+|W\d+|C\d+|F\d+|R\d+)/i
const SUMMARY_RE =
  /^(?:Found \d+ (?:errors?|issues)|Success: no issues|All checks passed|.*\d+ files? (?:would be )?(?:reformatted|already formatted|left unchanged|unchanged)|.*\d+ (?:errors?|warnings?|issues?).*|Checked \d+ files?|\d+ files? remained unchanged|\d+ files? reformatted|\d+ errors?)/i
const NOISE_RE = /^(?:\[?\s*[=#>-]+\s*\]?|\s*\d{1,3}%\s*|\s*$|Downloading|Resolved|Building|Compiling)/i
const MAX_DIAGNOSTICS = 200

export const lintFilter = {
  name: 'lint',

  match(ctx) {
    return commandMatches(ctx.command, LINT_COMMAND_RE)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const maxLines = configNumber(config, 'maxLines', 160, 20, 100_000)
      return compactLint(text, maxWidth, Math.min(maxLines, MAX_DIAGNOSTICS))
    } catch {
      return text
    }
  },
}

function compactLint(text, maxWidth, cap) {
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
    if (DIAG_RE.test(trimmed) || SUMMARY_RE.test(trimmed) || isErrorLine(trimmed)) {
      if (kept.length < cap) kept.push(truncateEnd(line.trimEnd(), maxWidth))
      else omitted += 1
      continue
    }
    omitted += 1
  }

  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[lint output: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
