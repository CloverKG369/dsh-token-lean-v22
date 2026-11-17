/**
 * RTK `git diff` filter.
 *
 * Keeps the evidence a reviewer needs — one file header per changed file, every
 * `@@` hunk header, the change lines nearest the hunk start, and a per-file
 * `+N -M` tally — while sampling long hunks and stopping after a line budget.
 * Modelled on `compact_diff` in the upstream Rust RTK (Apache-2.0), ported to
 * dependency-free JS.
 */

import {
  commandMatches,
  commandOf,
  configNumber,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
  truncateEnd,
} from './shared.js'

const GIT_DIFF_RE = /(^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*diff\b/
const GIT_SHOW_RE = /(^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*show\b/
const GIT_LOG_PATCH_RE = /(^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*log\b.*(?:\s-\w*p\w*|\s--patch)\b/
const DIFF_SECTION_RE = /^diff --(?:git|cc|combined)\b/m
const HUNK_RE = /^@@+ /m
const UNIFIED_HEADER_RE = /^--- [^\n]+$/m
const MAX_HUNK_LINES = 100

export const gitDiffFilter = {
  name: 'git-diff',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    // A `git log -p` stream starts with commit metadata; git-log owns that
    // shape (it keeps the subject and a per-commit patch summary).
    const logShaped = /^commit [0-9a-f]{7,64}\b/m.test(text)
    if (logShaped) return false

    if (commandMatches(command, GIT_DIFF_RE)) return true
    if (commandMatches(command, GIT_SHOW_RE) && HUNK_RE.test(text)) return true
    if (commandMatches(command, GIT_LOG_PATCH_RE) && HUNK_RE.test(text)) return true

    if (DIFF_SECTION_RE.test(text)) return true
    // Plain `diff -u` output: no git metadata, but the same hunk shape.
    if (UNIFIED_HEADER_RE.test(text) && HUNK_RE.test(text) && /\n\+\+\+ [^\n]+/.test(text)) return true
    return false
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const maxLines = configNumber(config, 'maxLines', 240, 40, 5_000)
      return compactDiff(text, maxLines)
    } catch {
      return text
    }
  },
}

/** Parse `@@ -a,b +c,d @@` (and combined `@@@ -a,b -c,d +e,f @@@`) headers. */
function parseHunkHeader(line) {
  const marker = /^(@{2,}) /.exec(line)
  if (marker === null) return undefined
  const atRun = marker[1].length
  const body = line.slice(atRun).split('@')[0]
  const parents = []
  let newCount
  for (const group of body.split(/\s+/)) {
    if (!group.startsWith('-') && !group.startsWith('+')) continue
    const rest = group.slice(1)
    const comma = rest.indexOf(',')
    const rawCount = comma === -1 ? 1 : Number.parseInt(rest.slice(comma + 1), 10)
    if (!Number.isFinite(rawCount) || rawCount < 0) return undefined
    if (group.startsWith('-')) parents.push(rawCount)
    else newCount = rawCount
  }
  const width = atRun - 1
  while (parents.length < width) parents.push(Number.MAX_SAFE_INTEGER)
  return { parents, newCount: newCount ?? 0, width }
}

function hunkConsume(hunk, markers) {
  let consumesNew = false
  const width = Math.min(hunk.width, markers.length)
  for (let index = 0; index < width; index += 1) {
    const marker = markers[index]
    if (marker === '-') {
      if (hunk.parents[index] > 0) hunk.parents[index] -= 1
    } else if (marker === '+') {
      consumesNew = true
    } else if (marker === ' ') {
      if (hunk.parents[index] > 0) hunk.parents[index] -= 1
      consumesNew = true
    }
  }
  if (consumesNew && hunk.newCount > 0) hunk.newCount -= 1
}

function hunkExhausted(hunk) {
  return hunk.newCount <= 0 && hunk.parents.every((count) => count <= 0)
}

function unquotePath(raw) {
  let value = raw
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    value = value.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\t/g, '\t')
  }
  return value
}

/** Compress a diff to headers + sampled hunk bodies. */
export function compactDiff(diff, maxLines) {
  const { lines, trailing } = linesOf(diff)
  const result = []
  let file = ''
  let added = 0
  let removed = 0
  let hunk
  let hunkShown = 0
  let gitSections = false
  let skippedAdd = 0
  let skippedDel = 0
  let leading = []
  let leadingTotal = 0
  let truncated = false
  const maxLeading = 3
  const leadingCap = Math.max(1, Math.floor(maxLines / 10))

  const flushLeading = () => {
    const room = Math.max(0, leadingCap - leadingTotal)
    const keep = Math.min(leading.length, room)
    const skip = leading.length - keep
    for (const context of leading.slice(skip)) result.push(context)
    leadingTotal += keep
    leading = []
  }

  const flushTruncation = () => {
    if (skippedDel === 0 && skippedAdd === 0) return
    const parts = []
    if (skippedDel > 0) parts.push(`${skippedDel} ${skippedDel === 1 ? 'deletion' : 'deletions'}`)
    if (skippedAdd > 0) parts.push(`${skippedAdd} ${skippedAdd === 1 ? 'addition' : 'additions'}`)
    result.push(`  ... (${parts.join(', ')} truncated)`)
    truncated = true
    skippedDel = 0
    skippedAdd = 0
  }

  const flushFileStats = () => {
    if (file !== '' && (added > 0 || removed > 0)) result.push(`  +${added} -${removed}`)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (DIFF_SECTION_RE.test(line)) {
      gitSections = true
      flushLeading()
      flushTruncation()
      flushFileStats()
      file = diffHeaderPath(line)
      result.push(`\n${file}`)
      added = 0
      removed = 0
      hunk = undefined
      hunkShown = 0
    } else if (HUNK_RE.test(line)) {
      const parsed = parseHunkHeader(line)
      if (parsed === undefined) {
        hunk = undefined
        continue
      }
      flushLeading()
      flushTruncation()
      hunk = parsed
      hunkShown = 0
      result.push(line)
    } else if (hunk !== undefined) {
      if (hunkExhausted(hunk)) {
        // The hunk closed on the previous line: reprocess this one, because a
        // plain-unified-diff file header (`--- a/x`) may start here.
        hunk = undefined
        index -= 1
        continue
      }
      if (line.startsWith('\\')) continue // "\ No newline at end of file"

      const width = Math.min(hunk.width, line.length)
      const markers = line.slice(0, width)
      const isAdd = markers.includes('+')
      const isDel = markers.includes('-')
      hunkConsume(hunk, markers)

      if (isAdd || isDel) {
        if (isAdd) added += 1
        if (isDel) removed += 1
        if (hunkShown < MAX_HUNK_LINES) {
          flushLeading()
          result.push(line)
          hunkShown += 1
        } else if (isDel) skippedDel += 1
        else skippedAdd += 1
        leading = []
      } else if (hunkShown > 0) {
        if (hunkShown < MAX_HUNK_LINES) {
          result.push(line)
          hunkShown += 1
        }
      } else if (leadingTotal < leadingCap) {
        if (leading.length === maxLeading) leading.shift()
        leading.push(line)
      }

      if (hunkExhausted(hunk)) {
        hunk = undefined
        flushLeading()
      }
    } else if (
      !gitSections &&
      UNIFIED_HEADER_RE.test(line) &&
      index + 1 < lines.length &&
      /^\+\+\+ [^\n]+$/.test(lines[index + 1])
    ) {
      // Plain unified diff: emit the post-image path as the file header.
      flushTruncation()
      flushFileStats()
      file = unquotePath(lines[index + 1].slice(4).replace(/^b\//, ''))
      result.push(`\n${file}`)
      added = 0
      removed = 0
      index += 1
    }

    if (result.length - leadingTotal >= maxLines) {
      result.push('\n... (more changes truncated)')
      truncated = true
      break
    }
  }

  flushLeading()
  flushTruncation()
  flushFileStats()
  if (truncated) result.push('[diff truncated: the full original is in the spill file named above]')

  let output = result.join('\n')
  if (output.startsWith('\n')) output = output.slice(1)
  output = joinLines(output.split('\n'), trailing)
  return neverWorse(output, diff)
}

function diffHeaderPath(line) {
  let rest = line.replace(/^diff --(?:git|cc|combined)\s+/, '')
  if (rest.startsWith('a/') || rest.startsWith('b/')) rest = rest.slice(2)
  const separator = rest.lastIndexOf(' b/')
  const target = separator === -1 ? rest : rest.slice(separator + 3)
  return truncateEnd(unquotePath(target.trim()), 200)
}
