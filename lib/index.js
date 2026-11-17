/**
 * dsh-token-lean — one DeepSeek Harness plugin for nine token-efficiency
 * features, with a per-feature Web settings page.
 *
 * Input engines (tool-result compression):
 *   1. session-dedup   byte-identical replay elision
 *   2. lite            lossless whitespace / ANSI / image-data cleanup
 *   3. headroom        lossless tabular JSON compaction
 *   4. rtk             command-aware filtering
 *
 * Output styles (system-prompt sections):
 *   5. caveman   6. yagni   7. ponytail   8. adhd   9. antislop
 *
 * Every compression is reversible: the original text is spilled to disk and
 * named in the notice. Every failure is fail-open: the original result wins.
 */

import { ConfigStore, DEFAULTS, ENGINE_META, STYLE_META, resolveConfig } from './config.js'
import { createPipeline } from './engines/index.js'
import { SessionDeduper } from './engines/session-dedup.js'
import { createRoutes } from './routes.js'
import { SpillStore } from './spill.js'
import { StatsStore } from './stats.js'
import { buildStylePrompt } from './styles/index.js'
import { deepMerge, isAlreadyCompressed, readTextContent, textContent, utf8Bytes } from './util.js'

export const name = 'token-lean'
export const inject = ['tools']

const schema = {
  '~standard': {
    version: 1,
    vendor: 'dsh-token-lean',
    validate(input) {
      if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
        return { issues: [{ message: 'Expected configuration to be an object' }] }
      }
      return { value: input ?? {} }
    },
  },
  name: 'TokenLeanConfig',
  validate(input) {
    return input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  },
  resolve: (input) => resolveConfig(input),
}

export const Config = schema

export async function apply(ctx, rawConfig = {}) {
  const deploymentDefaults = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {}
  const configStore = new ConfigStore()
  const deduper = new SessionDeduper()
  const spill = new SpillStore()
  const stats = new StatsStore()

  let config = configStore.load(deploymentDefaults)
  deduper.configure(config.engines.sessionDedup)
  spill.setMaxBytes(config.spill.maxBytes)
  spill.setKeepFiles(config.spill.keepFiles)

  const state = { config }

  const getState = () => state
  const setConfig = (patch) => {
    const merged = deepMerge(state.config, patch && typeof patch === 'object' ? patch : {})
    state.config = resolveConfig(merged)
    deduper.configure(state.config.engines.sessionDedup)
    spill.setMaxBytes(state.config.spill.maxBytes)
    spill.setKeepFiles(state.config.spill.keepFiles)
    configStore.save(state.config)
    return state.config
  }

  const pipeline = createPipeline({
    getConfig: () => state.config,
    deduper,
    spill,
    stats,
    log: (message) => ctx.logger?.warn?.(`token-lean: ${message}`),
  })

  // 1) Input engines at the tool-result boundary.
  ctx.on(
    'tools/post-execute',
    async (exec, result, next) => {
      let decision
      try {
        decision = await next()
      } catch (error) {
        throw error
      }
      try {
        if (!state.config.master) return decision
        if (decision === undefined || decision.kind === 'block') return decision
        if (Object.hasOwn(decision, 'value')) return decision
        if (Object.hasOwn(decision, 'content')) return decision
        if (result === undefined || result === null) return decision
        const isError = result.isError === true

        const text = readTextContent(result.content)
        if (text === undefined || text.length < 200) return decision
        if (isAlreadyCompressed(text)) return decision
        if (isError) {
          // Failed outputs carry the debugging evidence: only compact them once
          // they are large enough to be worth the risk (upstream errorMinBytes).
          const errorMin = Number(state.config.engines.rtk?.errorMinBytes)
          if (Number.isFinite(errorMin) && errorMin > 0 && utf8Bytes(text) < errorMin) return decision
        }

        const toolName = exec?.name ?? exec?.tool?.name
        if (toolName === 'lean_expand') return decision
        const sessionId = exec?.agent?.session?.id ?? exec?.agent?.id
        const outcome = await pipeline({ text, toolName, args: exec?.arguments, sessionId })
        if (!outcome.changed || outcome.text.length >= text.length) return decision
        return { ...decision, content: textContent(outcome.text) }
      } catch (error) {
        ctx.logger?.warn?.(`token-lean: post-execute failed: ${error instanceof Error ? error.message : String(error)}`)
        return decision
      }
    },
    { prepend: true },
  )

  // 2) Output styles at system-prompt assembly.
  ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const result = await next()
    try {
      const prompt = buildStylePrompt(state.config)
      if (prompt.text === '') return result
      const sections = Array.isArray(result?.sections) ? result.sections : []
      if (sections.some((section) => typeof section?.text === 'string' && section.text.includes('token-lean:style:'))) {
        return result
      }
      return {
        ...result,
        sections: [...sections, { name: 'token-lean:styles', text: prompt.text, interpolate: false }],
      }
    } catch (error) {
      ctx.logger?.warn?.(`token-lean: style assembly failed: ${error instanceof Error ? error.message : String(error)}`)
      return result
    }
  })

  // 3) Web settings API.
  const handler = createRoutes({ getState, setConfig, stats, spill })
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scoped) => {
      try {
        const server = scoped?.webServer
        if (server === undefined || typeof server.register !== 'function') return
        const unregister = server.register({ kind: 'prefix', path: '/api/token-lean', handler })
        if (typeof unregister === 'function' && typeof scoped.effect === 'function') {
          scoped.effect(() => () => unregister())
        }
        ctx.logger?.info?.('token-lean: web settings mounted at /api/token-lean')
      } catch (error) {
        ctx.logger?.warn?.(`token-lean: web mount failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  } else if (ctx.webServer !== undefined && typeof ctx.webServer.register === 'function') {
    ctx.webServer.register({ kind: 'prefix', path: '/api/token-lean', handler })
  }

  // 4) Retrieval tool: the notice tells the model to read the spill path, but a
  // dedicated tool is cheaper and survives an id copied out of an old notice.
  try {
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    if (defineTool !== undefined && typeof ctx.tools?.register === 'function') {
      ctx.tools.register(defineTool(createLeanExpandTool(spill)))
    }
  } catch (error) {
    ctx.logger?.warn?.(`token-lean: lean_expand not registered: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      stats.flush()
      configStore.save(state.config)
    }, 'token-lean: flush config and stats')
  }

  ctx.logger?.info?.(
    `token-lean: master=${state.config.master} engines=${Object.entries(state.config.engines)
      .filter(([, engine]) => engine.enabled)
      .map(([id]) => id)
      .join(',') || 'none'} styles=${state.config.styleOrder
      .filter((id) => state.config.styles[id]?.enabled)
      .join(',') || 'none'}`,
  )
}

export default { name, Config, inject, apply }
export { DEFAULTS, ENGINE_META, STYLE_META, resolveConfig, buildStylePrompt }

/** Plain tool definition (the host wraps it with defineTool). */
export function createLeanExpandTool(spill) {
  return {
    name: 'lean_expand',
    description:
      'Retrieve the FULL ORIGINAL text behind a [token-lean #id] notice or a spill file path. Use it when an omitted region might contain a detail you need instead of guessing from the preview.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The 20-char id from a [token-lean #id] notice, or the full spill path printed in the notice.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        const text =
          value && typeof value.text === 'string' && value.text.length > 0
            ? value.text
            : String((value && value.error) || 'not found')
        return [{ type: 'text', text }]
      },
    },
    execute(args) {
      const raw = args && typeof args.id === 'string' ? args.id.trim() : ''
      const match = /([a-f0-9]{6,64})/i.exec(raw)
      if (match === null) return { error: 'invalid id: expected the hex id from a [token-lean #id] notice' }
      const id = match[1].toLowerCase()
      const text = spill.read(id)
      if (text === undefined) {
        return { error: `spill ${id} not found (retention may have pruned it; keepFiles can be raised)` }
      }
      return { id, text }
    },
  }
}
