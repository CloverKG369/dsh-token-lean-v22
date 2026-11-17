/**
 * RTK `git status` filter.
 *
 * Collapses the verbose human status format (hints, blanks, one path per line)
 * or the porcelain format into a branch line plus one grouped line per state:
 *
 *   * main
 *   staged (2): M src/a.js  A src/b.js
 *   unstaged (1): M src/c.js
 *   untracked (4): src/x.js  src/y.js  ...
 *
 * Paths are deduplicated and capped per group with an explicit `+N more`.
 * Error lines and unmerged (conflict) paths are always preserved.
 */

import {
  commandMatches,
  commandOf,
  isErrorLine,
  joinLines,
  linesOf,
  neverWorse,
  textOf,
} from './shared.js'

const GIT_STATUS_RE = /(^|[;&|]\s*)git\s+(?:-[^\s]+\s+)*status\b/
const GROUP_CAP = 20

const SECTION_MAP = {
  'Changes to be committed': 'staged',
  'Changes not staged for commit': 'unstaged',
  'Untracked files': 'untracked',
  'Unmerged paths': 'conflicts',
}

const STATE_MARKERS = [
  ['All conflicts fixed but you are still merging', 'merge in progress, no conflicts'],
  ['You have unmerged paths', 'merge in progress, unresolved conflicts'],
  ['You are currently cherry-picking', 'cherry-pick in progress'],
  ['You are currently reverting', 'revert in progress'],
  ['You are currently bisecting', 'bisect in progress'],
  ['You are in the middle of an am session', 'am session in progress'],
  ['You are in a sparse checkout', 'sparse checkout enabled'],
  ['You are currently rebasing', 'rebase in progress'],
  ['rebase in progress', 'rebase in progress'],
  ['You are currently editing', 'rebase in progress'],
  ['You are currently splitting', 'rebase in progress'],
  ['Last command done', 'rebase in progress'],
  ['Next command to do', 'rebase in progress'],
  ['No commands remaining', 'rebase in progress'],
]

const PLAIN_STATUS = {
  modified: 'M',
  'new file': 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  'both modified': 'U',
  'both added': 'U',
  'both deleted': 'U',
  'added by us': 'U',
  'added by them': 'U',
  unmerged: 'U',
}

export const gitStatusFilter = {
  name: 'git-status',

  match(ctx) {
    const text = textOf(ctx)
    const command = commandOf(ctx)

    if (commandMatches(command, GIT_STATUS_RE)) return true

    // Output sniffing: human status.
    if (/^On branch /m.test(text)) return true
    if (/^Changes to be committed:\s*$/m.test(text)) return true
    if (/^Changes not staged for commit:\s*$/m.test(text)) return true
    if (/^Untracked files:\s*$/m.test(text) && /\n\s{2,}\S/m.test(text)) return true
    if (/^nothing to commit/m.test(text)) return true
    // Porcelain `-b` output: a `## branch` header plus at least one XY entry.
    if (/^## /m.test(text) && /^(?:\?\?|[ MADRCU?!]{2}) \S/m.test(text)) return true
    return false
  },

  apply(text) {
    try {
      if (typeof text !== 'string' || text === '') return text
      return compactStatus(text)
    } catch {
      return text
    }
  },
}

function compactStatus(text) {
  const { lines, trailing } = linesOf(text)
  const groups = { staged: [], unstaged: [], untracked: [], conflicts: [] }
  const seen = { staged: new Set(), unstaged: new Set(), untracked: new Set(), conflicts: new Set() }
  const extra = []
  let branch = ''
  let section = ''
  let clean = false
  let parsedAnything = false

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (trimmed === '') continue

    // Branch and repository-state headers.
    const onBranch = /^On branch (.+)$/.exec(trimmed)
    if (onBranch !== null) {
      branch = onBranch[1].trim()
      parsedAnything = true
      continue
    }
    const porcelainBranch = /^## (.+)$/.exec(trimmed)
    if (porcelainBranch !== null) {
      branch = porcelainBranch[1].trim()
      parsedAnything = true
      continue
    }
    if (/^Your branch is /.test(trimmed) || /^HEAD detached /.test(trimmed)) {
      extra.push(trimmed)
      parsedAnything = true
      continue
    }
    const state = STATE_MARKERS.find(([needle]) => trimmed.includes(needle))
    if (state !== undefined) {
      if (!extra.includes(state[1])) extra.push(state[1])
      continue
    }
    if (/^nothing to commit/i.test(trimmed) || /^working tree clean/i.test(trimmed)) {
      clean = true
      parsedAnything = true
      continue
    }
    if (/^no changes added to commit/i.test(trimmed)) continue

    // Hints are pure noise.
    if (
      trimmed.startsWith('(use "git') ||
      trimmed.startsWith('(create/copy files') ||
      trimmed.includes('(use "git add') ||
      trimmed.includes('(use "git restore')
    ) {
      continue
    }

    if (isErrorLine(trimmed) && /^(?:error|fatal|warning):/i.test(trimmed)) {
      extra.push(trimmed)
      continue
    }

    const sectionHeader = /^(.+):\s*$/.exec(trimmed)
    if (sectionHeader !== null && SECTION_MAP[sectionHeader[1]] !== undefined) {
      section = SECTION_MAP[sectionHeader[1]]
      parsedAnything = true
      continue
    }

    // Human format entry: `modified:   path` (tab-indented in real output).
    const plain = /^([a-z][a-z ]*):\s+(.+)$/.exec(trimmed)
    if (plain !== null && section !== '' && PLAIN_STATUS[plain[1]] !== undefined) {
      addEntry(section, `${PLAIN_STATUS[plain[1]]} ${plain[2].trim()}`, groups, seen)
      continue
    }

    // Porcelain entry: two status columns then a space then the path.
    const porcelain = /^([ MADRCU?!]{1,2}) (.+)$/.exec(raw.replace(/\r$/, ''))
    if (porcelain !== null && section === '') {
      const status = porcelain[1].padEnd(2, ' ').slice(0, 2)
      const path = porcelain[2].trim()
      const [x, y] = status
      if (x === '?' || y === '?') addEntry('untracked', `? ${path}`, groups, seen)
      else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
        addEntry('conflicts', `U ${path}`, groups, seen)
      } else {
        if (x !== ' ' && x !== '!') addEntry('staged', `${x} ${path}`, groups, seen)
        if (y !== ' ' && y !== '!') addEntry('unstaged', `${y} ${path}`, groups, seen)
      }
      parsedAnything = true
      continue
    }

    if (section !== '') {
      const prefix = section === 'untracked' ? '?' : section === 'conflicts' ? 'U' : 'M'
      addEntry(section, `${prefix} ${trimmed}`, groups, seen)
      parsedAnything = true
      continue
    }

    // Anything else (e.g. `nothing added to commit but untracked files present`)
    if (!/^nothing added to commit/i.test(trimmed)) extra.push(trimmed)
  }

  if (!parsedAnything) return text

  const output = []
  if (branch !== '') output.push(`* ${branch}`)
  for (const line of extra) output.push(line)

  const order = [
    ['staged', 'staged'],
    ['unstaged', 'unstaged'],
    ['untracked', 'untracked'],
    ['conflicts', 'conflicts'],
  ]
  for (const [key, label] of order) {
    const entries = groups[key]
    if (entries.length === 0) continue
    const shown = entries.slice(0, GROUP_CAP)
    const suffix = entries.length > GROUP_CAP ? `  +${entries.length - GROUP_CAP} more` : ''
    output.push(`${label} (${entries.length}): ${shown.join('  ')}${suffix}`)
  }

  if (clean && groups.staged.length + groups.unstaged.length + groups.untracked.length + groups.conflicts.length === 0) {
    output.push('clean — nothing to commit')
  }

  return neverWorse(joinLines(output, trailing), text)
}

function addEntry(section, entry, groups, seen) {
  if (seen[section].has(entry)) return
  seen[section].add(entry)
  groups[section].push(entry)
}
