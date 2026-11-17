/**
 * RTK engine entry point.
 *
 * The full command-aware filter family lives in `./filters/`; this module picks
 * the right filter for a tool call and applies the never-worse gates. It is
 * intentionally dependency-free and pure.
 */

import { rtkGeneric } from './filters/generic.js'
import { pickFilter } from './registry.js'

/**
 * @param {{text: string, toolName?: string, args?: unknown}} input
 * @param {object} config
 * @returns {{text: string, filter: string}|undefined}
 */
export function rtkCompress(input, config = {}) {
  if (!input || typeof input.text !== 'string') return undefined
  const text = input.text
  const before = Buffer.byteLength(text, 'utf8')
  if (before < (Number(config.minBytes) || 0)) return undefined

  const filter = pickFilter(input)
  if (filter !== undefined) {
    try {
      const output = filter.apply(text, input, config)
      if (typeof output === 'string' && output.length > 0 && output.length < text.length) {
        return gate(output, before, config, filter.name)
      }
    } catch {
      // fall through to the generic window
    }
  }

  const generic = rtkGeneric(text, config)
  if (typeof generic === 'string' && generic.length > 0 && generic.length < text.length) {
    return gate(generic, before, config, 'generic')
  }
  return undefined
}

function gate(output, before, config, filter) {
  const after = Buffer.byteLength(output, 'utf8')
  const keepRatioMax = Number(config.keepRatioMax) || 0.72
  if (after >= before || after > before * keepRatioMax) return undefined
  return { text: output, filter }
}
