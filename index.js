/**
 * dsh-haruhi-persona —— Host 半端
 * ============================================================================
 * 它做三件事：
 *   1. 把「人格核心 + 可调参数」合成一段系统提示词，注册进 systemPrompt；
 *   2. 提供设置页用的本地 API（读取 / 预览 / 保存 / 重置）；
 *   3. 把配置落在插件自己的家目录（$DSH_HOME/haruhi-persona/config.json），
 *      不写 profile 的 package.json 或 cordis.patch.yml。
 *
 * 安全：人格提示词最高优先级永远是「不 PUA、不羞辱、不威胁、不歧视、不给危险建议」。
 * 1.1.0：提示词改为「像活人说话」——去掉固定模板与字数上限，加反 AI 清单和语气示例。
 * 1.2.0：聊天里禁止 AI 术语与实现细节；禁止展示思考过程。
 * 1.3.0：输入框左侧加「春日」快捷开关。
 * 1.4.0：系统提示词正文可在设置页手动编辑；固定安全段永远排在最前。
 * 1.5.0：提示词按会话挂载；输入框「春日」按钮切换。
 * 1.6.0：启动动画与春日图标。
 * 1.7.0：春日会话关掉思考与思考状态，只直接回答。
 * 1.8.0：界面层隐藏「深度求索 / 调取命令 / 用时」状态行；切回普通自动恢复。
 * 1.9.0：启动动画升级——动态光斑、网格、扫描线、三层轨道、星屑、渐变标题。
 * 1.10.0：春日会按「任性度 + 亲密度」发表情，一条最多一个。
 * ============================================================================
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PARAMS, PARAM_META, buildPersonaBody, buildSafetyBlock, clampParams } from './lib/prompt-builder.js'
import { PRESETS, PRESET_IDS } from './lib/presets.js'

/** 插件名（= package.json name = client loader id）。 */
export const name = 'dsh-haruhi-persona'

/** 缺少这两个服务时插件不应假装可用。 */
export const inject = ['systemPrompt', 'webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

const VERSION = (() => {
  try {
    const file = join(PLUGIN_DIR, 'package.json')
    return JSON.parse(readFileSync(file, 'utf8')).version || '1.0.0'
  } catch {
    return '1.0.0'
  }
})()

const PLUGIN_HOME = 'haruhi-persona'

/** 插件的家：优先问宿主，拿不到再退回 $DSH_HOME。 */
function stateDirOf(ctx) {
  let dir = ''
  try {
    const p = ctx?.get?.('dshHomePath')
    if (typeof p === 'function') {
      const value = p(PLUGIN_HOME)
      if (value) dir = String(value)
    } else if (typeof p === 'string' && p) {
      dir = join(p, PLUGIN_HOME)
    }
  } catch {
    /* 宿主没提供就退回环境变量 */
  }
  if (!dir) dir = join(process.env.DSH_HOME || join(homedir(), '.dsh'), PLUGIN_HOME)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* 建不了目录时插件仍可用，只是配置存不下来 */
  }
  return dir
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/** 归一化一份插件状态：默认值 < patch 里的 config < 家目录 config.json。 */
function normalizeState(raw, seed = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const seedObj = seed && typeof seed === 'object' ? seed : {}
  const params = clampParams({
    ...DEFAULT_PARAMS,
    ...(seedObj.params && typeof seedObj.params === 'object' ? seedObj.params : {}),
    ...(src.params && typeof src.params === 'object' ? src.params : {}),
  })
  const enabled = typeof src.enabled === 'boolean'
    ? src.enabled
    : (typeof seedObj.enabled === 'boolean' ? seedObj.enabled : true)
  const presetCandidate = String(src.preset ?? seedObj.preset ?? 'standard')
  const preset = PRESET_IDS.includes(presetCandidate) ? presetCandidate : 'standard'
  const modeCandidate = String(src.mode ?? seedObj.mode ?? 'auto') === 'custom' ? 'custom' : 'auto'
  const customPrompt = (typeof src.customPrompt === 'string'
    ? src.customPrompt
    : (typeof seedObj.customPrompt === 'string' ? seedObj.customPrompt : '')).slice(0, 20000)
  const mode = modeCandidate === 'custom' && customPrompt.trim() ? 'custom' : 'auto'
  const welcome = (typeof src.welcome === 'string'
    ? src.welcome
    : (typeof seedObj.welcome === 'string' ? seedObj.welcome : '欢迎，鳕鱼')).slice(0, 80)
  return { enabled, preset, params, mode, customPrompt, welcome }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(text)
}

/** 只接受本机同源请求：别的网页也能访问 127.0.0.1，不能只看端口。 */
function sameOriginOk(req) {
  const host = String(req.headers.host || '')
  const hostname = host.replace(/:\d+$/, '').toLowerCase()
  const localHosts = ['127.0.0.1', 'localhost', '[::1]']
  if (!localHosts.includes(hostname)) return false
  const origin = req.headers.origin || req.headers.referer
  if (!origin) return true
  try {
    const url = new URL(origin)
    return localHosts.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** 丢弃推理流的块：春日会话只把正文和工具调用交给界面。 */
async function* withoutReasoning(source) {
  for await (const chunk of source) {
    if (chunk?.type === 'block-start' && chunk.blockType === 'reasoning') continue
    if (chunk?.type === 'reasoning-delta') continue
    if (chunk?.type === 'block-end' && chunk.block?.type === 'reasoning') continue
    yield chunk
  }
}

export function apply(ctx, config = {}) {
  const stateDir = stateDirOf(ctx)
  const stateFile = join(stateDir, 'config.json')
  const state = normalizeState(readJson(stateFile, null), config)
  let lastWriteError = ''

  const log = (message) => {
    try {
      ctx.logger?.info?.(`[haruhi-persona] ${message}`)
    } catch {
      /* 没有 logger 就算了 */
    }
  }

  const persist = () => {
    try {
      writeJson(stateFile, state)
      lastWriteError = ''
      return true
    } catch (error) {
      lastWriteError = String(error?.message ?? error)
      log(`配置没写成：${lastWriteError}`)
      return false
    }
  }

  const safetyBlock = buildSafetyBlock()
  /** 手动编辑时若把固定安全段也贴了进来，去掉重复的一份。 */
  const stripPinnedSafety = (text) => {
    const value = String(text || '').trim()
    const marker = '【最高优先级 · 安全与事实】'
    if (!value.startsWith(marker)) return value
    const split = value.indexOf('\n\n')
    return split >= 0 ? value.slice(split + 2).trim() : value
  }
  const composeBody = (s) => (s.mode === 'custom' && s.customPrompt.trim()
    ? stripPinnedSafety(s.customPrompt)
    : buildPersonaBody(s.params))

  const snapshot = (sessionId = '') => {
    const body = composeBody(state)
    const sid = sessionId ? String(sessionId) : ''
    return {
      ok: true,
      version: VERSION,
      official: false,
      enabled: state.enabled,
      preset: state.preset,
      params: { ...state.params },
      presets: PRESETS,
      meta: { params: PARAM_META },
      mode: state.mode,
      customPrompt: state.customPrompt,
      welcome: state.welcome,
      safety: safetyBlock,
      body,
      prompt: safetyBlock + '\n\n' + body,
      sessionId: sid || undefined,
      sessionMode: sid ? modeOf(sid) : 'ai',
      attached: sid ? attachedIds.has(sid) : false,
      home: stateDir,
      stored: !lastWriteError,
      error: lastWriteError || undefined,
    }
  }

  const sessionsFile = join(stateDir, 'sessions.json')
  const savedSessions = readJson(sessionsFile, {})
  const sessionModes = savedSessions && typeof savedSessions === 'object' ? { ...savedSessions } : {}
  if (sessionModes._last !== 'haruhi' && sessionModes._last !== 'ai') {
    const carried = Object.keys(sessionModes).some((key) => key !== '_last' && sessionModes[key] === 'haruhi')
    sessionModes._last = carried ? 'haruhi' : 'ai'
  }
  const modeOf = (sessionId) => {
    const key = String(sessionId)
    if (sessionModes[key] === 'haruhi') return 'haruhi'
    if (sessionModes[key] === 'ai') return 'ai'
    return sessionModes._last === 'haruhi' ? 'haruhi' : 'ai'
  }
  const persistSessions = () => {
    try {
      writeJson(sessionsFile, sessionModes)
    } catch (error) {
      log(`会话状态没写成：${String(error?.message ?? error)}`)
    }
  }
  const setModeOf = (sessionId, mode) => {
    const key = String(sessionId || '')
    if (!key) return false
    const value = mode === 'haruhi' ? 'haruhi' : 'ai'
    sessionModes[key] = value
    sessionModes._last = value
    persistSessions()
    return true
  }

  const attachedAgents = new WeakSet()
  const attachedIds = new Set()
  const sessionDisposers = new Set()
  const agentsSvc = (() => {
    try {
      return ctx.get?.('agents')
    } catch {
      return undefined
    }
  })()

  /** 把提示词挂到单个会话上：只有该会话切到春日时才注入。 */
  const attachAgent = (agent) => {
    if (!agent || attachedAgents.has(agent)) return
    const agentCtx = agent.ctx
    if (!agentCtx?.systemPrompt?.section || typeof agentCtx.effect !== 'function') return
    attachedAgents.add(agent)
    const sessionId = String(agent.id)
    try {
      const dispose = agentCtx.effect(() => agentCtx.systemPrompt.section({
        name: 'haruhi-persona',
        order: 100,
        interpolate: false,
        text: () => (state.enabled && modeOf(sessionId) === 'haruhi'
          ? safetyBlock + '\n\n' + composeBody(state)
          : ''),
      }), 'haruhi-persona: 会话提示词')
      attachedIds.add(sessionId)
      if (typeof dispose === 'function') sessionDisposers.add(dispose)
    } catch (error) {
      log(`会话挂载失败：${String(error?.message ?? error)}`)
    }
  }

  // 已经活着的会话先挂上；之后创建的会话走 agent/created。
  try {
    for (const agent of agentsSvc?.list?.() || []) attachAgent(agent)
  } catch (error) {
    log(`现有会话挂载失败：${String(error?.message ?? error)}`)
  }
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => { attachAgent(agent) }), 'haruhi-persona: 新会话挂载')

  // 春日会话：直接回答，不要思考过程。
  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const sessionId = payload?.agent?.id ? String(payload.agent.id) : ''
    if (!sessionId || modeOf(sessionId) !== 'haruhi') return config
    const nextConfig = { ...config }
    delete nextConfig.reasoningEffort
    return nextConfig
  }), 'haruhi-persona: 关掉思考')

  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    let sessionId = options?.sessionId ? String(options.sessionId) : ''
    if (!sessionId) {
      try {
        const initiator = agentsSvc?.currentInitiator?.()
        if (initiator?.id) sessionId = String(initiator.id)
      } catch {
        /* 没有发起者就按普通处理 */
      }
    }
    if (!sessionId || modeOf(sessionId) !== 'haruhi') return next()
    return withoutReasoning(next())
  }), 'haruhi-persona: 屏蔽思考流')
  ctx.effect(() => () => {
    for (const dispose of sessionDisposers) {
      try { dispose() } catch { /* 会话可能已经自己关了 */ }
    }
    sessionDisposers.clear()
    attachedIds.clear()
  }, 'haruhi-persona: 会话清理')

  const route = ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/haruhi-persona',
    handler: async (req, res) => {
      if (!sameOriginOk(req)) {
        sendJson(res, 403, { ok: false, error: '只接受本机同源请求' })
        return
      }
      try {
        const url = new URL(req.url, 'http://127.0.0.1')
        const path = url.pathname

        if (req.method === 'GET' && path === '/api/haruhi-persona/state') {
          const sessionId = url.searchParams.get('sessionId') || ''
          sendJson(res, 200, snapshot(sessionId))
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/background') {
          try {
            const bytes = readFileSync(join(PLUGIN_DIR, 'background.jpg'))
            res.statusCode = 200
            res.setHeader('content-type', 'image/jpeg')
            res.setHeader('cache-control', 'public, max-age=86400')
            res.end(bytes)
          } catch {
            res.statusCode = 404
            res.end()
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/icon') {
          try {
            const bytes = readFileSync(join(PLUGIN_DIR, 'icon.jpg'))
            res.statusCode = 200
            res.setHeader('content-type', 'image/jpeg')
            res.setHeader('cache-control', 'public, max-age=86400')
            res.end(bytes)
          } catch {
            res.statusCode = 404
            res.end()
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/agents') {
          const agents = (agentsSvc?.list?.() || []).map((agent) => {
            const id = String(agent.id)
            return { id, mode: modeOf(id), attached: attachedIds.has(id) }
          })
          sendJson(res, 200, { ok: true, agents })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/session') {
          const body = await readBody(req)
          const sessionId = String(body?.sessionId || '')
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: '缺少会话' })
            return
          }
          const mode = body?.mode === 'haruhi' ? 'haruhi' : 'ai'
          setModeOf(sessionId, mode)
          sendJson(res, 200, {
            ok: true,
            sessionId,
            sessionMode: mode,
            attached: attachedIds.has(sessionId),
          })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/preview') {
          const body = await readBody(req)
          const params = clampParams({ ...state.params, ...(body?.params || {}) })
          const modeInput = String(body?.mode ?? state.mode) === 'custom' ? 'custom' : 'auto'
          const customPrompt = typeof body?.customPrompt === 'string'
            ? body.customPrompt.slice(0, 20000)
            : state.customPrompt
          const mode = modeInput === 'custom' && customPrompt.trim() ? 'custom' : 'auto'
          const previewBody = composeBody({ mode, customPrompt, params })
          sendJson(res, 200, {
            ok: true,
            params,
            mode,
            customPrompt,
            safety: safetyBlock,
            body: previewBody,
            prompt: safetyBlock + '\n\n' + previewBody,
          })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/config') {
          const body = await readBody(req)
          if (body && typeof body === 'object') {
            if (typeof body.enabled === 'boolean') state.enabled = body.enabled
            if (body.params && typeof body.params === 'object') {
              state.params = clampParams({ ...state.params, ...body.params })
            }
            const candidate = String(body.preset ?? state.preset)
            state.preset = PRESET_IDS.includes(candidate) ? candidate : 'custom'
            if (typeof body.mode === 'string') state.mode = body.mode === 'custom' ? 'custom' : 'auto'
            if (typeof body.customPrompt === 'string') state.customPrompt = body.customPrompt.slice(0, 20000)
            if (typeof body.welcome === 'string') state.welcome = body.welcome.slice(0, 80)
            if (state.mode === 'custom' && !state.customPrompt.trim()) state.mode = 'auto'
          }
          const saved = persist()
          sendJson(res, 200, { ...snapshot(), saved })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/reset') {
          state.enabled = true
          state.preset = 'standard'
          state.params = { ...DEFAULT_PARAMS }
          state.welcome = '欢迎，鳕鱼'
          state.mode = 'auto'
          state.customPrompt = ''
          const saved = persist()
          sendJson(res, 200, { ...snapshot(), saved })
          return
        }

        sendJson(res, 404, { ok: false, error: '没有这个接口' })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'haruhi-persona: 设置 API')

  log(`已挂载（家=${stateDir}，启用=${state.enabled ? '是' : '否'}，预设=${state.preset}，正文=${state.mode === 'custom' ? '手动' : '自动'}）`)
  void route
}
