/**
 * Generic never-worse window used when no command-specific filter matches.
 *
 * Keeps the head and tail, preserves error-looking lines from the omitted
 * middle (with their original line numbers), truncates pathological long lines
 * and collapses runs of blank lines. The caller applies the byte gates.
 */

const ERROR_LINE = /\b(error|err|fatal|fail(?:ed|ure)?|exception|traceback|panic|timeout|timed out|denied|refused|ENOENT|EACCES|segmentation fault)\b/i

export function rtkGeneric(text, config = {}) {
  const maxLines = Math.max(20, Number(config.maxLines) || 240)
  const headLines = Math.max(1, Number(config.headLines) || 140)
  const tailLines = Math.max(0, Number(config.tailLines) || 80)
  const longLineChars = Math.max(80, Number(config.longLineChars) || 420)
  const errorLines = Math.max(0, Number(config.errorLines) || 25)

  const rawLines = text.split('\n')
  const lines = rawLines.map((line) =>
    line.length > longLineChars ? `${line.slice(0, longLineChars)} … [line truncated: ${line.length} chars]` : line,
  )

  if (lines.length <= maxLines) {
    const joined = collapseBlanks(lines)
    return joined === text ? text : joined
  }

  const head = lines.slice(0, headLines)
  const tail = lines.slice(lines.length - tailLines)
  const middle = lines.slice(headLines, lines.length - tailLines)

  const anchors = []
  if (errorLines > 0) {
    for (let index = 0; index < middle.length && anchors.length < errorLines; index += 1) {
      if (ERROR_LINE.test(middle[index])) {
        anchors.push({ offset: headLines + index, line: middle[index] })
      }
    }
  }

  const omitted = middle.length - anchors.length
  const parts = [...head]
  if (anchors.length > 0) {
    parts.push(`[... ${omitted} lines omitted; ${anchors.length} error line(s) kept below ...]`)
    for (const anchor of anchors) parts.push(`${anchor.offset + 1}: ${anchor.line}`)
  } else {
    parts.push(`[... ${middle.length} lines omitted ...]`)
  }
  parts.push(...tail)
  return collapseBlanks(parts)
}

function collapseBlanks(lines) {
  const out = []
  let blanks = 0
  for (const line of lines) {
    if (line.trim() === '') {
      blanks += 1
      if (blanks > 1) continue
    } else blanks = 0
    out.push(line)
  }
  return out.join('\n')
}
