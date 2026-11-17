/**
 * RTK dotnet build/publish/restore filter (MSBuild output).
 *
 * Mirrors upstream `dotnet-build`: a fully clean build short-circuits to a
 * one-line summary, while warnings/errors keep their project context and the
 * final counters. Banners and restore chatter are dropped.
 */

import {
  commandMatches,
  configNumber,
  isErrorLine,
  joinLines,
  linesOf,
  textOf,
  truncateEnd,
} from './shared.js'

const DOTNET_COMMAND_RE = /(^|[;&|]\s*)dotnet\s+(?:build|publish|restore|pack|run|msbuild)\b/
const BANNER_RE =
  /^(?:Microsoft \(R\)|Copyright \(C\)|Determining projects|All projects are up-to-date for restore|Restored \S+|MSBuild version|Build Engine version)/i
const SUMMARY_RE =
  /^(?:Build succeeded\.?|Build FAILED\.?|\s*\d+ Warning\(s\)|\s*\d+ Error\(s\)|Time Elapsed|\s*\d+ Error\(s\)|\s*\d+ Warning\(s\))/i
const PROJECT_RE = /^\s*\S+ -> \S+\.(?:dll|exe|nupkg)\s*$/
const WARNING_RE = /(?:\bwarning\s+[A-Z]+\d+|\bwarning\b)/i

export const dotnetFilter = {
  name: 'dotnet',

  match(ctx) {
    if (commandMatches(ctx.command, DOTNET_COMMAND_RE)) return true
    const text = textOf(ctx)
    return /Build (?:succeeded|FAILED)\./.test(text) && /\d+ Warning\(s\)[\s\S]*\d+ Error\(s\)/.test(text)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const maxLines = configNumber(config, 'maxLines', 160, 20, 100_000)

      if (/Build succeeded\.?\s*\n\s*0 Warning\(s\)\s*\n\s*0 Error\(s\)/.test(text)) {
        return 'ok (dotnet build succeeded)'
      }
      return compactDotnet(text, maxWidth, maxLines)
    } catch {
      return text
    }
  },
}

function compactDotnet(text, maxWidth, maxLines) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let contextLeft = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (BANNER_RE.test(trimmed)) continue

    if (SUMMARY_RE.test(trimmed) || PROJECT_RE.test(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft = 2
      continue
    }
    if (isErrorLine(trimmed) || WARNING_RE.test(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft = 3
      continue
    }
    if (contextLeft > 0) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft -= 1
      continue
    }
    // Unclassified MSBuild noise (target lines, restore messages).
    contextLeft = 0
  }

  if (kept.length === 0) return text
  const output = kept.length > maxLines
    ? joinLines(
        [
          ...kept.slice(0, Math.max(1, maxLines - 5)),
          `[... ${kept.length - maxLines} lines omitted ...]`,
          ...kept.slice(-4),
        ],
        trailing,
      )
    : joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
