/**
 * RTK Python traceback filter (`python script.py`, `uv run`, `poetry run`).
 *
 * A traceback is mostly library frames. This keeps the exception chain, the
 * deepest frames (the ones that point into user code), and the code lines that
 * belong to them; earlier frames are elided with a count. Non-traceback output
 * is left untouched so ordinary program results are never altered.
 */

import {
  commandMatches,
  configNumber,
  joinLines,
  linesOf,
  plural,
  textOf,
  truncateEnd,
} from './shared.js'

const PYTHON_COMMAND_RE =
  /(^|[;&|]\s*)(?:(?:python3?|py)\s+(?!-m\s+(?:pytest|unittest|ruff|mypy|flake8|pylint)\b)\S|uv\s+run\b|poetry\s+run\b|pdm\s+run\b|pipenv\s+run\b)/
const TRACEBACK_RE = /Traceback \(most recent call last\):/
const FRAME_RE = /^\s*File "(.+)", line \d+, in .+$/
const EXCEPTION_RE = /^\s*(?:[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit|Fault))\b.*:?(?:\s.*)?$/
const CHAIN_RE = /^(?:During handling of the above exception|The above exception was the direct cause)/
const CODE_LINE_RE = /^\s{2,}\S/

export const pythonFilter = {
  name: 'python',

  match(ctx) {
    const text = textOf(ctx)
    if (!TRACEBACK_RE.test(text)) return false
    return commandMatches(ctx.command, PYTHON_COMMAND_RE) || /^\s*Traceback \(most recent call last\):/m.test(text)
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '' || !TRACEBACK_RE.test(text)) return text
      const maxWidth = configNumber(config, 'longLineChars', 420, 80, 2_000)
      const keepFrames = Math.max(2, Math.min(20, Number(config.errorLines) || 8))
      return compactTraceback(text, maxWidth, keepFrames)
    } catch {
      return text
    }
  },
}

function compactTraceback(text, maxWidth, keepFrames) {
  const { lines, trailing } = linesOf(text)
  const kept = []
  let block = null
  let omittedFrames = 0
  let sawTraceback = false

  const flushBlock = () => {
    if (block === null) return
    const frames = block.frames
    if (frames.length > keepFrames) {
      const drop = frames.length - keepFrames
      omittedFrames += drop
      kept.push(...frames.slice(drop).flat())
    } else {
      kept.push(...frames.flat())
    }
    kept.push(...block.tail)
    block = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    if (TRACEBACK_RE.test(trimmed)) {
      flushBlock()
      sawTraceback = true
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      block = { frames: [], tail: [] }
      continue
    }
    if (block === null) {
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (CHAIN_RE.test(trimmed)) {
      flushBlock()
      kept.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (FRAME_RE.test(line)) {
      block.frames.push([[truncateEnd(line.trimEnd(), maxWidth)]])
      continue
    }
    if (block.frames.length > 0 && CODE_LINE_RE.test(line)) {
      // The source line printed under a File frame belongs to that frame.
      block.frames[block.frames.length - 1].push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    if (EXCEPTION_RE.test(trimmed)) {
      block.tail.push(truncateEnd(line.trimEnd(), maxWidth))
      continue
    }
    block.tail.push(truncateEnd(line.trimEnd(), maxWidth))
  }
  flushBlock()

  if (!sawTraceback || kept.length === 0) return text
  if (omittedFrames > 0) kept.push(`[traceback: ${plural(omittedFrames, 'frame')} omitted; deepest frames kept]`)
  const output = joinLines(kept, trailing)
  return output.length < text.length ? output : text
}
