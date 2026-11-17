/**
 * Headroom: lossless tabular compaction for uniform JSON arrays.
 *
 * A homogeneous array of objects is re-encoded once as a schema header plus one
 * CSV row per element (`items[300]{id,name,price}:`). Keys appear once instead
 * of once per row, the mapping is reversible, and no value is dropped.
 *
 * It also understands the DSH `read` envelope: numbered lines
 * (`12: {...}`) inside `<content>...</content>`. For pretty-printed arrays the
 * encoder keeps each element's source line number as the first column, so the
 * model can still point at the original line; wrappers are preserved.
 */

import { utf8Bytes } from '../util.js'

const NUMBERED_LINE = /^(\s*)(\d+):[ \t]?(.*)$/

/**
 * Try to encode `text` as a tabular form.
 * @returns {{text: string, name: string, rows: number, before: number, after: number}|undefined}
 */
export function headroomCompress(text, config = {}) {
  const minRows = Math.max(2, Number(config.minRows) || 8)
  const jsonlMinLines = Math.max(2, Number(config.jsonlMinLines) || minRows)
  const maxRows = Math.max(minRows, Number(config.maxRows) || 5_000)
  const before = utf8Bytes(text)
  if (before < (Number(config.minBytes) || 0)) return undefined

  const numberedResult = tryNumbered(text, minRows, jsonlMinLines, maxRows)
  if (numberedResult !== undefined) return gate(numberedResult, config, before)

  const jsonResult = tryJson(text, minRows, maxRows)
  if (jsonResult !== undefined) return gate(jsonResult, config, before)

  const linesResult = tryJsonLines(text, jsonlMinLines, maxRows)
  if (linesResult !== undefined) return gate(linesResult, config, before)

  return undefined
}

function gate(result, config, before) {
  const after = utf8Bytes(result.text)
  const keepRatioMax = Number(config.keepRatioMax) || 0.85
  if (after >= before || after > before * keepRatioMax) return undefined
  return { ...result, before, after }
}

/** Encode a numbered DSH read block, preserving wrapper lines and line numbers. */
function tryNumbered(text, minRows, jsonlMinLines, maxRows) {
  const rawLines = text.split('\n')
  const first = rawLines.findIndex((line) => NUMBERED_LINE.test(line))
  if (first < 0) return undefined
  let last = first
  for (let index = first; index < rawLines.length; index += 1) {
    if (NUMBERED_LINE.test(rawLines[index])) last = index
  }

  const prefixLines = rawLines.slice(0, first)
  const suffixLines = rawLines.slice(last + 1)
  const block = rawLines.slice(first, last + 1)

  const stripped = []
  const lineNumbers = []
  for (const line of block) {
    const match = NUMBERED_LINE.exec(line)
    if (match === null) {
      stripped.push(line)
      lineNumbers.push(0)
    } else {
      stripped.push(match[3])
      lineNumbers.push(Number(match[2]))
    }
  }

  const numbered = parseStripped(stripped, lineNumbers, minRows, jsonlMinLines, maxRows)
  if (numbered === undefined) return undefined

  const prefix = prefixLines.length > 0 ? `${prefixLines.join('\n')}\n` : ''
  const suffix = suffixLines.length > 0 ? `\n${suffixLines.join('\n')}` : ''
  return { ...numbered, text: `${prefix}${numbered.text}${suffix}` }
}

/** Parse the prefix-stripped body as JSONL or one JSON document. */
function parseStripped(strippedLines, lineNumbers, minRows, jsonlMinLines, maxRows) {
  const nonEmpty = []
  for (let index = 0; index < strippedLines.length; index += 1) {
    if (strippedLines[index].trim() !== '') nonEmpty.push({ text: strippedLines[index], line: lineNumbers[index] })
  }
  if (nonEmpty.length === 0) return undefined

  // JSONL: every numbered line is one flat object.
  if (nonEmpty.every((entry) => entry.text.trim().startsWith('{') && entry.text.trim().endsWith('}'))) {
    const rows = []
    for (const entry of nonEmpty) {
      try {
        const value = JSON.parse(entry.text)
        if (!isPlainObject(value)) return undefined
        rows.push(value)
      } catch {
        return undefined
      }
    }
    if (rows.length < jsonlMinLines || rows.length > maxRows) return undefined
    const prepared = prepareRows(rows)
    if (prepared === undefined) return undefined
    return encode('jsonl', prepared, nonEmpty.map((entry) => entry.line))
  }

  let parsed
  try {
    parsed = JSON.parse(strippedLines.join('\n'))
  } catch {
    return undefined
  }
  const found = findArray(parsed, minRows, maxRows) ?? findKeyedMap(parsed, minRows, maxRows)
  if (found === undefined) return undefined
  if (found.depth === undefined) return encode(found.name, found, undefined)
  const starts = elementStartLines(strippedLines.join('\n'), found.depth)
  const elementLines = starts.length === found.rows.length ? starts.map((index) => lineNumbers[index] ?? 0) : undefined
  return encode(found.name, found, elementLines)
}

function tryJson(text, minRows, maxRows) {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return undefined
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }

  const found = findArray(parsed, minRows, maxRows) ?? findKeyedMap(parsed, minRows, maxRows)
  if (found === undefined) return undefined
  return encode(found.name, found, undefined)
}

function tryJsonLines(text, minRows, maxRows) {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length < minRows) return undefined
  const rows = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return undefined
    try {
      const value = JSON.parse(trimmed)
      if (!isPlainObject(value)) return undefined
      rows.push(value)
    } catch {
      return undefined
    }
  }
  if (rows.length > maxRows) return undefined
  const prepared = prepareRows(rows)
  if (prepared === undefined) return undefined
  return encode('jsonl', prepared, undefined)
}

function findArray(root, minRows, maxRows) {
  if (Array.isArray(root)) {
    const found = candidate('root', root, minRows, maxRows)
    return found === undefined ? undefined : { ...found, depth: 1 }
  }
  if (!isPlainObject(root)) return undefined

  const keys = Object.keys(root)
  if (keys.length === 1) {
    const value = root[keys[0]]
    if (Array.isArray(value)) {
      const found = candidate(keys[0], value, minRows, maxRows)
      if (found !== undefined) return { ...found, depth: 2 }
    }
    if (isPlainObject(value)) {
      const innerKeys = Object.keys(value)
      if (innerKeys.length === 1 && Array.isArray(value[innerKeys[0]])) {
        const found = candidate(`${keys[0]}.${innerKeys[0]}`, value[innerKeys[0]], minRows, maxRows)
        if (found !== undefined) return { ...found, depth: 3 }
      }
    }
  }
  return undefined
}

function candidate(name, rows, minRows, maxRows) {
  if (!Array.isArray(rows) || rows.length < minRows || rows.length > maxRows) return undefined
  const prepared = prepareRows(rows)
  if (prepared === undefined) return undefined
  return { name, keys: prepared.keys, rows: prepared.rows }
}

/** Flat-key rows, or rows flattened one-or-more levels into dotted columns. */
function prepareRows(rows) {
  const flatKeys = uniformKeys(rows)
  if (flatKeys !== undefined) return { rows, keys: flatKeys }
  const flattened = []
  for (const row of rows) {
    if (!isPlainObject(row)) return undefined
    const out = {}
    if (!flattenRow(row, '', out)) return undefined
    flattened.push(out)
  }
  const keys = uniformKeys(flattened)
  if (keys === undefined) return undefined
  return { rows: flattened, keys }
}

function flattenRow(row, prefix, out) {
  for (const [key, value] of Object.entries(row)) {
    const name = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') {
      if (!isPlainObject(value)) return false
      if (!flattenRow(value, name, out)) return false
    } else {
      out[name] = value
    }
  }
  return true
}

/** Root map whose values are uniform flat objects: one row per key. */
function findKeyedMap(root, minRows, maxRows) {
  if (!isPlainObject(root)) return undefined
  const keys = Object.keys(root)
  if (keys.length < minRows || keys.length > maxRows) return undefined
  const rows = []
  for (const key of keys) {
    const value = root[key]
    if (!isPlainObject(value)) return undefined
    const flat = {}
    if (!flattenRow(value, '', flat)) return undefined
    if (Object.hasOwn(flat, 'map_key')) return undefined
    rows.push({ map_key: key, ...flat })
  }
  const prepared = prepareRows(rows)
  if (prepared === undefined) return undefined
  if (!prepared.keys.includes('map_key')) return undefined
  return { name: 'map', keys: prepared.keys, rows: prepared.rows }
}

/** Line index (0-based, within the stripped text) where each array element starts. */
function elementStartLines(text, arrayDepth) {
  const starts = []
  let depth = 0
  let inString = false
  let escaped = false
  let line = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\n') {
      line += 1
      continue
    }
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === arrayDepth) starts.push(line)
      depth += 1
    } else if (char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return starts
}

/** Return the shared key list when every row is a flat object with the same keys. */
export function uniformKeys(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return undefined
  let keys
  for (const row of rows) {
    if (!isPlainObject(row)) return undefined
    const rowKeys = Object.keys(row)
    if (keys === undefined) keys = rowKeys
    else if (rowKeys.length !== keys.length || rowKeys.some((key) => !keys.includes(key))) return undefined
    for (const key of rowKeys) {
      const value = row[key]
      if (value !== null && typeof value === 'object') return undefined
    }
  }
  if (keys === undefined || keys.length === 0) return undefined
  for (const key of keys) if (!safeKey(key)) return undefined
  return keys
}

function safeKey(key) {
  return typeof key === 'string' && key.length > 0 && !/["',{}\[\]\n\r\t:]/.test(key)
}

function encode(name, found, lineNumbers) {
  const varyingLines =
    Array.isArray(lineNumbers) &&
    lineNumbers.length === found.rows.length &&
    lineNumbers.some((line) => line !== lineNumbers[0]) &&
    !found.keys.includes('line')
  const keys = varyingLines ? ['line', ...found.keys] : found.keys
  const lines = [`${name}[${found.rows.length}]{${keys.join(',')}}:`]
  found.rows.forEach((row, index) => {
    const cells = []
    if (varyingLines) cells.push(String(lineNumbers[index]))
    for (const key of found.keys) cells.push(cell(row[key]))
    lines.push(cells.join(','))
  })
  return { text: lines.join('\n'), name, rows: found.rows.length }
}

/** CSV-safe cell encoding that keeps null/booleans/numbers distinguishable from strings. */
export function cell(value) {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return String(value)
  const text = String(value)
  if (/[",\n\r]/.test(text) || /^(null|true|false)$/.test(text) || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Inverse of {@link cell} for one row (used by tests and future retrieval). */
export function decodeRow(line, keys) {
  const cells = parseCsvLine(line)
  const row = {}
  keys.forEach((key, index) => {
    const raw = cells[index]
    if (raw === undefined || raw === 'null') row[key] = null
    else if (raw === 'true') row[key] = true
    else if (raw === 'false') row[key] = false
    else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) row[key] = Number(raw)
    else row[key] = raw
  })
  return row
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
