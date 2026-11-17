/**
 * Shared helpers for the RTK filter family.
 *
 * Every helper here is pure, dependency-free and defensive: filters receive
 * arbitrary tool output (binary-ish text, lone surrogates, CRLF, ANSI escapes),
 * so nothing may throw and no output may ever be larger than its input.
 */

/** Lines that carry an actionable failure — never dropped by any filter path. */
export const ERROR_LINE_RE =
  /\b(?:error|err|fatal|fail(?:ed|ure|ures|ing)?|exception|traceback|panic|timeout|timed out|denied|refused|ENOENT|EACCES|segmentation fault|not found|no such file|assertionerror)\b/i

/** True when a line looks like an actionable failure. */
export function isErrorLine(line) {
  return typeof line === 'string' && ERROR_LINE_RE.test(line)
}

/** Extract the shell command a tool ran (context may carry it or only the args). */
export function commandOf(input) {
  if (input === null || typeof input !== 'object') return ''
  if (typeof input.command === 'string' && input.command.trim() !== '') return input.command.trim()
  const args = input.args
  if (args === null || typeof args !== 'object') return ''
  for (const key of ['command', 'cmd', 'script', 'commandLine', 'shellCommand']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/** The text a context carries, without a UTF-8 BOM some Windows tools prepend. */
export function textOf(input) {
  if (input === null || typeof input !== 'object' || typeof input.text !== 'string') return ''
  return input.text.replace(/^\uFEFF/, '')
}

/** Strip a UTF-8 BOM from a string. */
export function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : ''
}

/** Clamp a numeric config value. */
export function configNumber(config, key, fallback, min, max) {
  const raw = config === null || typeof config !== 'object' ? undefined : config[key]
  const value = typeof raw === 'number' ? raw : Number(raw)
  const base = Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, base))
}

/**
 * Split text into lines without a phantom trailing empty line, remembering
 * whether the source ended with a newline so it can be restored.
 */
export function linesOf(text) {
  const source = stripBom(typeof text === 'string' ? text : '')
  const lines = source.split('\n')
  const trailing = source.endsWith('\n')
  if (trailing && lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return { lines, trailing }
}

/** Join already-filtered lines, restoring the original trailing newline. */
export function joinLines(lines, trailing) {
  const body = lines.join('\n')
  return trailing && body !== '' ? `${body}\n` : body
}

/** Character-safe end truncation with an ellipsis. */
export function truncateEnd(line, max) {
  if (typeof line !== 'string' || max <= 0 || line.length <= max) return line
  if (max <= 3) return line.slice(0, max)
  return `${line.slice(0, max - 3)}...`
}

/** Never-worse guard: a filter may shrink output, never grow it. */
export function neverWorse(output, input) {
  if (typeof output !== 'string' || output.length === 0) return input
  return output.length < input.length ? output : input
}

/** Case-insensitive "the command invokes this tool" test. */
export function commandMatches(command, regex) {
  return typeof command === 'string' && command !== '' && regex.test(command)
}

/** Plural helper for notes. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
