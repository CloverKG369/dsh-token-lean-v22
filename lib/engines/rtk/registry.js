/**
 * Filter registry for the RTK engine.
 *
 * `pickFilter` maps one tool call (name + arguments + output shape) to the most
 * specific filter available. Order matters: explicit command inspection first,
 * then tool-name hints, then output sniffing. Returning `undefined` falls back
 * to the generic window.
 */

import { gitDiffFilter } from './filters/git-diff.js'
import { gitLogFilter } from './filters/git-log.js'
import { gitStatusFilter } from './filters/git-status.js'
import { buildFilter } from './filters/build.js'
import { containerFilter } from './filters/container.js'
import { dotnetFilter } from './filters/dotnet.js'
import { findFilter } from './filters/find.js'
import { grepFilter } from './filters/grep.js'
import { installFilter } from './filters/install.js'
import { k8sFilter } from './filters/k8s.js'
import { lintFilter } from './filters/lint.js'
import { lsFilter } from './filters/ls.js'
import { logFilter } from './filters/logs.js'
import { pythonFilter } from './filters/python.js'
import { tableFilter } from './filters/table.js'
import { testFilter } from './filters/test.js'
import { toolchainFilter } from './filters/toolchain.js'
import { treeFilter } from './filters/tree.js'

const FILTERS = [
  gitDiffFilter,
  gitStatusFilter,
  containerFilter,
  k8sFilter,
  gitLogFilter,
  grepFilter,
  findFilter,
  lsFilter,
  treeFilter,
  dotnetFilter,
  testFilter,
  installFilter,
  lintFilter,
  buildFilter,
  toolchainFilter,
  pythonFilter,
  logFilter,
  tableFilter,
]

/** Extract the shell command a tool ran, when it has one. */
export function commandOf(input) {
  const args = input?.args
  if (args === null || typeof args !== 'object') return ''
  for (const key of ['command', 'cmd', 'script', 'commandLine', 'shellCommand']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

export function pickFilter(input) {
  const command = commandOf(input)
  const toolName = typeof input?.toolName === 'string' ? input.toolName.toLowerCase() : ''
  for (const filter of FILTERS) {
    try {
      if (filter.match({ ...input, command, toolName })) return filter
    } catch {
      /* a broken matcher must not disable the engine */
    }
  }
  return undefined
}

export { FILTERS }
