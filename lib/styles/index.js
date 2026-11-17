/**
 * Output styles: five independent prompt sections assembled into the model's
 * system prompt for the next request.
 *
 * Each style is a fixed upstream preset (see the module header for its source
 * and license). The user chooses only whether it is active and, where upstream
 * defines them, which level applies. There is no prompt-editing path.
 */

import { STYLE_IDS, STYLE_META } from '../config.js'
import { cavemanStyle } from './caveman.js'
import { yagniStyle } from './yagni.js'
import { ponytailStyle } from './ponytail.js'
import { adhdStyle } from './adhd.js'
import { antislopStyle } from './antislop.js'

const MODULES = {
  caveman: cavemanStyle,
  yagni: yagniStyle,
  ponytail: ponytailStyle,
  adhd: adhdStyle,
  antislop: antislopStyle,
}

/** Public metadata for the settings UI (read-only preset text included). */
export const STYLE_LIST = STYLE_IDS.map((id) => {
  const module = MODULES[id]
  const texts = {}
  for (const level of module.levels) texts[level] = module.text(level)
  return {
    id,
    ...STYLE_META[id],
    levels: module.levels,
    defaultLevel: module.defaultLevel,
    texts,
  }
})

/** Resolve one style's shipped text for the configured level. */
export function styleText(id, config = {}) {
  const module = MODULES[id]
  if (module === undefined) return ''
  const level = module.levels.includes(config.level) ? config.level : module.defaultLevel
  return module.text(level).trim()
}

/**
 * Build the single system-prompt section containing every enabled style.
 * @param {object} config resolved plugin configuration
 * @returns {{text: string, styles: string[]}}
 */
export function buildStylePrompt(config) {
  const enabled = []
  for (const id of config.styleOrder ?? STYLE_IDS) {
    const entry = config.styles?.[id]
    if (!entry?.enabled) continue
    const text = styleText(id, entry)
    if (text === '') continue
    enabled.push({ id, level: entry.level, text })
  }
  if (enabled.length === 0) return { text: '', styles: [] }

  const header =
    'The user enabled the following output disciplines for this session. ' +
    'They change form and density only: never drop required facts, code, commands, proof, risks or authorization boundaries. ' +
    'If a rule conflicts with an explicit user request, the user request wins.'

  const blocks = enabled.map(
    (entry) =>
      `<!-- token-lean:style:${entry.id}:${entry.level} -->\n${entry.text}\n<!-- /token-lean:style:${entry.id} -->`,
  )

  return { text: `${header}\n\n${blocks.join('\n\n')}`, styles: enabled.map((entry) => entry.id) }
}

export { cavemanStyle, yagniStyle, ponytailStyle, adhdStyle, antislopStyle }
