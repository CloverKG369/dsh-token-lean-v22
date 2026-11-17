/**
 * RTK build-output filter (cargo / npm / pnpm / tsc / make / maven / gradle /
 * dotnet / go).
 *
 * Keeps every error line and the compiler context that belongs to it, keeps
 * warnings (capped, with a count for the rest) and test-summary lines, and
 * drops the noisy progress machinery (`Compiling`, `Downloading`, `[====]`,
 * `> build`, ...). When the build is green — no errors or warnings — the
 * output is windowed to its head and tail instead of being emptied.
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

const BUILD_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:cargo|rustc)\s+(?:build|check|test|clippy|run)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|run|ci)|(?:npx\s+)?tsc\b|vite\s+build|webpack\b|rollup\b|esbuild\b|(?:make|cmake)\b|mvn\b|gradle|\.\/gradlew\b|dotnet\s+(?:build|test)|go\s+(?:build|test|vet))\b/
const DIAGNOSTIC_RE =
  /(?:\S+\(\d+,\d+\):\s*(?:error|warning)\s+[A-Z]+\d+|^\s*error\[[A-Z0-9]+\]|^\s*error\s+TS\d+:)/m
const FAIL_LINE_RE = /^\s*(?:[\u2715\u2717\u2718\u00d7\u25cf]|FAIL(?:ED)?\b|not ok\b|Test failed|Tests? failed|failing tests?)/i
const WARNING_RE = /\bwarn(?:ing)?\b/i
const SUMMARY_RE =
  /^(?:Found \d+ errors?|error: could not compile|Build failed|BUILD FAILED|BUILD SUCCESSFUL|FAILURE: Build failed|.*\b\d+ (?:passing|failing)\b|Tests?:\s+\d|Test Suites?:\s+\d|Time:\s+\d|Snapshots?:\s+\d|Finished\b)/i
const CONTEXT_RE = /^(?:\s+(?:at |\||\d+ \||-->|\^|~|note:|help:|=\s)|\s*-->|\s*\|)/
const NOISE_RE =
  /^(?:Compiling|Downloading|Downloaded|Updating|Locking|Adding|Fresh|Finished|Building|Installing|Preparing|Resolving|Fetching|Checking|Executing|npm notice|> )/i
const PROGRESS_RE = /(?:\[\s*[=#>-]+\s*\]|\b\d{1,3}%\s*(?:\||$))/
const WARN_CAP = 10

export const buildFilter = {
  name: 'build',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    if (commandMatches(command, BUILD_COMMAND_RE)) return true
    if (DIAGNOSTIC_RE.test(text)) return true
    // Generic "compiled output" shape: error/warning labels together with build
    // framing, so a changelog that merely lists errors is not compressed.
    const labelLines = text
      .split('\n')
      .filter((line) => /^\s*(?:error|warning)(?:\[[A-Z0-9]+\]|\s[A-Z]+\d+)?:\s/i.test(line))
    if (labelLines.length >= 2 && /(?:Compiling|BUILD (?:SUCCESSFUL|FAILED)|npm ERR|target\(s\)|Finished|webpack|Rollup|vite|tsc)/i.test(text)) {
      return true
    }
    return false
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactBuild(text, maxWidth)
    } catch {
      return text
    }
  },
}

function compactBuild(text, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let errors = 0
  let warnings = 0
  let omittedWarnings = 0
  let omittedNoise = 0
  let contextLeft = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    const isError = isErrorLine(trimmed) && !/^\s*\d+ (?:errors?|warnings?)\b/i.test(trimmed)
    const isFail = FAIL_LINE_RE.test(trimmed)
    if (isError || isFail) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      errors += 1
      contextLeft = 5
      continue
    }
    if (WARNING_RE.test(trimmed)) {
      warnings += 1
      if (warnings <= WARN_CAP) {
        kept.push(truncateEnd(line.trimEnd(), maxWidth))
        contextLeft = 4
      } else {
        omittedWarnings += 1
      }
      continue
    }
    if (SUMMARY_RE.test(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (contextLeft > 0 && CONTEXT_RE.test(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft -= 1
      continue
    }
    if (NOISE_RE.test(trimmed) || PROGRESS_RE.test(trimmed)) {
      omittedNoise += 1
      contextLeft = Math.max(0, contextLeft - 1)
      continue
    }
    // Unclassified line: keep only while it is compiler context.
    if (contextLeft > 0) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft -= 1
    } else {
      omittedNoise += 1
    }
  }

  if (errors === 0 && warnings === 0) {
    return windowSuccess(text, lines, maxWidth)
  }

  const output = [...kept]
  if (omittedWarnings > 0) output.push(`... (+${omittedWarnings} more warnings)`)
  if (omittedNoise > 0) output.push(`... (${omittedNoise} build noise lines omitted)`)
  return neverWorse(joinLines(output, trailing), text)
}

/** Green build: keep the head and the tail, elide the noisy middle. */
function windowSuccess(text, lines, maxWidth) {
  const meaningful = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (NOISE_RE.test(trimmed) || PROGRESS_RE.test(trimmed)) continue
    meaningful.push(truncateEnd(line.trimEnd(), maxWidth))
  }
  if (meaningful.length <= 16) return text
  const head = meaningful.slice(0, 5)
  const tail = meaningful.slice(-10)
  const omitted = meaningful.length - head.length - tail.length
  return neverWorse(
    joinLines([...head, `... (${omitted} lines omitted)`], text.endsWith('\n')),
    text,
  )
}
