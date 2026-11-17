/**
 * RTK JVM / PHP / Ruby / Scala toolchain filter.
 *
 * Command families whose output is a mix of build/test progress and a final
 * verdict: mvn, gradle, sbt, phpunit, composer, artisan, rspec/rails/rake.
 * Keeps errors, warnings, test counts and the verdict; drops download/progress
 * chatter. Commands outside these families are untouched.
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

const TOOLCHAIN_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:mvn|mvnw|gradle|gradlew|sbt)\b|phpunit\b|composer\s+(?:install|update|require|dump-autoload)\b|artisan\s+\S+|(?:bundle|rails|rake)\s+\S+|rspec\b)/

const KEEP_RE =
  /(?:BUILD SUCCESS|BUILD FAILURE|BUILD SUCCESSFUL|BUILD FAILED|Tests run:|Tests:|OK \(|FAILURES!|examples?,|Finished in|\[error\]|\[success\]|Total time|Successfully|Could not|Unable to|No such|not found|denied|refused|Failed|FAIL|Error|Exception|warning|ActiveRecord::|LoadError|NameError|NoMethodError|RuntimeError|Migrations are pending|rake aborted)/i
const NOISE_RE =
  /^(?:\[INFO\] (?:Downloading|Downloaded|Progress|Scanning|Building|Copying|Installing|Fetching|Resolving)|\[info\] (?:Resolving|Fetching|Compiling|Updating|Done updating|Loading|welcome)|Downloading|Downloaded|Progress|Resolving dependencies|Fetching|Installing|Using |Compiling|Dload|---> |Removing intermediate|Getting |Preparing |Unpacking )/i

export const toolchainFilter = {
  name: 'toolchain',

  match(ctx) {
    return commandMatches(ctx.command, TOOLCHAIN_COMMAND_RE)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const maxLines = configNumber(config, 'maxLines', 160, 20, 100_000)
      return compactToolchain(text, maxWidth, maxLines)
    } catch {
      return text
    }
  },
}

function compactToolchain(text, maxWidth, maxLines) {
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
  if (kept.length > maxLines) {
    const dropped = kept.length - maxLines
    omitted += dropped
    kept.splice(maxLines - 4, dropped)
  }
  if (omitted > 0) kept.push(`[toolchain output: ${plural(omitted, 'line')} omitted]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
