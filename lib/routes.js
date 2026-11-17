/**
 * HTTP surface for the Web settings page.
 *
 * Mounted as a prefix route under `/api/token-lean`. By default only loopback
 * or same-origin requests are accepted; `web.allowLan` opts into LAN access.
 */

import { ENGINE_META, STYLE_LEVELS, STYLE_META } from './config.js'
import { headroomCompress } from './engines/headroom.js'
import { liteClean } from './engines/lite.js'
import { rtkCompress } from './engines/rtk/index.js'
import { STYLE_LIST } from './styles/index.js'
import { utf8Bytes } from './util.js'

const MAX_BODY = 1_000_000

export function createRoutes(options) {
  const { getState, setConfig, stats, spill } = options

  return async function handler(req, res) {
    const state = getState()
    if (!isTrusted(req, state.config.web.allowLan)) {
      return send(res, 403, { error: 'Forbidden: token-lean settings are loopback/same-origin only' })
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname.replace(/^\/api\/token-lean/, '').replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()

    try {
      if (method === 'GET' && (route === '/' || route === '/state')) {
        return send(res, 200, buildState(state, stats, spill))
      }

      if (method === 'POST' && route === '/config') {
        const patch = await readJson(req)
        const next = setConfig(patch)
        return send(res, 200, buildState({ ...state, config: next }, stats, spill))
      }

      if (method === 'POST' && route === '/preview') {
        const body = await readJson(req)
        return send(res, 200, preview(body, state.config))
      }

      if (method === 'POST' && route === '/reset-stats') {
        stats.reset()
        return send(res, 200, buildState(state, stats, spill))
      }

      if (method === 'GET' && route.startsWith('/spill/')) {
        const id = route.slice('/spill/'.length)
        const text = spill.read(id)
        if (text === undefined) return send(res, 404, { error: 'spill not found' })
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(text)
      }

      return send(res, 404, { error: `Not found: ${method} ${route}` })
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function buildState(state, stats, spill) {
  return {
    config: state.config,
    stats: stats.snapshot(),
    meta: {
      engines: ENGINE_META,
      styles: Object.fromEntries(Object.entries(STYLE_META).map(([id, meta]) => [id, { ...meta }])),
      styleLevels: STYLE_LEVELS,
      styleList: STYLE_LIST.map(({ id, label, short, levels, defaultLevel }) => ({ id, label, short, levels, defaultLevel })),
      spillDir: spill instanceof Object && typeof spill.dir === 'string' ? spill.dir : '',
    },
  }
}

/** Preview one engine against a pasted sample. */
export function preview(body, config) {
  const engine = String(body?.engine ?? '')
  const text = typeof body?.text === 'string' ? body.text : ''
  if (text.length === 0) throw new Error('text is required')
  const before = utf8Bytes(text)

  if (engine === 'lite') {
    const result = liteClean(text, config.engines.lite)
    return { engine, before, after: result.after, saved: before - result.after, text: result.text, passes: result.passes }
  }
  if (engine === 'headroom') {
    const result = headroomCompress(text, config.engines.headroom)
    if (result === undefined) return { engine, before, after: before, saved: 0, text, note: 'no uniform JSON array matched' }
    return { engine, before, after: result.after, saved: before - result.after, text: result.text, rows: result.rows }
  }
  if (engine === 'rtk') {
    const result = rtkCompress({ text, toolName: body?.toolName, args: body?.args }, config.engines.rtk)
    if (result === undefined) return { engine, before, after: before, saved: 0, text, note: 'no filter matched or no safe reduction' }
    const after = utf8Bytes(result.text)
    return { engine, before, after, saved: before - after, text: result.text, filter: result.filter }
  }
  if (engine === 'sessionDedup') {
    return {
      engine,
      before,
      after: before,
      saved: 0,
      text,
      note: 'dedup needs two identical tool results in one session; it cannot be previewed on one sample',
    }
  }
  if (engine === 'styles') {
    const prompt = buildStylePrompt(config)
    return { engine, before, after: utf8Bytes(prompt.text), text: prompt.text, styles: prompt.styles }
  }
  throw new Error(`unknown engine: ${engine}`)
}

function isTrusted(req, allowLan) {
  if (allowLan) return true
  const origin = req.headers?.origin
  const host = req.headers?.host
  if (typeof origin === 'string' && origin !== '') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  // Same-origin browser fetches (GET) carry no Origin but do carry this
  // Fetch-Metadata header; a LAN page must be able to read its own host API.
  const site = req.headers?.['sec-fetch-site']
  if (site === 'same-origin' || site === 'none') return true
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += String(chunk)
      if (raw.length > MAX_BODY) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      if (!raw || raw.trim() === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
