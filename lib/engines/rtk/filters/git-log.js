/**
 * RTK `git log` filter.
 *
 * Caps the number of commits and keeps one line per commit: short hash and
 * subject (plus an ISO date when git printed one). Raw `commit <sha>` blocks,
 * `--oneline` output and `--graph --oneline` output are all understood. Bodies
 * and patches are dropped, which is where almost all of the bytes are.
 * Modelled on upstream RTK's compact log (default limit 10, Apache-2.0).
 */

import {
  commandMatches,
  commandOf,
  isErrorLine,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
  truncateEnd,
} from './shared.js'

const GIT_LOG_RE = /(^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*log\b/
const DEFAULT_LIMIT = 10
const LINE_WIDTH = 100

export const gitLogFilter = {
  name: 'git-log',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    if (commandMatches(command, GIT_LOG_RE)) return true

    // Raw `git log` blocks.
    if (/^commit [0-9a-f]{7,64}\b/m.test(text)) return true

    // `--oneline` / `--graph --oneline` shape: several short-hash lines.
    const oneline = text.split('\n').filter((line) => /^(?:[*|\\/ ]+\s*)?[0-9a-f]{7,40}\s+\S/.test(line))
    return oneline.length >= 3
  },

  apply(text, _ctx, config) {
    try {
      if (typeof text !== 'string' || text === '') return text
      const limit = Math.max(3, Math.min(DEFAULT_LIMIT, Number(config?.maxLines) || DEFAULT_LIMIT))
      return compactLog(text, limit)
    } catch {
      return text
    }
  },
}

function compactLog(text, limit) {
  const { lines, trailing } = linesOf(text)
  const errors = []
  for (const line of lines) {
    if (isErrorLine(line) && /^(?:error|fatal|warning):/i.test(line.trim())) errors.push(line.trim())
  }

  const entries = parseRawCommits(lines)
  if (entries.length === 0) {
    const oneline = compactOneline(lines, limit)
    if (oneline === undefined) return text
    const output = [...errors, ...oneline]
    return neverWorse(joinLines(output, trailing), text)
  }

  const shown = entries.slice(0, limit).map(formatEntry)
  if (entries.length > limit) {
    shown.push(`[rtk] capped at ${limit} commits; pass -n <count> for more`)
  }
  return neverWorse(joinLines([...errors, ...shown], trailing), text)
}

function parseRawCommits(lines) {
  const entries = []
  let current
  for (const line of lines) {
    const start = /^commit ([0-9a-f]{7,64})\b/.exec(line)
    if (start !== null) {
      if (current !== undefined) entries.push(current)
      current = { sha: start[1], author: '', date: '', subject: '', body: [], files: [], hunks: 0 }
      continue
    }
    if (current === undefined) continue
    const author = /^Author:\s*(.+)$/.exec(line)
    if (author !== null) {
      current.author = author[1].trim()
      continue
    }
    const date = /^Date:\s+(.+)$/.exec(line)
    if (date !== null) {
      current.date = date[1].trim()
      continue
    }
    const patchFile = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line)
    if (patchFile !== null) {
      if (current.files.length < 8) current.files.push(truncateEnd(patchFile[2], 80))
      continue
    }
    if (/^@@+ /.test(line)) {
      current.hunks += 1
      continue
    }
    if (/^Merge:\s+/.test(line)) {
      if (current.subject === '') current.subject = line.trim()
      continue
    }
    if (/^(?:index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename from|rename to|Binary files)/.test(line)) {
      continue
    }
    const indented = /^\s{4,}(.+)$/.exec(line)
    if (indented !== null) {
      const content = indented[1].trim()
      if (content !== '' && !content.startsWith('Signed-off-by:') && !content.startsWith('Co-authored-by:')) {
        current.body.push(content)
      }
      continue
    }
  }
  if (current !== undefined) entries.push(current)
  for (const entry of entries) {
    if (entry.subject === '' && entry.body.length > 0) entry.subject = entry.body[0]
  }
  return entries.filter((entry) => entry.subject !== '')
}

function formatEntry(entry) {
  const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(entry.date)
  const head = `${entry.sha.slice(0, 7)} ${entry.subject}`
  let line = truncateEnd(date !== null ? `${head} (${date[1]})` : head, LINE_WIDTH)
  if (entry.files.length > 0) {
    const more = entry.files.length > 4 ? ` +${entry.files.length - 4} files` : ''
    const hunks = entry.hunks > 0 ? ` (${entry.hunks} ${entry.hunks === 1 ? 'hunk' : 'hunks'})` : ''
    line += `\n  files: ${entry.files.slice(0, 4).join(', ')}${more}${hunks}`
  }
  return line
}

function compactOneline(lines, limit) {
  const kept = []
  let seen = 0
  let truncated = false
  for (const line of lines) {
    if (!/^(?:[*|\\/ ]+\s*)?[0-9a-f]{7,40}\s+\S/.test(line)) continue
    seen += 1
    if (seen > limit) {
      truncated = true
      continue
    }
    kept.push(truncateEnd(line.trimEnd(), LINE_WIDTH))
  }
  if (kept.length === 0) return undefined
  if (truncated) kept.push(`[rtk] capped at ${limit} commits; pass -n <count> for more`)
  return kept
}
