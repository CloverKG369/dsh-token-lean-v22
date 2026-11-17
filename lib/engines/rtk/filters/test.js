/**
 * RTK test-runner filter (jest / vitest / mocha / pytest / go test / cargo test /
 * dotnet test / phpunit / rspec / Playwright).
 *
 * Test output is dominated by passing lines; this filter keeps failures, their
 * stack/assertion context and the run summary, and drops passing noise. Error
 * lines are never dropped by any path.
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

const TEST_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|jest\b|vitest\b|mocha\b|pytest\b|py\.test\b|python\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+test\b|dotnet\s+test\b|ctest\b|phpunit\b|rspec\b|playwright\s+test\b|npx\s+(?:jest|vitest|playwright)\b)/

const FAIL_RE =
  /^\s*(?:[✕✗✘×●]|FAIL(?:ED)?\b|not ok\b|Tests? failed|Test failed|failing tests?)/i
const SUMMARY_RE =
  /^(?:=+\s*(?:test session starts|short test summary|FAILURES|ERRORS)|Tests?:\s+\d|Test Suites?:\s+\d|Test Files\s+\d|Time:\s+\d|Snapshots?:\s+\d|collected \d+ items?|\d+ (?:passed|failed|skipped|xfailed|xpassed|errors?)\b|.*\b(?:passed|failed|error)\b.*\bin [\d.]+m?s\b|(?:FAILED|ERROR)\s+\S+|ok\s+\S+\s+[\d.]+m?s|(?:Passed|Failed)!\s+-|Total tests:\s+\d+|Passed:\s+\d+|Failed:\s+\d+|Skipped:\s+\d+|PASS\b|FAIL\b)/i
const SKIP_RE = /^\s*(?:[✓✔√]|PASS\b|ok\s+\S+\s+[\d.]+m?s)/i
const PASSING_NOISE_RE = /^\s*(?:\.{2,}|[.sF]+$|Running\b|RUNS\b)/i

export const testFilter = {
  name: 'test',

  match(ctx) {
    if (commandMatches(ctx.command, TEST_COMMAND_RE)) return true
    const text = textOf(ctx)
    // Shape sniff: a runner summary plus at least one pass/fail marker.
    return /(?:Test Suites?|Test Files|Tests?):\s+\d+/.test(text) && /(?:[✓✔×✕]|PASSED|FAILED)/.test(text)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      return compactTests(text, maxWidth)
    } catch {
      return text
    }
  },
}

function compactTests(text, maxWidth) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let omitted = 0
  let contextLeft = 0
  let failures = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    if (FAIL_RE.test(trimmed) || (isErrorLine(trimmed) && !SKIP_RE.test(trimmed))) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      if (FAIL_RE.test(trimmed)) failures += 1
      contextLeft = 6
      continue
    }
    if (SUMMARY_RE.test(trimmed)) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (contextLeft > 0) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      contextLeft -= 1
      continue
    }
    if (SKIP_RE.test(trimmed) || PASSING_NOISE_RE.test(trimmed)) {
      omitted += 1
      continue
    }
    omitted += 1
  }

  if (kept.length === 0) return text
  if (omitted > 0) kept.push(`[test output: ${plural(omitted, 'line')} omitted; ${plural(failures, 'failure')} kept]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
