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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { DEFAULT_PARAMS, PARAM_META, buildJapaneseBody, buildLanguageBlock, buildPersonaBody, buildSafetyBlock, clampParams } from './lib/prompt-builder.js'
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
  const voiceRaw = src.voice && typeof src.voice === 'object'
    ? src.voice
    : (seedObj.voice && typeof seedObj.voice === 'object' ? seedObj.voice : {})
  const voice = {
    enabled: voiceRaw.enabled === true,
    autoPlay: voiceRaw.autoPlay === true,
    autoStart: voiceRaw.autoStart === true,
    preload: voiceRaw.preload !== false,
    modelId: typeof voiceRaw.modelId === 'string' ? voiceRaw.modelId.slice(0, 120) : '',
    modelIdJa: typeof voiceRaw.modelIdJa === 'string' ? voiceRaw.modelIdJa.slice(0, 120) : '',
    voiceName: typeof voiceRaw.voiceName === 'string' ? voiceRaw.voiceName.slice(0, 80) : '',
    voiceNameJa: typeof voiceRaw.voiceNameJa === 'string' ? voiceRaw.voiceNameJa.slice(0, 80) : '',
    provider: 'mizuoto',
    gptUrl: typeof voiceRaw.gptUrl === 'string' ? voiceRaw.gptUrl.slice(0, 200) : 'http://127.0.0.1:9880',
    gptRefAudio: typeof voiceRaw.gptRefAudio === 'string' ? voiceRaw.gptRefAudio.slice(0, 500) : '',
    gptPromptText: typeof voiceRaw.gptPromptText === 'string' ? voiceRaw.gptPromptText.slice(0, 500) : '',
    gptPromptLang: voiceRaw.gptPromptLang === 'zh' ? 'zh' : 'ja',
    mizuUrl: typeof voiceRaw.mizuUrl === 'string' ? voiceRaw.mizuUrl.slice(0, 200) : 'http://127.0.0.1:7869',
    mizuModel: typeof voiceRaw.mizuModel === 'string' ? voiceRaw.mizuModel.slice(0, 120) : 'gptsovits/v2pro-base',
    mizuVoice: typeof voiceRaw.mizuVoice === 'string' ? voiceRaw.mizuVoice.slice(0, 120) : '',
    mizuBat: typeof voiceRaw.mizuBat === 'string' ? voiceRaw.mizuBat.slice(0, 500) : '',
    unloadMinutes: Number.isFinite(Number(voiceRaw.unloadMinutes)) ? Math.max(0, Math.min(1440, Math.round(Number(voiceRaw.unloadMinutes)))) : 60,
  }
  const language = 'ja'
  const replyCandidate = Number(src.replyLimit ?? seedObj.replyLimit ?? 120)
  const replyLimit = Number.isFinite(replyCandidate) ? Math.max(0, Math.min(500, Math.round(replyCandidate))) : 120
  return { enabled, preset, params, mode, customPrompt, welcome, voice, language, replyLimit }
}

function readBody(req, limit = 64 * 1024) {  return new Promise((resolve, reject) => {
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

function readBuffer(req, limit = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('音频过大，最多 24 MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 把 Fish 的音频响应边收边转发给浏览器，避免等整段生成完。 */
function proxyHttpsStream(proxyUrl, targetUrl, { method = 'GET', headers = {}, body = null, timeoutMs = 60000 }, res) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl)
    const proxy = new URL(proxyUrl)
    const port = target.port || '443'
    const connect = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}` },
      timeout: timeoutMs,
    })
    connect.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error('代理 CONNECT 返回 ' + response.statusCode))
        return
      }
      const request = https.request({
        host: target.hostname,
        port,
        path: target.pathname + target.search,
        method,
        headers,
        socket,
        servername: target.hostname,
        timeout: timeoutMs,
      }, (answer) => {
        if ((answer.statusCode || 500) >= 300) {
          const chunks = []
          answer.on('data', (chunk) => chunks.push(chunk))
          answer.on('end', () => reject(new Error('Fish Audio 返回 ' + answer.statusCode + '：' + Buffer.concat(chunks).toString('utf8').slice(0, 300))))
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', answer.headers['content-type'] || 'audio/mpeg')
        res.setHeader('cache-control', 'no-store')
        answer.pipe(res)
        answer.on('end', resolve)
      })
      request.on('error', reject)
      request.on('timeout', () => request.destroy(new Error('语音流超时')))
      if (body) request.write(body)
      request.end()
    })
    connect.on('error', reject)
    connect.on('timeout', () => connect.destroy(new Error('代理连接超时')))
    connect.end()
  })
}

async function fishStreamTts(base, headers, body, res) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7877'
  try {
    await proxyHttpsStream(proxy, base + '/v1/tts', { method: 'POST', headers, body }, res)
    return
  } catch {
    /* 代理失败再试直连 */
  }
  const response = await fetch(base + '/v1/tts', { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) })
  if (!response.ok) {
    const text = await response.text()
    throw new Error('Fish Audio 返回 ' + response.status + '：' + text.slice(0, 300))
  }
  res.statusCode = 200
  res.setHeader('content-type', response.headers.get('content-type') || 'audio/mpeg')
  res.setHeader('cache-control', 'no-store')
  Readable.fromWeb(response.body).pipe(res)
}

/** 通过本机 HTTP 代理走 CONNECT，Node 自带的 fetch 不读系统代理。 */
function proxyHttps(proxyUrl, targetUrl, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let target
    let proxy
    try {
      target = new URL(targetUrl)
      proxy = new URL(proxyUrl)
    } catch (error) {
      reject(error)
      return
    }
    const port = target.port || '443'
    const connect = http.request({
      host: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}` },
      timeout: timeoutMs,
    })
    connect.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error('代理 CONNECT 返回 ' + response.statusCode))
        return
      }
      const request = https.request({
        host: target.hostname,
        port,
        path: target.pathname + target.search,
        method,
        headers,
        socket,
        servername: target.hostname,
        timeout: timeoutMs,
      }, (answer) => {
        const chunks = []
        answer.on('data', (chunk) => chunks.push(chunk))
        answer.on('end', () => resolve({
          status: answer.statusCode || 0,
          headers: answer.headers,
          buffer: Buffer.concat(chunks),
        }))
      })
      request.on('error', reject)
      request.on('timeout', () => request.destroy(new Error('代理请求超时')))
      if (body) request.write(body)
      request.end()
    })
    connect.on('error', reject)
    connect.on('timeout', () => connect.destroy(new Error('代理连接超时')))
    connect.end()
  })
}

/** 这台机器直连被挡，优先走本机代理（127.0.0.1:7877 或 HTTPS_PROXY）。 */
let fishProxyWorks = true

async function fishRequest(base, path, { method = 'GET', headers = {}, body = null } = {}) {
  const url = base + path
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7877'
  let proxyError = null
  try {
    const response = await proxyHttps(proxy, url, { method, headers, body, timeoutMs: 30000 })
    return { ...response, via: 'proxy' }
  } catch (error) {
    proxyError = error
  }
  if (proxyError && /Fish Audio 返回/.test(proxyError.message)) throw proxyError
  try {
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) })
    return {
      status: response.status,
      headers: response.headers,
      buffer: Buffer.from(await response.arrayBuffer()),
      via: 'direct',
    }
  } catch (error) {
    throw new Error((proxyError ? '代理：' + proxyError.message + '；' : '') + '直连：' + error.message)
  }
}

function multipartVoiceBody(fields, file) {
  const boundary = '----haruhi' + Math.random().toString(16).slice(2)
  const parts = []
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="voices"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`),
    file.buffer,
    Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`),
  )
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

function runProcess(command, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* ignore */ }
      reject(new Error('进程超时'))
    }, timeoutMs)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('进程退出码 ' + code))
    })
  })
}

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  'F:\\AI机器人部署\\python\\Scripts\\ffmpeg.exe',
  'ffmpeg.exe',
].filter(Boolean)

let hostPlayBusy = false

/** 在 Windows 宿主上直接播放：MP3 → WAV → SoundPlayer，绕开浏览器自动播放限制。 */
async function playOnWindows(buffer) {
  if (hostPlayBusy) return false
  hostPlayBusy = true
  const stamp = Date.now() + '-' + Math.random().toString(16).slice(2)
  const mp3 = join(tmpdir(), 'haruhi-' + stamp + '.mp3')
  const wav = join(tmpdir(), 'haruhi-' + stamp + '.wav')
  try {
    writeFileSync(mp3, buffer)
    let converted = false
    let lastError = null
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      writeFileSync(wav, buffer)
      converted = true
    }
    for (const ffmpeg of converted ? [] : FFMPEG_CANDIDATES) {
      try {
        await runProcess(ffmpeg, ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '44100', '-ac', '1', wav])
        converted = true
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!converted) throw lastError || new Error('找不到 ffmpeg')
    const script = `$p = New-Object System.Media.SoundPlayer '${wav.replace(/'/g, "''")}'; $p.PlaySync()`
    await runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], 120000)
    return true
  } catch (error) {
    try {
      writeFileSync(join(tmpdir(), 'haruhi-play-error.txt'), String(error?.message ?? error))
    } catch { /* ignore */ }
    return false
  } finally {
    hostPlayBusy = false
    try { unlinkSync(mp3) } catch { /* ignore */ }
    try { unlinkSync(wav) } catch { /* ignore */ }
  }
}

function cleanSpeechText(text) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー。、！？!?…\sA-Za-z0-9]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sendJson(res, status, body) {  const text = JSON.stringify(body)
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

/** 把宿主给的流（可能是 Promise、同步或异步可迭代）归一成异步可迭代，避免 yield* 委派时报 not async iterable。 */
function asAsyncIterable(source) {
  return (async function* () {
    let stream = source
    if (stream && typeof stream.then === 'function') stream = await stream
    if (stream == null) return
    if (typeof stream[Symbol.asyncIterator] !== 'function' && typeof stream[Symbol.iterator] !== 'function') return
    yield* stream
  })()
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

/** 只在插件启用期间创建开机自启；停用/卸载时删除，避免关掉插件还占显存。 */
function setStartupShortcut(enabled, batPath) {
  if (process.platform !== 'win32') return
  const appData = process.env.APPDATA
  if (!appData) return
  const startup = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  const shortcut = join(startup, 'Mizuoto TTS.lnk')
  if (!enabled) {
    try { unlinkSync(shortcut) } catch { /* 本来就不存在 */ }
    return
  }
  const bat = batPath || process.env.HARUHI_MIZUOTO_BAT || ''
  if (!bat || !existsSync(bat)) return
  const quote = (value) => String(value).replace(/'/g, "''")
  const script = "$ws = New-Object -ComObject WScript.Shell; " +
    `$s = $ws.CreateShortcut('${quote(shortcut)}'); ` +
    `$s.TargetPath = '${quote(bat)}'; ` +
    `$s.WorkingDirectory = '${quote(dirname(bat))}'; ` +
    '$s.WindowStyle = 7; $s.Save()'
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } catch { /* PowerShell 不可用就跳过 */ }
}

/** 启用插件时如果本地服务没起，顺手启动并预热，模型会装回显存。 */
async function startMizuotoIfNeeded(voice) {
  if (process.platform !== 'win32') return
  const base = String(voice?.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
  try {
    const health = await fetch(base + '/api/v1/app/health', { signal: AbortSignal.timeout(1200) })
    if (health.ok) return
  } catch { /* 没起才继续 */ }
  const bat = voice?.mizuBat || process.env.HARUHI_MIZUOTO_BAT || ''
  if (!bat || !existsSync(bat)) return
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', '/min', bat], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    })
    child.unref()
  } catch { /* 起不来就让用户手动开 */ }
}

/** 停用插件时停掉本机 Mizuoto，立即释放显存。 */
function stopMizuoto() {
  if (process.platform !== 'win32') return
  const script = '$p = (Get-NetTCPConnection -LocalPort 7869 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess); if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }'
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  } catch { /* 停不掉就留给用户 */ }
}

/** 插件打开后预热模型，把权重装进显存；开机脚本不再预热。 */
async function preheatMizuoto(voice) {
  if (process.platform !== 'win32' || !voice?.mizuVoice) return
  const base = String(voice.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
  for (let i = 0; i < 30; i += 1) {
    try {
      const health = await fetch(base + '/api/v1/app/health', { signal: AbortSignal.timeout(1000) })
      if (health.ok) break
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  try {
    await fetch(base + '/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: voice.mizuModel || 'gptsovits/v2pro-base',
        input: 'こんばんは。',
        voice: voice.mizuVoice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(240000),
    })
  } catch { /* 预热失败不影响正常使用 */ }
}

/** 把插件的空闲卸载时间同步给 Mizuoto。 */
async function setUnloadMinutes(voice, minutes) {
  const base = String(voice?.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
  try {
    await fetch(base + '/api/v1/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ compute: { unload_after_minutes: Math.max(0, Math.round(Number(minutes) || 0)) } }),
      signal: AbortSignal.timeout(8000),
    })
  } catch { /* 服务没起就下次再同步 */ }
}

/** 关闭“加载模型”开关时，立刻把模型从显存卸载。 */
async function unloadMizuotoModel(voice) {
  if (process.platform !== 'win32') return
  const base = String(voice?.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
  try {
    await fetch(base + '/api/v1/runtime/unload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: voice?.mizuModel || 'gptsovits/v2pro-base' }),
      signal: AbortSignal.timeout(15000),
    })
  } catch { /* 服务没起或模型没加载就跳过 */ }
}

export function apply(ctx, config = {}) {
  const stateDir = stateDirOf(ctx)
  const stateFile = join(stateDir, 'config.json')
  const state = normalizeState(readJson(stateFile, null), config)
  setStartupShortcut(state.voice.autoStart === true, state.voice.mizuBat)
  void startMizuotoIfNeeded(state.voice)
  void setUnloadMinutes(state.voice, state.voice.unloadMinutes)
  if (state.voice.preload !== false) void preheatMizuoto(state.voice)
  try {
    ctx.on?.('dispose', () => {
      setStartupShortcut(false)
      stopMizuoto()
    })
  } catch { /* 老版本没有 dispose */ }
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

  const voiceKeyFile = join(stateDir, 'voice-key.txt')
  const voiceBase = 'https://api.fish.audio'
  const readVoiceKey = () => {
    try {
      return readFileSync(voiceKeyFile, 'utf8').trim()
    } catch {
      return ''
    }
  }
  const hasVoiceKey = () => Boolean(readVoiceKey())

  const translateCache = new Map()
  const translateToJapanese = async (text) => {
    if (translateCache.has(text)) return translateCache.get(text)
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7877'
    const fetchText = async (url) => {
      const response = await proxyHttps(proxy, url, {
        headers: { 'user-agent': 'Mozilla/5.0' },
        timeoutMs: 12000,
      })
      return response.status >= 200 && response.status < 300 ? response.buffer.toString('utf8') : ''
    }
    let output = ''
    try {
      const raw = await fetchText('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=zh-CN&tl=ja&q=' + encodeURIComponent(text))
      if (raw) {
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          output = data.map((part) => {
            if (typeof part === 'string') return part
            if (Array.isArray(part)) return part.join('')
            return ''
          }).join('')
        }
      }
    } catch {
      output = ''
    }
    if (!output) {
      for (let attempt = 0; attempt < 3 && !output; attempt += 1) {
        try {
          const response = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh-CN|ja', {
            headers: { 'user-agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(12000),
          })
          if (response.ok) {
            const data = await response.json()
            output = String(data?.responseData?.translatedText || '')
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
          }
        } catch {
          output = ''
        }
        if (!output) await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }
    if (!output) {
      try {
        const raw = await fetchText('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh-CN|ja')
        if (raw) {
          const data = JSON.parse(raw)
          output = String(data?.responseData?.translatedText || '')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
        }
      } catch {
        output = ''
      }
    }
    if (output) {
      output = output
        .replace(/クールパレススプリング/g, '涼宮ハルヒ')
        .replace(/凉宫春日|涼宮春日/g, '涼宮ハルヒ')
        .replace(/タバコさん|タバコ/g, 'タラ')
      translateCache.set(text, output)
      if (translateCache.size > 40) translateCache.clear()
    }
    return output
  }

  const speechCache = new Map()
  const speechPending = new Set()

  const cachedSpeech = (text) => {
    if (speechCache.has(text)) return speechCache.get(text)
    for (const [key, buffer] of speechCache) {
      if (key.startsWith(text) || text.startsWith(key)) return buffer
    }
    return null
  }

  const fishSpeechBuffer = async (text) => {
    const key = readVoiceKey()
    const modelId = state.voice.modelIdJa
    if (!key || !modelId) return null
    const response = await fishRequest(voiceBase, '/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        model: 'speech-1.1',
      },
      body: Buffer.from(JSON.stringify({
        text: text.slice(0, 1200),
        reference_id: modelId,
        language: 'ja',
        format: 'mp3',
        mp3_bitrate: 128,
        chunk_length: 120,
        normalize: false,
        latency: 'balanced',
      })),
    })
    if (response.status < 200 || response.status >= 300) return null
    return response.buffer
  }

  const prefetchSpeech = async (text) => {
    if (!state.voice.enabled || !state.voice.autoPlay || !state.voice.modelIdJa) return
    if (speechPending.has(text) || speechCache.has(text)) return
    speechPending.add(text)
    try {
      const japanese = /[\u3040-\u30ff]/.test(text) ? text : await translateToJapanese(text)
      if (!japanese) return
      const buffer = await fishSpeechBuffer(japanese)
      if (buffer) {
        speechCache.set(text, buffer)
        speechCache.set(japanese, buffer)
        if (speechCache.size > 30) speechCache.clear()
      }
    } catch {
      /* 预合成失败就让正式请求再试 */
    } finally {
      speechPending.delete(text)
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
  const composeBody = (s) => {
    const base = s.mode === 'custom' && s.customPrompt.trim()
      ? stripPinnedSafety(s.customPrompt)
      : buildPersonaBody(s.params, 'zh')
    if (s.replyLimit > 0) {
      return base + `\n\n【回复长度】最多 ${s.replyLimit} 字（含标点），超过就删。`
    }
    return base
  }

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
      language: state.language,
      replyLimit: state.replyLimit,
      voice: {
        enabled: state.voice.enabled,
        autoPlay: state.voice.autoPlay,
        autoStart: state.voice.autoStart === true,
        preload: state.voice.preload !== false,
        modelId: state.voice.modelId,
        modelIdJa: state.voice.modelIdJa,
        voiceName: state.voice.voiceName,
        voiceNameJa: state.voice.voiceNameJa,
        provider: state.voice.provider,
        gptUrl: state.voice.gptUrl,
        gptRefAudio: state.voice.gptRefAudio,
        gptPromptText: state.voice.gptPromptText,
        gptPromptLang: state.voice.gptPromptLang,
        mizuUrl: state.voice.mizuUrl,
        mizuModel: state.voice.mizuModel,
        mizuVoice: state.voice.mizuVoice,
        mizuBat: state.voice.mizuBat,
        unloadMinutes: state.voice.unloadMinutes,
        hasKey: hasVoiceKey(),
      },
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
    // 宿主用 yield* 委派中间件返回值：监听器必须同步返回异步可迭代，返回 Promise 会让整轮报错。
    if (!sessionId || modeOf(sessionId) !== 'haruhi') return asAsyncIterable(next())
    return withoutReasoning(asAsyncIterable(next()))
  }), 'haruhi-persona: 屏蔽思考流')
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    let sessionId = options?.sessionId ? String(options.sessionId) : ''
    if (!sessionId) {
      try {
        const initiator = agentsSvc?.currentInitiator?.()
        if (initiator?.id) sessionId = String(initiator.id)
      } catch { /* 没有发起者 */ }
    }
    const needPrefetch = state.voice.enabled && state.voice.autoPlay && state.voice.modelIdJa
      && sessionId && modeOf(sessionId) === 'haruhi'
    // 同上：同步返回异步可迭代；Promise 形式的返回值会让宿主 yield* 委派失败。
    if (!needPrefetch) return asAsyncIterable(next())
    return (async function* () {
      let buffer = ''
      let fired = false
      for await (const chunk of asAsyncIterable(next())) {
        if (!fired && chunk?.type === 'text-delta') {
          buffer += chunk.text
          const match = buffer.match(/^(.{8,60}?[。！？!?\n])/s)
          if (match) {
            fired = true
            prefetchSpeech(match[1].trim())
          }
        }
        yield chunk
      }
    })()
  }), 'haruhi-persona: 语音预合成')
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

        if (req.method === 'POST' && path === '/api/haruhi-persona/debug') {
          try {
            const body = await readBody(req)
            writeJson(join(stateDir, 'debug.json'), body)
            sendJson(res, 200, { ok: true })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/ping') {
          const key = readVoiceKey()
          if (!key) {
            sendJson(res, 400, { ok: false, error: '还没配置 Fish Audio 密钥' })
            return
          }
          try {
            const response = await fishRequest(voiceBase, '/model?page_size=1', {
              headers: { Authorization: `Bearer ${key}` },
            })
            const ok = response.status >= 200 && response.status < 300
            sendJson(res, 200, {
              ok,
              status: response.status,
              via: response.via,
              message: ok ? 'Fish Audio 连通' : response.buffer.toString('utf8').slice(0, 300),
            })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: '连不上 Fish Audio：' + String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/llm-models') {
          let llm = null
          try { llm = ctx.get?.('llm') } catch { llm = null }
          let models = []
          try { models = await llm.listModels('deepseek-official') } catch (error) { models = [{ error: String(error?.message ?? error) }] }
          sendJson(res, 200, { ok: true, models })
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/providers') {
          let llm = null
          try { llm = ctx.get?.('llm') } catch { llm = null }
          let providers = []
          try { providers = llm?.listProviders?.() || [] } catch { providers = [] }
          sendJson(res, 200, { ok: Boolean(llm), providers })
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/voices') {
          const base = String(state.voice.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
          try {
            const response = await fetch(base + '/api/v1/voices', { signal: AbortSignal.timeout(8000) })
            if (!response.ok) {
              sendJson(res, 502, { ok: false, error: 'Mizuoto 返回 ' + response.status })
              return
            }
            const list = await response.json()
            const voices = (Array.isArray(list) ? list : []).map((item) => ({
              id: String(item?.id || ''),
              name: String(item?.name || item?.slug || '未命名'),
              language: item?.language || '',
            })).filter((item) => item.id)
            sendJson(res, 200, { ok: true, voices })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: '连不上 Mizuoto：' + String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/translate') {
          const text = String(url.searchParams.get('text') || '').trim()
          if (!text) {
            sendJson(res, 400, { ok: false, error: '没有文字' })
            return
          }
          const translated = await translateToJapanese(text)
          sendJson(res, 200, { ok: Boolean(translated), translated })
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/models') {
          const key = readVoiceKey()
          if (!key) {
            sendJson(res, 400, { ok: false, error: '还没配置 Fish Audio 密钥' })
            return
          }
          try {
            const response = await fishRequest(voiceBase, '/model?page_size=20', {
              headers: { Authorization: `Bearer ${key}` },
            })
            const raw = response.buffer.toString('utf8')
            if (response.status < 200 || response.status >= 300) {
              sendJson(res, 502, { ok: false, error: raw.slice(0, 500) })
              return
            }
            const data = JSON.parse(raw)
            const items = (data.items || data.data || []).map((item) => ({
              id: String(item._id || item.id || ''),
              title: String(item.title || ''),
              languages: Array.isArray(item.languages) ? item.languages : [],
            })).filter((item) => item.id)
            sendJson(res, 200, { ok: true, items })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/model-info') {
          const key = readVoiceKey()
          const id = String(url.searchParams.get('id') || '')
          if (!key || !id) {
            sendJson(res, 400, { ok: false, error: '缺少密钥或音色 ID' })
            return
          }
          try {
            const response = await fishRequest(voiceBase, '/model/' + encodeURIComponent(id), {
              headers: { Authorization: `Bearer ${key}` },
            })
            const raw = response.buffer.toString('utf8')
            let data = null
            try { data = JSON.parse(raw) } catch { /* 非 JSON */ }
            sendJson(res, 200, { ok: response.status >= 200 && response.status < 300, status: response.status, model: data, raw: data ? undefined : raw.slice(0, 500) })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/voice/key') {
          const body = await readBody(req)
          const key = String(body?.key || '').trim()
          if (!key.startsWith('sk-fish-')) {
            sendJson(res, 400, { ok: false, error: '密钥格式不对，应以 sk-fish- 开头' })
            return
          }
          try {
            writeFileSync(voiceKeyFile, key, { mode: 0o600 })
            sendJson(res, 200, { ok: true, voice: snapshot().voice })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/voice/config') {
          const body = await readBody(req)
          if (typeof body?.enabled === 'boolean') state.voice.enabled = body.enabled
          if (typeof body?.autoPlay === 'boolean') state.voice.autoPlay = body.autoPlay
          if (typeof body?.autoStart === 'boolean') state.voice.autoStart = body.autoStart
          if (typeof body?.preload === 'boolean') state.voice.preload = body.preload
          if (typeof body?.voiceName === 'string') state.voice.voiceName = body.voiceName.slice(0, 80)
          if (typeof body?.modelId === 'string') state.voice.modelId = body.modelId.slice(0, 120)
          if (typeof body?.modelIdJa === 'string') state.voice.modelIdJa = body.modelIdJa.slice(0, 120)
          if (typeof body?.voiceNameJa === 'string') state.voice.voiceNameJa = body.voiceNameJa.slice(0, 80)
          if (body?.provider === 'gpt' || body?.provider === 'fish') state.voice.provider = body.provider
          if (typeof body?.gptUrl === 'string') state.voice.gptUrl = body.gptUrl.slice(0, 200)
          if (typeof body?.gptRefAudio === 'string') state.voice.gptRefAudio = body.gptRefAudio.slice(0, 500)
          if (typeof body?.gptPromptText === 'string') state.voice.gptPromptText = body.gptPromptText.slice(0, 500)
          if (body?.gptPromptLang === 'ja' || body?.gptPromptLang === 'zh') state.voice.gptPromptLang = body.gptPromptLang
          if (typeof body?.mizuUrl === 'string') state.voice.mizuUrl = body.mizuUrl.slice(0, 200)
          if (typeof body?.mizuModel === 'string') state.voice.mizuModel = body.mizuModel.slice(0, 120)
          if (typeof body?.mizuVoice === 'string') state.voice.mizuVoice = body.mizuVoice.slice(0, 120)
          if (typeof body?.mizuBat === 'string') state.voice.mizuBat = body.mizuBat.slice(0, 500)
          if (body?.unloadMinutes !== undefined) {
            const nextMinutes = Number(body.unloadMinutes)
            if (Number.isFinite(nextMinutes)) state.voice.unloadMinutes = Math.max(0, Math.min(1440, Math.round(nextMinutes)))
          }
          state.voice.provider = 'mizuoto'
          state.language = 'ja'
          if (body?.unloadMinutes !== undefined) void setUnloadMinutes(state.voice, state.voice.unloadMinutes)
          if (body?.replyLimit !== undefined) {
            const nextLimit = Number(body.replyLimit)
            if (Number.isFinite(nextLimit)) state.replyLimit = Math.max(0, Math.min(500, Math.round(nextLimit)))
          }
          persist()
          setStartupShortcut(state.voice.autoStart === true, state.voice.mizuBat)
          if (typeof body?.preload === 'boolean') {
            if (body.preload) void preheatMizuoto(state.voice)
            else void unloadMizuotoModel(state.voice)
          }
          sendJson(res, 200, { ok: true, voice: snapshot().voice })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/voice/clone') {
          const key = readVoiceKey()
          if (!key) {
            sendJson(res, 400, { ok: false, error: '先保存 Fish Audio 密钥' })
            return
          }
          const buffer = await readBuffer(req)
          if (!buffer.length) {
            sendJson(res, 400, { ok: false, error: '没有收到音频' })
            return
          }
          const mime = String(req.headers['content-type'] || 'audio/mpeg').split(';')[0] || 'audio/mpeg'
          const filename = String(decodeURIComponent(String(req.headers['x-file-name'] || 'voice.mp3')))
          const language = 'ja'
          const form = multipartVoiceBody({
            title: state.voice.voiceNameJa || 'haruhi-ja',
            type: 'tts',
            train_mode: 'fast',
            visibility: 'private',
          }, { filename, mime, buffer })
          let response
          try {
            response = await fishRequest(voiceBase, '/model', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'content-type': form.contentType,
              },
              body: form.body,
            })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: '连不上 Fish Audio：' + String(error?.message ?? error) })
            return
          }
          const raw = response.buffer.toString('utf8')
          if (response.status < 200 || response.status >= 300) {
            sendJson(res, 502, { ok: false, error: raw.slice(0, 600) || 'Fish Audio 拒绝了这次克隆' })
            return
          }
          let data
          try {
            data = JSON.parse(raw)
          } catch {
            sendJson(res, 502, { ok: false, error: 'Fish Audio 返回的不是 JSON' })
            return
          }
          const modelId = String(data?._id || data?.id || '')
          if (!modelId) {
            sendJson(res, 502, { ok: false, error: 'Fish Audio 没有返回音色 ID' })
            return
          }
          if (language === 'ja') state.voice.modelIdJa = modelId
          else state.voice.modelId = modelId
          state.voice.enabled = true
          persist()
          sendJson(res, 200, { ok: true, modelId, language, voice: snapshot().voice })
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/voice/play') {
          const body = await readBody(req, 16 * 1024)
          const started = Date.now()
          let text = String(body?.text || '').trim()
          if (state.replyLimit > 0) text = text.slice(0, state.replyLimit)
          if (!text) {
            sendJson(res, 400, { ok: false, error: '没有文字' })
            return
          }
          let baseUrl = String(state.voice.mizuUrl || 'http://127.0.0.1:7869').replace(/\/+$/, '')
          for (const candidate of [baseUrl, 'http://127.0.0.1:7869', 'http://127.0.0.1:7870', 'http://127.0.0.1:7871']) {
            try {
              const probe = await fetch(candidate + '/api/v1/app/health', { signal: AbortSignal.timeout(800) })
              if (probe.ok) {
                baseUrl = candidate
                break
              }
            } catch { /* 试下一个端口 */ }
          }
          const modelName = state.voice.mizuModel || 'gptsovits/v2pro-base'
          const voiceId = state.voice.mizuVoice
          if (!voiceId) {
            sendJson(res, 400, { ok: false, error: '先在 Mizuoto 创建音色，把音色 ID 填进插件设置' })
            return
          }
          let speakText = text
          const kanaCount = (text.match(/[\u3040-\u30ff]/g) || []).length
          const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
          if (kanaCount < 3 || (hanCount > 12 && kanaCount < 8)) {
            const translated = await translateToJapanese(text)
            if (!translated) {
              sendJson(res, 400, { ok: false, error: '自动翻译失败' })
              return
            }
            speakText = translated
          }
          speakText = cleanSpeechText(speakText) || speakText
          const afterTranslate = Date.now()
          let response = null
          try {
            response = await fetch(baseUrl + '/v1/audio/speech', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                model: modelName,
                input: speakText,
                voice: voiceId,
                response_format: 'wav',
              }),
            })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: '连不上 Mizuoto：' + String(error?.message ?? error) })
            return
          }
          if (!response.ok) {
            const raw = await response.text().catch(() => '')
            sendJson(res, 502, { ok: false, error: 'Mizuoto 返回 ' + response.status + '：' + raw.slice(0, 300) })
            return
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          const afterSynth = Date.now()
          const played = await playOnWindows(buffer)
          const afterPlay = Date.now()
          sendJson(res, 200, {
            ok: played,
            played,
            provider: 'mizuoto',
            translation: speakText.slice(0, 120),
            timings: {
              translateMs: afterTranslate - started,
              synthMs: afterSynth - afterTranslate,
              playMs: afterPlay - afterSynth,
              totalMs: afterPlay - started,
            },
          })
          return
        }

        if (req.method === 'GET' && path === '/api/haruhi-persona/voice/tts-stream') {
          const text = String(url.searchParams.get('text') || '').trim()
          if (!text) {
            sendJson(res, 400, { ok: false, error: '没有文字' })
            return
          }
          const key = readVoiceKey()
          const modelId = state.voice.modelIdJa
          if (!key || !modelId) {
            sendJson(res, 400, { ok: false, error: '还没有日语音色或密钥' })
            return
          }
          let speakText = text
          const kanaCount = (text.match(/[\u3040-\u30ff]/g) || []).length
          const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
          if (kanaCount < 3 || (hanCount > 12 && kanaCount < 8)) {
            const translated = await translateToJapanese(text)
            if (!translated) {
              sendJson(res, 400, { ok: false, error: '自动翻译失败' })
              return
            }
            speakText = translated
          }
          const headers = {
            Authorization: `Bearer ${key}`,
            'content-type': 'application/json',
            model: 'speech-1.1',
          }
          const body = Buffer.from(JSON.stringify({
            text: speakText.slice(0, 1200),
            reference_id: modelId,
            language: 'ja',
            format: 'mp3',
            mp3_bitrate: 128,
            chunk_length: 120,
            normalize: false,
            latency: 'balanced',
          }))
          try {
            await fishStreamTts(voiceBase, headers, body, res)
          } catch (error) {
            if (!res.headersSent) {
              sendJson(res, 502, { ok: false, error: String(error?.message ?? error) })
            } else {
              res.end()
            }
          }
          return
        }

        if (req.method === 'POST' && path === '/api/haruhi-persona/voice/tts') {
          const body = await readBody(req, 16 * 1024)
          const text = String(body?.text || '').trim()
          if (!text) {
            sendJson(res, 400, { ok: false, error: '没有文字' })
            return
          }
          const key = readVoiceKey()
          if (!key) {
            sendJson(res, 400, { ok: false, error: '还没配置 Fish Audio 密钥' })
            return
          }
          const language = 'ja'
          const modelId = state.voice.modelIdJa
          let speakText = text
          const kanaCount = (text.match(/[\u3040-\u30ff]/g) || []).length
          const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
          if (kanaCount < 3 || (hanCount > 12 && kanaCount < 8)) {
            const translated = await translateToJapanese(text)
            if (!translated) {
              sendJson(res, 400, { ok: false, error: '这条回复不是日语，自动翻译也失败了' })
              return
            }
            speakText = translated
          }
          if (!modelId) {
            sendJson(res, 400, { ok: false, error: '还没有日语音色，先上传日语人声' })
            return
          }
          const cached = cachedSpeech(text) || cachedSpeech(speakText)
          if (cached) {
            res.statusCode = 200
            res.setHeader('content-type', 'audio/mpeg')
            res.setHeader('content-length', cached.length)
            res.setHeader('cache-control', 'no-store')
            res.end(cached)
            return
          }
          let response
          try {
            try {
              writeJson(join(stateDir, 'tts-debug.json'), {
                text: speakText.slice(0, 120),
                language,
                modelId,
                sessionId: String(body?.sessionId || ''),
                sessionMode: body?.sessionId ? modeOf(String(body.sessionId)) : '',
                time: Date.now(),
              })
            } catch { /* 调试记录失败不影响合成 */ }
            response = await fishRequest(voiceBase, '/v1/tts', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${key}`,
                'content-type': 'application/json',
                model: 'speech-1.1',
              },
              body: Buffer.from(JSON.stringify({
                text: speakText.slice(0, 1200),
                reference_id: modelId,
                language: language === 'ja' ? 'ja' : 'zh',
                format: 'mp3',
                mp3_bitrate: 128,
                chunk_length: 120,
                normalize: false,
                latency: 'balanced',
              })),
            })
          } catch (error) {
            sendJson(res, 502, { ok: false, error: '连不上 Fish Audio：' + String(error?.message ?? error) })
            return
          }
          if (response.status < 200 || response.status >= 300) {
            sendJson(res, 502, { ok: false, error: response.buffer.toString('utf8').slice(0, 600) || '语音合成失败' })
            return
          }
          const bytes = response.buffer
          speechCache.set(text, bytes)
          speechCache.set(speakText, bytes)
          if (speechCache.size > 30) speechCache.clear()
          res.statusCode = 200
          res.setHeader('content-type', 'audio/mpeg')
          res.setHeader('content-length', bytes.length)
          res.setHeader('cache-control', 'no-store')
          res.end(bytes)
          return
        }

        if (req.method === 'DELETE' && path === '/api/haruhi-persona/voice/model') {
          const language = url.searchParams.get('language')
          if (language === 'ja') state.voice.modelIdJa = ''
          else if (language === 'zh') state.voice.modelId = ''
          else {
            state.voice.modelId = ''
            state.voice.modelIdJa = ''
          }
          state.voice.enabled = Boolean(state.voice.modelId || state.voice.modelIdJa)
          persist()
          sendJson(res, 200, { ok: true, voice: snapshot().voice })
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
          const language = 'ja'
          const previewBody = composeBody({
            mode,
            customPrompt,
            params,
            language,
            replyLimit: body?.replyLimit === undefined ? state.replyLimit : Number(body.replyLimit),
          })
          sendJson(res, 200, {
            ok: true,
            params,
            mode,
            customPrompt,
            language,
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
            if (typeof body?.welcome === 'string') state.welcome = body.welcome.slice(0, 80)
            if (typeof body?.language === 'string') state.language = body.language === 'ja' ? 'ja' : 'zh'
            if (body?.replyLimit !== undefined) {
              const nextLimit = Number(body.replyLimit)
              if (Number.isFinite(nextLimit)) state.replyLimit = Math.max(0, Math.min(500, Math.round(nextLimit)))
            }
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
          state.language = 'zh'
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
