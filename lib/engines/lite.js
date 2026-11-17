/**
 * Lite: the always-on safe cleanup layer.
 *
 * Only transformations that cannot change meaning are applied: ANSI escapes,
 * CRLF noise, trailing whitespace, runs of blank lines and inline base64 image
 * payloads. Code indentation and line content are never reflowed.
 */

import { utf8Bytes } from '../util.js'

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const IMAGE_DATA_URL = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{200,}/gi

/**
 * Apply the enabled Lite passes.
 * @returns {{text: string, changed: boolean, before: number, after: number, passes: string[]}}
 */
export function liteClean(text, config = {}) {
  const before = utf8Bytes(text)
  const passes = []
  let out = text

  if (config.normalizeNewlines !== false) {
    const next = out.replace(/\r\n?/g, '\n')
    if (next !== out) passes.push('newlines')
    out = next
  }

  if (config.stripAnsi !== false) {
    const next = out.replace(ANSI_PATTERN, '')
    if (next !== out) passes.push('ansi')
    out = next
  }

  if (config.trimTrailingSpaces !== false) {
    const next = out.replace(/[ \t]+$/gm, '')
    if (next !== out) passes.push('trailing-spaces')
    out = next
  }

  if (config.collapseBlankLines !== false) {
    const next = out.replace(/\n{3,}/g, '\n\n')
    if (next !== out) passes.push('blank-lines')
    out = next
  }

  if (config.trimImageDataUrls !== false) {
    const next = out.replace(IMAGE_DATA_URL, (match) => {
      const bytes = utf8Bytes(match)
      return `[inline image data URL trimmed: ${bytes} bytes — use the original file or attachment if the pixels matter]`
    })
    if (next !== out) passes.push('image-data-urls')
    out = next
  }

  const after = utf8Bytes(out)
  return { text: out, changed: out !== text, before, after, passes }
}
