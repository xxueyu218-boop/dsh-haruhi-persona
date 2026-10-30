/**
 * dsh-haruhi-persona —— 浏览器半端（设置页）
 * ============================================================================
 * 自注册脚本，不是 ESM：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory(require) { ... } })
 *
 * 设置页挂在 `settings.section`，滑块 0–100、四套预设、实时提示词预览。
 * 数据走同源接口 `/api/haruhi-persona/*`（Host 半端注册），不引入任何 Harness
 * Client 包，也不读别的插件 DOM。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-haruhi-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/api/haruhi-persona'

    /** 由 apply 注入；组件渲染时读取当前 locale 判断中/英。 */
    let localeRef = null
    /** 会话模式缓存：给消息署名用，避免每条消息都请求一次。 */
    const sessionModeCache = new Map()

    function rememberMode(sessionId, active) {
      const key = String(sessionId)
      sessionModeCache.set(key, !!active)
      try {
        window.dispatchEvent(new CustomEvent('haruhi-mode', { detail: { sessionId: key, active: !!active } }))
      } catch {
        /* 事件发不出去也不影响主流程 */
      }
    }

    /** 只有当前会话切到春日时，才打开聊天壁纸。 */
    function setChatWallpaper(on) {
      if (on) document.documentElement.setAttribute('data-hp-chat', 'on')
      else document.documentElement.removeAttribute('data-hp-chat')
    }

    /**
     * 春日模式下把宿主的状态行藏掉：思考、调取命令、用时。
     * 这些行是宿主界面自己画的，没有公开开关，只能按文案找最近的整行。
     */
    const STATUS_RE = /正在(?:分析请求|调取命令|调用命令|执行命令|调用工具|生成)|深度(?:求索|思考)中|(?:调取|调用|执行)(?:命令|工具|指令)|思考中|生成中|已完成|用时|完成\s*·\s*用时/
    /** 只有整行本身就是状态时才收掉；别碰输入框下方的用量条。 */
    const STRICT_RE = /^(正在分析请求|深度求索中|深度思考中|正在调取(?:命令|工具)|正在调用(?:命令|工具)|调取命令|调用命令|正在生成|生成中|已完成|用时\s*\d+\s*秒)/
    const KEEP_RE = /tok\/s|缓存|命中|上下文|context|tokens?/i
    let haruhiActive = false
    let statusTimer = null
    const hiddenStatus = new Map()
    const blankedStatus = new Map()

    function restoreStatusRows() {
      for (const [el, display] of hiddenStatus) {
        try { el.style.display = display } catch { /* 节点已经没了 */ }
      }
      hiddenStatus.clear()
      for (const [node, value] of blankedStatus) {
        try { if (node.nodeValue === '') node.nodeValue = value } catch { /* 节点已经没了 */ }
      }
      blankedStatus.clear()
    }

    function hideStatusRow(el) {
      if (!el || hiddenStatus.has(el)) return
      hiddenStatus.set(el, el.style.display)
      el.style.display = 'none'
    }

    function blankStatusText(node) {
      if (!node || blankedStatus.has(node)) return
      blankedStatus.set(node, node.nodeValue)
      node.nodeValue = ''
    }

    function sweepStatusRows() {
      if (!haruhiActive) {
        restoreStatusRows()
        return
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const text = (node.nodeValue || '').trim()
          if (!text || text.length > 90 || !STATUS_RE.test(text)) return NodeFilter.FILTER_REJECT
          const holder = node.parentElement
          if (holder && holder.closest('[data-hp],[data-hp-splash],[data-hp-quick-btn]')) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      const targets = new Set()
      let node = walker.nextNode()
      while (node) {
        blankStatusText(node)
        let el = node.parentElement
        for (let depth = 0; depth < 5 && el && el !== document.body; depth++) {
          const text = (el.textContent || '').trim()
          if (text.length > 60) break
          if (!STRICT_RE.test(text) || KEEP_RE.test(text)) break
          const display = getComputedStyle(el).display
          if (display !== 'inline' && display !== 'contents' && text) {
            targets.add(el)
            break
          }
          el = el.parentElement
        }
        node = walker.nextNode()
      }
      for (const el of targets) hideStatusRow(el)
    }

    function setHaruhiActive(next) {
      haruhiActive = !!next
      if (statusTimer) {
        clearTimeout(statusTimer)
        statusTimer = null
      }
      sweepStatusRows()
    }

    function startStatusHider(ctx) {
      const schedule = () => {
        if (statusTimer) return
        statusTimer = setTimeout(() => {
          statusTimer = null
          sweepStatusRows()
        }, 60)
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      ctx.effect(() => () => {
        observer.disconnect()
        if (statusTimer) {
          clearTimeout(statusTimer)
          statusTimer = null
        }
        restoreStatusRows()
      }, 'haruhi-persona: 状态行清理')
      schedule()
    }

    const DICT = {
      zh: {
        nav: '凉宫春日',
        title: '凉宫春日',
        exitFullscreen: '窗口',
        badge: '同人 · 非官方',
        subtitle: 'SOS 团团长式的活力与行动力；人格可调，安全底线不可调。',
        enable: '启用这套人格',
        enableHint: '总开关。打开后，还要在输入框左侧点「春日」，按会话切换。',
        presets: '预设',
        custom: '自定义',
        params: '人格参数',
        paramsHint: '滑块只改变表达方式：数值越高，行为越靠近右侧描述。',
        advanced: '口吻细节',
        command: '命令模式',
        commandHint: '开启后可用团长式祈使句，但每次都会落到「最终由你决定」。',
        address: '怎么称呼你',
        addressHint: '留空则用「你」；最多 24 个字符。',
        welcome: '启动欢迎语',
        welcomeHint: '启动动画里显示这一句；留空用「欢迎，鳕鱼」。',
        welcomePlaceholder: '欢迎，鳕鱼',
        voiceTitle: '语音回复',
        voiceEnable: '启用语音',
        voiceEnableHint: '用克隆出来的声线朗读春日的回复。',
        voiceAuto: '自动朗读',
        voiceAutoHint: '开启后每条回复完成时自动播放；关闭则只显示「语音」按钮。',
        voiceAutoStart: '开机自动启动服务',
        voiceAutoStartHint: '开启后下次开机只启动本地服务、不加载模型；模型在打开插件时预热。',
        voicePreload: '打开插件时加载模型',
        voicePreloadHint: '开启后插件一打开就预热，首句更快；关闭则第一句语音时才加载。',
        voiceUnload: '空闲卸载模型',
        voiceUnloadHint: '模型约占用 2.5 GB 显存，卸载后释放；多久没用语音就把模型移出显存，下次说话会自动重新加载。',
        unload15: '15 分钟：显存释放最快，适合偶尔用语音；代价是经常要等 30–60 秒重新加载。',
        unload60: '60 分钟：日常最平衡，闲置一小时才卸载，偶尔等一次首句。',
        unload120: '120 分钟：显存占用较久，首句很少需要等，适合一天内频繁使用。',
        unload240: '240 分钟：基本常驻显存，首句几乎不用等，但长期占用约 2.5 GB。',
        voiceKey: 'Fish Audio 密钥',
        voiceKeyHint: '只保存在本机，以 sk-fish- 开头；不会写进仓库。',
        voiceKeyConfigured: '已配置（留空不改）',
        voiceSaveKey: '保存密钥',
        voiceClone: '上传音源',
        voiceCloneHint: '10–30 秒干净人声，mp3/wav；上传后几秒内可用。',
        voiceCloning: '克隆中…',
        voiceCloned: '音色已就绪，可以试听了。',
        voiceNoModel: '还没有音色，先上传音源。',
        voiceTest: '试听',
        voiceRemove: '清除音色',
        voicePlaying: '播放中…',
        voicePlay: '语音',
        voiceZh: '中文音色',
        voiceJa: '日语音色',
        voiceNoZh: '未绑定中文音色',
        voiceNoJa: '未绑定日语音色',
        voiceJaHint: '日语音色请用日语人声克隆；拿中文样本克隆会带中文口音。',
        ttsProvider: 'TTS 引擎',
        providerFish: 'Fish Audio',
        providerGpt: 'GPT-SoVITS',
        gptUrl: 'GPT-SoVITS 地址',
        gptRef: '参考音频路径',
        gptPrompt: '参考文本',
        gptHint: '本地 api_v2.py 默认 http://127.0.0.1:9880；参考音频与文本要对应。',
        mizuUrl: 'Mizuoto 地址',
        mizuModel: '模型 ID',
        mizuVoice: '音色 ID',
        mizuHint: '先在 Mizuoto 创建音色，把音色 ID 填到这里；默认地址 http://127.0.0.1:7869。',
        voiceFetch: '获取音色列表',
        voiceFetchHint: '从 Mizuoto 读取已创建的音色，选中即可自动填 ID。',
        voiceSelect: '选择音色',
        mizuBat: 'Mizuoto 启动脚本（可选）',
        mizuBatHint: '填你本机的启动脚本路径，插件才能自动启动/开机自启；留空则需手动开 Mizuoto。',
        replyLimit: '回复字数上限',
        replyLimitHint: '超过这个字数的回复会被截断；建议 80–150，太短会说不完整。',
        themeLabel: '面板外观',
        themeAuto: '跟随系统',
        themeLight: '浅色',
        themeDark: '深色',
        language: '回复语言',
        languageHint: '中文或日文；只影响春日的回复，不影响界面。',
        langZh: '中文',
        langJa: '日本語',
        preview: '人格编辑器',
        previewHint: '直接改下面这段；改完保存。安全底线固定在最前。',
        previewAutoHint: '按当前参数自动生成；动一个字就转手动。',
        previewRegenerate: '按当前参数重新生成',
        previewEmpty: '（正文为空）',
        previewOff: '已停用：当前不会注入提示词',
        save: '保存并应用',
        saving: '保存中…',
        saved: '已保存，下一步对话就会生效。',
        saveFail: '保存失败',
        reset: '恢复默认',
        resetDone: '已恢复为默认设置。',
        dirty: '有未保存的修改',
        clean: '已保存',
        loading: '读设置中…',
        loadFail: '读不到设置',
        retry: '重试',
        chars: '字',
        presetCalm: '冷静版',
        presetCalmTag: '低刺激 · 适合工作',
        presetStandard: '默认',
        presetStandardTag: '团长气质 · 默认',
        presetWild: '暴走版',
        presetWildTag: '高能 · 头脑风暴',
        presetGentle: '温柔版',
        presetGentleTag: '嘴硬心软 · 陪伴',
        quickButton: '春日',
        quickTo: '切到春日',
        quickBack: '切回普通',
        quickFail: '没切过去，再点一次',
        splashSkip: '点击跳过',
        safetyTitle: '安全底线（固定，不可编辑）',
        promptPlaceholder: '在这里改正文……',
      },
      en: {
        nav: 'Haruhi Suzumiya',
        title: 'Haruhi Suzumiya',
        exitFullscreen: 'Window',
        badge: 'Fan-style · Unofficial',
        subtitle: 'SOS-brigade energy and drive. The style is adjustable; the safety floor is not.',
        enable: 'Enable this persona',
        enableHint: 'Master switch. After enabling, use the “Haruhi” button beside the composer to switch this chat.',
        presets: 'Presets',
        custom: 'Custom',
        params: 'Persona parameters',
        paramsHint: 'Sliders change delivery only: the further right, the closer to the description.',
        advanced: 'Voice details',
        command: 'Command mode',
        commandHint: 'Allows brigade-style imperatives, always followed by “the final call is yours”.',
        address: 'How to address you',
        addressHint: 'Leave empty to use “you”; up to 24 characters.',
        welcome: 'Welcome line',
        welcomeHint: 'Shown in the startup animation; empty falls back to the default.',
        welcomePlaceholder: 'Welcome, codfish',
        voiceTitle: 'Voice replies',
        voiceEnable: 'Enable voice',
        voiceEnableHint: 'Read Haruhi replies with the cloned voice.',
        voiceAuto: 'Auto play',
        voiceAutoHint: 'Play each finished reply automatically; off shows a Voice button.',
        voiceAutoStart: 'Start service at boot',
        voiceAutoStartHint: 'On: next boot starts the local service only, without loading the model; the model preheats when the plugin opens.',
        voicePreload: 'Load model when plugin opens',
        voicePreloadHint: 'Prefetch on open for a fast first line; off loads on first speech.',
        voiceUnload: 'Unload when idle',
        voiceUnloadHint: 'The model uses about 2.5 GB of VRAM and frees it when unloaded; after this much idle time it leaves VRAM and reloads on the next speech.',
        unload15: '15 min: fastest VRAM release, best for occasional use; often waits 30–60 s to reload.',
        unload60: '60 min: balanced; unloads after an hour idle, occasional wait for the first line.',
        unload120: '120 min: keeps VRAM longer, rarely waits; good for frequent daily use.',
        unload240: '240 min: nearly always resident, almost no wait, but holds about 2.5 GB.',
        voiceKey: 'Fish Audio key',
        voiceKeyHint: 'Stored locally only; starts with sk-fish- and never goes into the repo.',
        voiceKeyConfigured: 'Configured (leave empty to keep)',
        voiceSaveKey: 'Save key',
        voiceClone: 'Upload sample',
        voiceCloneHint: '10–30s clean speech, mp3/wav; ready a few seconds after upload.',
        voiceCloning: 'Cloning…',
        voiceCloned: 'Voice is ready to preview.',
        voiceNoModel: 'No voice yet. Upload a sample first.',
        voiceTest: 'Preview',
        voiceRemove: 'Remove voice',
        voicePlaying: 'Playing…',
        voicePlay: 'Voice',
        voiceZh: 'Chinese voice',
        voiceJa: 'Japanese voice',
        voiceNoZh: 'No Chinese voice yet',
        voiceNoJa: 'No Japanese voice yet',
        voiceJaHint: 'Clone the Japanese voice from a Japanese sample; a Chinese sample keeps a Chinese accent.',
        ttsProvider: 'TTS engine',
        providerFish: 'Fish Audio',
        providerGpt: 'GPT-SoVITS',
        gptUrl: 'GPT-SoVITS URL',
        gptRef: 'Reference audio path',
        gptPrompt: 'Reference text',
        gptHint: 'Local api_v2.py defaults to http://127.0.0.1:9880; audio and text must match.',
        mizuUrl: 'Mizuoto URL',
        mizuModel: 'Model ID',
        mizuVoice: 'Voice ID',
        mizuHint: 'Create a voice in Mizuoto first and paste its ID here; default http://127.0.0.1:7869.',
        voiceFetch: 'Fetch voice list',
        voiceFetchHint: 'Read voices from Mizuoto and pick one to fill the ID.',
        voiceSelect: 'Choose a voice',
        mizuBat: 'Mizuoto launcher (optional)',
        mizuBatHint: 'Path to your launcher script so the plugin can auto-start it; leave empty to start Mizuoto manually.',
        replyLimit: 'Reply length limit',
        replyLimitHint: 'Replies longer than this are cut; 80–150 works best.',
        themeLabel: 'Panel theme',
        themeAuto: 'Auto',
        themeLight: 'Light',
        themeDark: 'Dark',
        language: 'Reply language',
        languageHint: 'Chinese or Japanese; affects Haruhi replies only, not the UI.',
        langZh: '中文',
        langJa: '日本語',
        preview: 'Persona editor',
        previewHint: 'Edit the text below and save. The safety floor stays pinned at the top.',
        previewAutoHint: 'Generated from the current settings; typing switches to manual.',
        previewRegenerate: 'Regenerate from settings',
        previewEmpty: '(empty body)',
        previewOff: 'Disabled: nothing is injected right now',
        save: 'Save & apply',
        saving: 'Saving…',
        saved: 'Saved. It applies from your next turn.',
        saveFail: 'Save failed',
        reset: 'Reset',
        resetDone: 'Reset to the standard preset.',
        dirty: 'Unsaved changes',
        clean: 'Saved',
        loading: 'Loading settings…',
        loadFail: 'Could not load settings',
        retry: 'Retry',
        chars: 'chars',
        presetCalm: 'Calm',
        presetCalmTag: 'Low intensity · work',
        presetStandard: 'Default',
        presetStandardTag: 'Brigade mood · default',
        presetWild: 'Wild',
        presetWildTag: 'High energy · brainstorming',
        presetGentle: 'Gentle',
        presetGentleTag: 'Soft edges · companion',
        quickButton: 'Haruhi',
        quickTo: 'Switch to Haruhi',
        quickBack: 'Back to normal',
        quickFail: 'Switch failed, try again',
        splashSkip: 'Click to skip',
        safetyTitle: 'Safety floor (fixed, read-only)',
        promptPlaceholder: 'Edit the body here…',
      },
    }

    function activeLang() {
      try {
        return String(localeRef?.getLocale?.().active || 'zh').toLowerCase()
      } catch {
        return 'zh'
      }
    }

    function makeT() {
      const dict = activeLang().startsWith('zh') ? DICT.zh : DICT.en
      return (key) => (dict[key] !== undefined ? dict[key] : (DICT.zh[key] ?? key))
    }

    const PRESET_IDS = ['calm', 'standard', 'wild', 'gentle']

    /** 英文界面的轴标签（Host 只提供中文元数据，这里补一层）。 */
    const EN_META = {
      assertiveness: { label: 'Assertiveness', low: 'suggest options', high: 'decide and drive' },
      whimsy: { label: 'Whimsy', low: 'respect the plan', high: 'propose detours (declinable)' },
      sharpness: { label: 'Edge', low: 'gentle', high: 'sharp banter (never personal)' },
      affection: { label: 'Warmth', low: 'polite distance', high: 'nicknames & care (no clinging)' },
      energy: { label: 'Energy', low: 'answer only', high: 'break down steps and start' },
      meta_humor: { label: 'Meta humor', low: 'stay in character', high: 'occasional fourth wall' },
      catchphrase_frequency: { label: 'Catchphrase rate', low: 'never', high: 'once per 2–3 turns' },
      expressiveness: { label: 'Emoji rate', low: 'almost never', high: 'once per 1–2 turns' },
    }

    function metaFor(item) {
      if (activeLang().startsWith('zh')) return item
      const english = EN_META[item.key]
      return english ? { ...item, ...english } : item
    }

    function presetName(preset) {
      return preset.name
    }

    function presetTag(preset) {
      return preset.tagline
    }

    const CSS = `
html[data-hp-splashing] body{background-color:#05070c !important;}
html[data-hp-chat="on"][data-hp-ready="1"] body::after{content:'';position:fixed;inset:0;background:url('/api/haruhi-persona/background?v=4k2') center/cover no-repeat;pointer-events:none;z-index:2147483646;mix-blend-mode:normal;opacity:.24;}
html[data-hp-theme="light"][data-hp-chat="on"][data-hp-ready="1"] body::after{mix-blend-mode:multiply;opacity:.55;filter:saturate(.95) brightness(.94);}
html[data-hp-theme="dark"][data-hp-chat="on"][data-hp-ready="1"] body::after{mix-blend-mode:normal;opacity:.30;}
[data-hp-splash]{background-color:#05070c !important;}
[data-hp="page"]{display:flex;flex-direction:column;gap:16px;max-width:720px;padding:2px 2px 28px;color:var(--dsw-alias-label-primary);font-size:13px;}
[data-hp="head"]{display:flex;flex-direction:column;gap:4px;}
[data-hp="title-row"]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-hp="title"]{margin:0;font-size:17px;line-height:24px;font-weight:600;}
[data-hp="badge"]{border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}
[data-hp="sub"]{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}
[data-hp="card"]{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);}
[data-hp="section-title"]{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);}
[data-hp="row"]{display:flex;align-items:center;gap:12px;}
[data-hp="grow"]{flex:1;min-width:0;}
[data-hp="label"]{font-size:13px;line-height:18px;}
[data-hp="hint"]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}
[data-hp="slider"]{display:flex;flex-direction:column;gap:5px;}
[data-hp="slider-head"]{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
[data-hp="val"]{font-variant-numeric:tabular-nums;font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary);}
[data-hp-range]{width:100%;height:20px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer;}
[data-hp="switch"]{flex:none;position:relative;width:40px;height:22px;border-radius:11px;border:0;padding:0;cursor:pointer;background:var(--dsw-alias-border-l2);transition:background .15s;}
[data-hp="switch"][data-on]{background:var(--dsw-alias-brand-primary);}
[data-hp="switch"] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:left .15s;display:block;}
[data-hp="switch"][data-on] i{left:21px;}
[data-hp="switch"][disabled]{opacity:.45;cursor:default;}
[data-hp="presets"]{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
[data-hp="preset"]{display:flex;flex-direction:column;gap:2px;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;cursor:pointer;font-family:inherit;}
[data-hp="preset"]:hover{background:var(--dsw-alias-bg-layer-2);}
[data-hp="preset"][data-active]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}
[data-hp="btn"][data-active]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}
[data-hp="preset-name"]{font-size:13px;font-weight:600;line-height:18px;}
[data-hp="preset-tag"]{font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);}
[data-hp="btn"]{padding:7px 14px;border-radius:8px;font-size:12px;line-height:16px;cursor:pointer;font-family:inherit;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);}
[data-hp="btn"]:hover{background:var(--dsw-alias-bg-layer-2);}
[data-hp="btn"][data-primary]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
[data-hp="btn"][disabled]{opacity:.5;cursor:default;background:transparent;}
[data-hp="actions"]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-hp="dirty"]{flex:1;min-width:120px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}
[data-hp="dirty"][data-dirty]{color:var(--dsw-alias-state-warn-primary);}
[data-hp="msg"]{font-size:11px;line-height:16px;}
[data-hp="msg"][data-tone="good"]{color:var(--dsw-alias-state-success-primary);}
[data-hp="msg"][data-tone="bad"]{color:var(--dsw-alias-state-error-primary);}
[data-hp="off"]{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary);}
[data-hp-text]{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;}
[data-hp-text]:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
[data-hp="center"]{padding:24px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;}
[data-hp-quick]{display:inline-flex;}
[data-hp-quick-btn]{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1;cursor:pointer;}
[data-hp-quick-btn]:hover{background:var(--dsw-alias-bg-layer-2);}
[data-hp-quick-btn][data-on]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
[data-hp-star]{font-size:11px;}
[data-hp-avatar-icon]{width:18px;height:18px;border-radius:50%;object-fit:cover;border:1px solid var(--dsw-alias-brand-primary);}
[data-hp-turn-head]{display:flex;align-items:center;gap:8px;padding:6px 0 2px;font-size:11px;color:var(--dsw-alias-label-secondary);}
[data-hp-turn-head] img{width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid var(--dsw-alias-border-l2);}
[data-hp-byline]{display:inline-flex;align-items:center;gap:4px;}
[data-hp="voice"]{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 7px;font-size:11px;line-height:16px;cursor:pointer;}
[data-hp="voice"]:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3);}
[data-hp="voice"]:disabled{opacity:.5;cursor:default;}
[data-hp-abs-avatar]{position:absolute;width:24px;height:24px;border-radius:50%;object-fit:cover;border:2px solid var(--dsw-alias-border-l2);z-index:3;pointer-events:none;display:none;}
[data-hp-dot]{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);}
[data-hp-quick-btn][data-on] [data-hp-dot]{background:var(--dsw-alias-state-success-primary);}
[data-hp-quick-btn][disabled]{opacity:.45;cursor:default;}
[data-hp-quick-btn][data-err]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
[data-hp="safety"]{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-layer-2);}
[data-hp="safety"] summary{cursor:pointer;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}
[data-hp="safety-pre"]{margin:7px 0 0;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);}
[data-hp-prompt-editor]{width:100%;box-sizing:border-box;min-height:200px;resize:vertical;padding:9px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:17px;}
[data-hp-prompt-editor]:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}

/* —— 插件面板主题（只作用于本插件设置页） —— */
[data-hp="page"]{--hp-surface:var(--dsw-alias-bg-layer-1);--hp-surface-2:var(--dsw-alias-bg-layer-2);--hp-line:var(--dsw-alias-border-l1);--hp-text:var(--dsw-alias-label-primary);--hp-muted:var(--dsw-alias-label-secondary);--hp-accent:#b7791f;}
[data-hp="page"][data-hp-panel-theme="dark"]{--hp-surface:#161922;--hp-surface-2:#1e222c;--hp-line:rgba(255,255,255,.09);--hp-text:#eef2f8;--hp-muted:#9aa4b4;--hp-accent:#f5c451;}
[data-hp="page"][data-hp-panel-theme="light"]{--hp-surface:#ffffff;--hp-surface-2:#f5f6f8;--hp-line:rgba(16,24,40,.10);--hp-text:#1b202b;--hp-muted:#5f6b7c;--hp-accent:#b7791f;}
@media (prefers-color-scheme: dark){
  [data-hp="page"][data-hp-panel-theme="auto"]{--hp-surface:#161922;--hp-surface-2:#1e222c;--hp-line:rgba(255,255,255,.09);--hp-text:#eef2f8;--hp-muted:#9aa4b4;--hp-accent:#f5c451;}
}
[data-hp="page"]{color:var(--hp-text);}
[data-hp="page"] [data-hp="head"]{padding:18px 18px 16px;border-radius:16px;border:1px solid var(--hp-line);background:linear-gradient(135deg,color-mix(in srgb,var(--hp-accent) 14%,var(--hp-surface)) 0%,var(--hp-surface) 62%);}
[data-hp="page"] [data-hp="title"]{font-size:19px;line-height:26px;}
[data-hp="page"] [data-hp="badge"]{border-color:color-mix(in srgb,var(--hp-accent) 45%,var(--hp-line));color:var(--hp-accent);background:color-mix(in srgb,var(--hp-accent) 10%,transparent);}
[data-hp="page"] [data-hp="sub"]{color:var(--hp-muted);}
[data-hp="page"] [data-hp="card"]{background:var(--hp-surface);border:1px solid var(--hp-line);border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.06);}
[data-hp="page"] [data-hp="card"]:hover{border-color:color-mix(in srgb,var(--hp-accent) 28%,var(--hp-line));}
[data-hp="page"] [data-hp="section-title"]{color:var(--hp-muted);letter-spacing:.05em;}
[data-hp="page"] [data-hp="hint"]{color:var(--hp-muted);}
[data-hp="page"] [data-hp="val"]{color:var(--hp-accent);}
[data-hp="page"] [data-hp-range]{accent-color:var(--hp-accent);}
[data-hp="page"] [data-hp="switch"][data-on]{background:var(--hp-accent);}
[data-hp="page"] [data-hp="preset"]{border-radius:11px;background:var(--hp-surface-2);border-color:var(--hp-line);}
[data-hp="page"] [data-hp="preset"][data-active]{border-color:var(--hp-accent);}
[data-hp="page"] [data-hp="btn"]{border-color:var(--hp-line);background:var(--hp-surface-2);}
[data-hp="page"] [data-hp="btn"][data-active], [data-hp="page"] [data-hp="btn"][data-primary]{border-color:var(--hp-accent);color:var(--hp-accent);}
[data-hp="page"] [data-hp-text], [data-hp="page"] [data-hp-prompt-editor]{border-color:var(--hp-line);background:var(--hp-surface-2);color:var(--hp-text);}
[data-hp="theme-switch"]{margin-left:auto;display:inline-flex;padding:3px;gap:2px;border-radius:999px;border:1px solid var(--hp-line);background:var(--hp-surface-2);}
[data-hp="theme-btn"]{border:0;border-radius:999px;padding:4px 10px;font-size:11px;line-height:16px;font-family:inherit;color:var(--hp-muted);background:transparent;cursor:pointer;white-space:nowrap;}
[data-hp="theme-btn"]:hover{color:var(--hp-text);}
[data-hp="theme-btn"][data-active]{color:#14161b;background:var(--hp-accent);font-weight:600;}
@keyframes hp-spin{to{transform:rotate(360deg)}}
@keyframes hp-in{0%{transform:scale(.88);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes hp-rise{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
@keyframes hp-load{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
@keyframes hp-pulse{0%,100%{opacity:.25}50%{opacity:.9}}
[data-hp-splash]{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;z-index:9999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;overflow:hidden;background:radial-gradient(90% 70% at 50% 0%,#1a2540 0%,transparent 62%),radial-gradient(70% 60% at 85% 100%,rgba(245,158,11,.14),transparent 62%),radial-gradient(55% 50% at 50% 45%,rgba(56,189,248,.10),transparent 70%),linear-gradient(180deg,#0b1220 0%,#080c14 60%,#05070c 100%);cursor:pointer;transition:opacity .3s ease;}
[data-hp-splash][open]{display:flex;}
[data-hp-splash]::backdrop{background:#05070c;}
[data-hp-splash][data-out]{opacity:0;pointer-events:none;}
[data-hp-splash]::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,rgba(245,158,11,.10),transparent 42%);pointer-events:none;}
[data-hp-splash-grid]{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(circle at 50% 40%,#000 0%,transparent 70%);mask-image:radial-gradient(circle at 50% 40%,#000 0%,transparent 70%);opacity:.55;pointer-events:none;}
[data-hp-stage]{position:relative;width:200px;height:200px;display:flex;align-items:center;justify-content:center;z-index:2;}
[data-hp-halo]{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(245,158,11,.22) 0%,rgba(245,158,11,.06) 45%,transparent 70%);pointer-events:none;}
[data-hp-orbit]{position:absolute;inset:8px;border-radius:50%;border:1px dashed rgba(245,158,11,.30);animation:hp-spin 20s linear infinite;pointer-events:none;}
[data-hp-orbit]::after{content:'';position:absolute;top:-3px;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:#f59e0b;}
[data-hp-avatar]{position:relative;z-index:3;width:150px;height:150px;border-radius:50%;overflow:hidden;border:3px solid rgba(245,158,11,.9);box-shadow:0 0 26px rgba(245,158,11,.28);animation:hp-in .5s ease-out both;}
[data-hp-avatar] img{width:100%;height:100%;object-fit:cover;display:block;}
[data-hp-spark]{position:absolute;border-radius:50%;background:#fbbf24;opacity:.3;animation:hp-pulse 2.2s ease-in-out infinite;pointer-events:none;}
[data-hp-title]{position:relative;z-index:2;display:flex;gap:.08em;font-size:26px;font-weight:700;}
[data-hp-title] span{display:inline-block;background:linear-gradient(100deg,#fff 0%,#fde68a 38%,#f59e0b 58%,#fff 100%);-webkit-background-clip:text;background-clip:text;color:transparent;animation:hp-rise .5s ease-out both;}
[data-hp-sub]{position:relative;z-index:2;color:#f59e0b;font-size:10px;letter-spacing:.4em;text-indent:.4em;animation:hp-rise .5s ease-out .65s both;}
[data-hp-welcome]{position:relative;z-index:2;color:#f8fafc;font-size:14px;letter-spacing:.06em;animation:hp-rise .5s ease-out .85s both;}
[data-hp-welcome] strong{color:#fbbf24;font-weight:700;}
[data-hp-welcome-sub]{position:relative;z-index:2;color:rgba(248,250,252,.55);font-size:11px;letter-spacing:.22em;text-indent:.22em;animation:hp-rise .5s ease-out 1s both;}
[data-hp-bar]{position:relative;z-index:2;width:168px;height:3px;margin-top:6px;border-radius:3px;background:rgba(248,250,252,.12);overflow:hidden;}
[data-hp-bar] i{display:block;width:100%;height:100%;border-radius:3px;background:linear-gradient(90deg,#f59e0b,#fde68a,#f59e0b);transform-origin:left;animation:hp-load 1.8s cubic-bezier(.2,.8,.2,1) both;}
[data-hp-skip]{position:absolute;bottom:18px;left:0;right:0;text-align:center;color:rgba(248,250,252,.4);font-size:11px;letter-spacing:.08em;z-index:2;}
@media (prefers-reduced-motion: reduce){[data-hp-orbit],[data-hp-avatar],[data-hp-title] span,[data-hp-sub],[data-hp-welcome],[data-hp-welcome-sub],[data-hp-bar] i,[data-hp-spark]{animation:none!important}}
@keyframes hp2-pop{0%{opacity:0;transform:scale(.88)}100%{opacity:1;transform:scale(1)}}
@keyframes hp2-rise{0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:none}}
@keyframes hp2-bar{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
[data-hp-splash-body]{display:flex;flex-direction:column;align-items:center;gap:12px;position:relative;z-index:2;}
[data-hp-splash2-avatar]{width:132px;height:132px;border-radius:50%;object-fit:cover;border:2px solid rgba(245,158,11,.9);box-shadow:0 0 24px rgba(245,158,11,.22);animation:hp2-pop .5s ease-out both;}
[data-hp-splash2-line]{width:120px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#f59e0b,transparent);animation:hp2-rise .5s ease-out .1s both;}
[data-hp-splash2-title]{font-size:24px;font-weight:600;letter-spacing:.22em;text-indent:.22em;color:#fff;animation:hp2-rise .5s ease-out .16s both;}
[data-hp-splash2-sub]{font-size:10px;letter-spacing:.4em;text-indent:.4em;color:#f59e0b;animation:hp2-rise .5s ease-out .24s both;}
[data-hp-splash2-welcome]{font-size:14px;color:#f8fafc;letter-spacing:.05em;animation:hp2-rise .5s ease-out .32s both;}
[data-hp-splash2-welcome] strong{color:#fbbf24;font-weight:700;}
[data-hp-splash2-wsub]{font-size:11px;color:rgba(248,250,252,.55);letter-spacing:.2em;text-indent:.2em;animation:hp2-rise .5s ease-out .4s both;}
[data-hp-splash2-bar]{width:160px;height:2px;margin-top:4px;border-radius:2px;background:rgba(248,250,252,.12);overflow:hidden;}
[data-hp-splash2-bar] i{display:block;width:100%;height:100%;background:#f59e0b;transform-origin:left;animation:hp2-bar 1.6s cubic-bezier(.2,.8,.2,1) both;}
[data-hp-splash2-skip]{position:absolute;bottom:20px;left:0;right:0;text-align:center;color:rgba(248,250,252,.4);font-size:11px;letter-spacing:.08em;z-index:2;}
@media (prefers-reduced-motion: reduce){[data-hp-splash2-avatar],[data-hp-splash2-line],[data-hp-splash2-title],[data-hp-splash2-sub],[data-hp-splash2-welcome],[data-hp-splash2-wsub],[data-hp-splash2-bar] i{animation:none!important}}
`

    function Toggle({ on, onChange, label, disabled }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': label,
        'data-hp': 'switch',
        'data-on': on ? '' : undefined,
        disabled: disabled ? '' : undefined,
        onClick: () => onChange(!on),
      }, h('i', { 'aria-hidden': 'true' }))
    }

    function Slider({ meta, value, onChange }) {
      return h('label', { 'data-hp': 'slider' },
        h('span', { 'data-hp': 'slider-head' },
          h('span', { 'data-hp': 'label' }, meta.label),
          h('span', { 'data-hp': 'val' }, String(value))),
        h('input', {
          type: 'range',
          min: 0,
          max: 100,
          step: 1,
          value,
          'aria-label': meta.label,
          'data-hp-range': '',
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { 'data-hp': 'hint' }, '0 ' + meta.low + ' · 100 ' + meta.high))
    }

    async function callApi(path, init) {
      const res = await fetch(API + path, {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers ? init.headers : {}) },
      })
      let data = null
      const text = await res.text()
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        throw new Error('返回不是 JSON（HTTP ' + res.status + '）')
      }
      if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status))
      return data
    }

    let voiceAudio = null
    function playVoiceBlob(blob) {
      try {
        if (voiceAudio) voiceAudio.pause()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        voiceAudio = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          if (voiceAudio === audio) voiceAudio = null
        }
        audio.play().catch(() => { /* 浏览器可能拦自动播放 */ })
        return audio
      } catch {
        return null
      }
    }

    const autoPlayedIds = new Set()
    let autoPlayCutoff = 0
    let lastSpokenMessage = { id: '', at: 0 }
    let globalSpeaking = false

    function splitSpeech(text) {
      const parts = String(text).split(/(?<=[。！？!?\n])/).map((part) => part.trim()).filter(Boolean)
      const chunks = []
      let current = ''
      let limit = 40
      const push = (value) => {
        chunks.push(value)
        limit = 100
      }
      for (let part of parts) {
        while (part.length > limit) {
          if (current) {
            push(current)
            current = ''
          }
          push(part.slice(0, limit))
          part = part.slice(limit)
        }
        if (current && (current + part).length > limit) {
          push(current)
          current = part
        } else {
          current += part
        }
      }
      if (current) push(current)
      return chunks
    }

    const voiceBlobCache = new Map()
    async function synthesizeCached(text, language, sessionId) {
      const key = (language === 'ja' ? 'ja' : 'zh') + '|' + text
      const cached = voiceBlobCache.get(key)
      if (cached) return cached
      const task = synthesizeVoice(text, language, sessionId)
      voiceBlobCache.set(key, task)
      try {
        const blob = await task
        voiceBlobCache.set(key, blob)
        if (voiceBlobCache.size > 40) voiceBlobCache.clear()
        return blob
      } catch (error) {
        voiceBlobCache.delete(key)
        throw error
      }
    }

    function waitAudio(audio) {
      return new Promise((resolve) => {
        if (!audio) {
          resolve()
          return
        }
        const done = () => resolve()
        audio.addEventListener('ended', done, { once: true })
        audio.addEventListener('error', done, { once: true })
        setTimeout(done, 20000)
      })
    }

    async function synthesizeVoice(text, language, sessionId) {
      const res = await fetch(API + '/voice/tts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, language: language === 'ja' ? 'ja' : 'zh', sessionId: sessionId || '' }),
      })
      if (!res.ok) {
        let message = '语音合成失败'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch { /* 不是 JSON */ }
        throw new Error(message)
      }
      return res.blob()
    }

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        try {
          fetch(API + '/debug', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'render',
              message: String(error && error.message ? error.message : error),
              stack: String(error && error.stack ? error.stack : ''),
              componentStack: String(info && info.componentStack ? info.componentStack : ''),
              time: Date.now(),
            }),
          }).catch(() => {})
        } catch { /* 调试上报失败也不影响页面 */ }
      }

      render() {
        if (this.state.error) {
          const message = String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)
          const stack = String(this.state.error && this.state.error.stack ? this.state.error.stack : '')
          return h('div', { 'data-hp': 'page' },
            h('div', { 'data-hp': 'center' }, '设置页渲染失败：' + message),
            h('pre', { 'data-hp': 'safety-pre' }, stack))
        }
        return this.props.children
      }
    }

    function Panel() {
      const t = makeT()
      const [loaded, setLoaded] = React.useState(false)
      const [loadError, setLoadError] = React.useState('')
      const [params, setParams] = React.useState(null)
      const [meta, setMeta] = React.useState([])
      const [presets, setPresets] = React.useState([])
      const [enabled, setEnabled] = React.useState(true)
      const [preset, setPreset] = React.useState('standard')
      const [mode, setMode] = React.useState('auto')
      const [customPrompt, setCustomPrompt] = React.useState('')
      const [welcome, setWelcome] = React.useState('欢迎，鳕鱼')
      const [language, setLanguage] = React.useState('ja')
      const [replyLimit, setReplyLimit] = React.useState(120)
      const [theme, setTheme] = React.useState('auto')
      const [voiceOptions, setVoiceOptions] = React.useState([])
      const [voice, setVoice] = React.useState({ enabled: false, autoPlay: false, hasKey: false, modelId: '', modelIdJa: '', voiceName: '', voiceNameJa: '' })
      const [voiceKey, setVoiceKey] = React.useState('')
      const [voiceBusy, setVoiceBusy] = React.useState('')
      const [voiceMsg, setVoiceMsg] = React.useState(null)
      const [safety, setSafety] = React.useState('')
      const [body, setBody] = React.useState('')
      const [dirty, setDirty] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [message, setMessage] = React.useState(null)
      const [, forceRender] = React.useReducer((n) => n + 1, 0)

      React.useEffect(() => {
        if (!localeRef?.subscribe) return undefined
        try {
          return localeRef.subscribe(() => forceRender())
        } catch {
          return undefined
        }
      }, [])

      const adopt = React.useCallback((data) => {
        setParams(data.params)
        setEnabled(data.enabled !== false)
        setPreset(data.preset || 'standard')
        setMode(data.mode === 'custom' ? 'custom' : 'auto')
        setCustomPrompt(typeof data.customPrompt === 'string' ? data.customPrompt : '')
        setWelcome(typeof data.welcome === 'string' ? data.welcome : '欢迎，鳕鱼')
        setLanguage('ja')
        setReplyLimit(Number.isFinite(Number(data.replyLimit)) ? Number(data.replyLimit) : 120)
        setTheme('auto')
        setVoice(data.voice && typeof data.voice === 'object'
          ? {
            enabled: data.voice.enabled === true,
            autoPlay: data.voice.autoPlay === true,
            autoStart: data.voice.autoStart === true,
            preload: data.voice.preload !== false,
            hasKey: data.voice.hasKey === true,
            modelId: typeof data.voice.modelId === 'string' ? data.voice.modelId : '',
            modelIdJa: typeof data.voice.modelIdJa === 'string' ? data.voice.modelIdJa : '',
            voiceName: typeof data.voice.voiceName === 'string' ? data.voice.voiceName : '',
            voiceNameJa: typeof data.voice.voiceNameJa === 'string' ? data.voice.voiceNameJa : '',
            mizuUrl: typeof data.voice.mizuUrl === 'string' ? data.voice.mizuUrl : 'http://127.0.0.1:7869',
            mizuModel: typeof data.voice.mizuModel === 'string' ? data.voice.mizuModel : '',
            mizuVoice: typeof data.voice.mizuVoice === 'string' ? data.voice.mizuVoice : '',
            mizuBat: typeof data.voice.mizuBat === 'string' ? data.voice.mizuBat : '',
            unloadMinutes: Number.isFinite(Number(data.voice.unloadMinutes)) ? Number(data.voice.unloadMinutes) : 60,
          }
          : { enabled: false, autoPlay: false, autoStart: false, preload: true, unloadMinutes: 60, hasKey: false, modelId: '', modelIdJa: '', voiceName: '', voiceNameJa: '', mizuUrl: 'http://127.0.0.1:7869', mizuModel: '', mizuVoice: '', mizuBat: '' })
        setSafety(typeof data.safety === 'string' ? data.safety : '')
        setBody(typeof data.body === 'string' ? data.body : '')
        setPresets(Array.isArray(data.presets) ? data.presets : [])
        setMeta(Array.isArray(data.meta?.params) ? data.meta.params : [])
        setDirty(false)
      }, [])

      React.useEffect(() => {
        let alive = true
        callApi('/state')
          .then((data) => {
            if (!alive) return
            adopt(data)
            setLoaded(true)
          })
          .catch((error) => {
            if (alive) setLoadError(String(error?.message ?? error))
          })
        return () => { alive = false }
      }, [adopt])

      // 自动模式：参数一变就重新合成正文；手动模式不再覆盖用户改过的字
      React.useEffect(() => {
        if (!loaded || !params || mode === 'custom') return undefined
        let alive = true
        const timer = setTimeout(() => {
          callApi('/preview', { method: 'POST', body: JSON.stringify({ params, mode: 'auto', customPrompt: '', language }) })
            .then((data) => {
              if (!alive) return
              setSafety(data.safety || '')
              setBody(data.body || '')
            })
            .catch(() => { /* 预览失败不打断编辑 */ })
        }, 180)
        return () => { alive = false; clearTimeout(timer) }
      }, [loaded, params, mode, language])

      const patchParam = (key, value) => {
        setParams((prev) => ({ ...prev, [key]: value }))
        setPreset('custom')
        setDirty(true)
        setMessage(null)
      }

      const choosePreset = (item) => {
        setParams({ ...item.params })
        setPreset(item.id)
        setDirty(true)
        setMessage(null)
      }

      const save = async () => {
        if (!params) return
        setBusy('save')
        setMessage(null)
        try {
          const data = await callApi('/config', {
            method: 'POST',
            body: JSON.stringify({ enabled, params, preset, mode, customPrompt, welcome, language: 'ja' }),
          })
          adopt(data)
          setMessage({ tone: 'good', text: t('saved') })
        } catch (error) {
          setMessage({ tone: 'bad', text: t('saveFail') + '：' + String(error?.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      const reset = async () => {
        setBusy('reset')
        setMessage(null)
        try {
          const data = await callApi('/reset', { method: 'POST', body: '{}' })
          adopt(data)
          setMessage({ tone: 'good', text: t('resetDone') })
        } catch (error) {
          setMessage({ tone: 'bad', text: t('saveFail') + '：' + String(error?.message ?? error) })
        } finally {
          setBusy('')
        }
      }

      const patchVoice = async (patch) => {
        setVoiceBusy('config')
        setVoiceMsg(null)
        try {
          const data = await callApi('/voice/config', { method: 'POST', body: JSON.stringify(patch) })
          if (data.voice) setVoice(data.voice)
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        } finally {
          setVoiceBusy('')
        }
      }

      const applyLanguage = async (value) => {
        const next = value === 'ja' ? 'ja' : 'zh'
        setLanguage(next)
        setMessage(null)
        try {
          const data = await callApi('/config', { method: 'POST', body: JSON.stringify({ language: next }) })
          const saved = data.language === 'ja' ? 'ja' : 'zh'
          setLanguage(saved)
          window.dispatchEvent(new CustomEvent('haruhi-language', { detail: { language: saved } }))
        } catch (error) {
          setMessage({ tone: 'bad', text: String(error?.message ?? error) })
        }
      }

      const loadVoices = async () => {
        try {
          const data = await callApi('/voice/voices')
          setVoiceOptions(Array.isArray(data.voices) ? data.voices : [])
          if (!data.voices || !data.voices.length) {
            setVoiceMsg({ tone: 'bad', text: 'Mizuoto 里还没有音色，先去创建一个。' })
          }
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        }
      }

      const applyTheme = async (value) => {
        const next = 'auto'
        setTheme(next)
        try {
          await callApi('/config', { method: 'POST', body: JSON.stringify({ theme: next }) })
        } catch { /* 保存失败保持当前外观 */ }
      }

      const applyReplyLimit = async (value) => {
        const next = Math.max(20, Math.min(500, Math.round(Number(value) || 120)))
        setReplyLimit(next)
        try {
          await callApi('/config', { method: 'POST', body: JSON.stringify({ replyLimit: next }) })
        } catch { /* 保存失败就保持当前值 */ }
      }

      const saveVoiceKey = async () => {
        const key = voiceKey.trim()
        if (!key) return
        setVoiceBusy('key')
        setVoiceMsg(null)
        try {
          const data = await callApi('/voice/key', { method: 'POST', body: JSON.stringify({ key }) })
          if (data.voice) setVoice(data.voice)
          setVoiceKey('')
          setVoiceMsg({ tone: 'good', text: t('voiceKeyConfigured') })
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        } finally {
          setVoiceBusy('')
        }
      }

      const cloneVoice = (language) => async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        setVoiceBusy('clone')
        setVoiceMsg({ tone: 'good', text: t('voiceCloning') })
        try {
          const buffer = await file.arrayBuffer()
          const res = await fetch(API + '/voice/clone', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'content-type': file.type || 'audio/mpeg',
              'x-file-name': encodeURIComponent(file.name || 'voice.mp3'),
              'x-voice-lang': language === 'ja' ? 'ja' : 'zh',
            },
            body: buffer,
          })
          let data = null
          try { data = await res.json() } catch { /* 非 JSON */ }
          if (!res.ok || !data || data.ok === false) {
            throw new Error(data?.error || ('克隆失败（HTTP ' + res.status + '）'))
          }
          if (data.voice) setVoice(data.voice)
          setVoiceMsg({ tone: 'good', text: t('voiceCloned') })
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        } finally {
          setVoiceBusy('')
        }
      }

      const testVoice = (language) => async () => {
        setVoiceBusy('test')
        setVoiceMsg(null)
        try {
          const sample = language === 'ja' ? 'ねえ、聞こえる？涼宮春日よ。' : '喂，听得到吗？我是凉宫春日。'
          const res = await fetch(API + '/voice/play', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: sample, sessionId: 'test' }),
          })
          let data = null
          try { data = await res.json() } catch { /* 非 JSON */ }
          if (!res.ok || !data || data.ok === false) {
            throw new Error(data?.error || ('播放失败（HTTP ' + res.status + '）'))
          }
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        } finally {
          setVoiceBusy('')
        }
      }

      const removeVoice = (language) => async () => {
        setVoiceBusy('remove')
        setVoiceMsg(null)
        try {
          const query = language === 'ja' ? '?language=ja' : '?language=zh'
          const data = await callApi('/voice/model' + query, { method: 'DELETE', body: '{}' })
          if (data.voice) setVoice(data.voice)
        } catch (error) {
          setVoiceMsg({ tone: 'bad', text: String(error?.message ?? error) })
        } finally {
          setVoiceBusy('')
        }
      }

      const regenerate = () => {
        setMode('auto')
        setCustomPrompt('')
        setDirty(true)
        setMessage(null)
      }

      const editPrompt = (value) => {
        setCustomPrompt(value)
        setMode('custom')
        setDirty(true)
        setMessage(null)
      }

      const editorValue = mode === 'custom' ? customPrompt : body

      if (loadError) {
        return h('div', { 'data-hp': 'page' },
          h('div', { 'data-hp': 'center' }, t('loadFail') + '：' + loadError),
          h('div', { 'data-hp': 'actions' },
            h('button', {
              type: 'button',
              'data-hp': 'btn',
              onClick: () => { setLoadError(''); setLoaded(false); window.location.reload() },
            }, t('retry'))))
      }

      if (!loaded || !params) {
        return h('div', { 'data-hp': 'page' }, h('div', { 'data-hp': 'center' }, t('loading')))
      }

      return h('div', { 'data-hp': 'page', 'data-hp-panel-theme': theme },
        h('header', { 'data-hp': 'head' },
          h('div', { 'data-hp': 'title-row' },
            h('h2', { 'data-hp': 'title' }, t('title')),
            h('span', { 'data-hp': 'badge' }, t('badge')),
            h('div', { 'data-hp': 'theme-switch' },
              ['auto'].map((value) => h('button', {
                key: value,
                type: 'button',
                'data-hp': 'theme-btn',
                'data-active': theme === value ? '' : undefined,
                onClick: () => applyTheme(value),
              }, value === 'auto' ? t('themeAuto') : value === 'light' ? t('themeLight') : t('themeDark'))))),
          h('p', { 'data-hp': 'sub' }, t('subtitle'))),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('enable')),
              h('div', { 'data-hp': 'hint' }, t('enableHint'))),
            h(Toggle, {
              on: enabled,
              label: t('enable'),
              onChange: (value) => { setEnabled(value); setDirty(true); setMessage(null) },
            }))),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'section-title' }, t('presets')),
          h('div', { 'data-hp': 'presets' },
            presets.map((item) => h('button', {
              key: item.id,
              type: 'button',
              'data-hp': 'preset',
              'data-active': preset === item.id ? '' : undefined,
              title: item.description,
              onClick: () => choosePreset(item),
            },
            h('span', { 'data-hp': 'preset-name' }, presetName(item, t)),
            h('span', { 'data-hp': 'preset-tag' }, presetTag(item, t))))) ),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'section-title' }, t('params')),
          h('div', { 'data-hp': 'hint' }, t('paramsHint')),
          meta.map((item) => h(Slider, {
            key: item.key,
            meta: metaFor(item),
            value: params[item.key],
            onChange: (value) => patchParam(item.key, value),
          }))),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'section-title' }, t('advanced')),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('command')),
              h('div', { 'data-hp': 'hint' }, t('commandHint'))),
            h(Toggle, {
              on: params.command_mode,
              label: t('command'),
              onChange: (value) => patchParam('command_mode', value),
            })),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('address')),
            h('input', {
              type: 'text',
              maxLength: 24,
              value: params.address_user_as,
              placeholder: '你',
              'aria-label': t('address'),
              'data-hp-text': '',
              onChange: (event) => patchParam('address_user_as', event.target.value),
            }),
            h('span', { 'data-hp': 'hint' }, t('addressHint'))),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('welcome')),
            h('input', {
              type: 'text',
              maxLength: 80,
              value: welcome,
              placeholder: t('welcomePlaceholder'),
              'aria-label': t('welcome'),
              'data-hp-text': '',
              onChange: (event) => { setWelcome(event.target.value); setDirty(true); setMessage(null) },
            }),
            h('span', { 'data-hp': 'hint' }, t('welcomeHint')))),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'section-title' }, t('voiceTitle')),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('voiceEnable')),
              h('div', { 'data-hp': 'hint' }, t('voiceEnableHint'))),
            h(Toggle, {
              on: voice.enabled,
              label: t('voiceEnable'),
              onChange: (value) => patchVoice({ enabled: value }),
            })),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('voiceAuto')),
              h('div', { 'data-hp': 'hint' }, t('voiceAutoHint'))),
            h(Toggle, {
              on: voice.autoPlay,
              label: t('voiceAuto'),
              onChange: (value) => patchVoice({ autoPlay: value }),
            })),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('voiceAutoStart')),
              h('div', { 'data-hp': 'hint' }, t('voiceAutoStartHint'))),
            h(Toggle, {
              on: voice.autoStart === true,
              label: t('voiceAutoStart'),
              onChange: (value) => patchVoice({ autoStart: value }),
            })),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('voicePreload')),
              h('div', { 'data-hp': 'hint' }, t('voicePreloadHint'))),
            h(Toggle, {
              on: voice.preload !== false,
              label: t('voicePreload'),
              onChange: (value) => patchVoice({ preload: value }),
            })),
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'label' }, t('voiceUnload')),
              h('div', { 'data-hp': 'hint' }, t('voiceUnloadHint'))),
            h('div', { 'data-hp': 'row' },
              [15, 60, 120, 240].map((minutes) => h('button', {
                key: 'unload-' + minutes,
                type: 'button',
                'data-hp': 'btn',
                'data-active': Number(voice.unloadMinutes) === minutes ? '' : undefined,
                onClick: () => patchVoice({ unloadMinutes: minutes }),
              }, minutes + ' 分钟')))),
          h('div', { 'data-hp': 'hint' }, t('unload' + (Number(voice.unloadMinutes) || 60))),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('replyLimit') + ' · ' + replyLimit),
            h('input', {
              type: 'range',
              min: 20,
              max: 500,
              step: 10,
              value: replyLimit,
              'data-hp-range': '',
              onChange: (event) => applyReplyLimit(event.target.value),
            }),
            h('span', { 'data-hp': 'hint' }, t('replyLimitHint'))),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('mizuBat')),
            h('input', {
              key: 'mizu-bat-' + (voice.mizuBat || ''),
              type: 'text',
              defaultValue: voice.mizuBat || '',
              'data-hp-text': '',
              onBlur: (event) => patchVoice({ mizuBat: event.target.value }),
            }),
            h('span', { 'data-hp': 'hint' }, t('mizuBatHint'))),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('mizuUrl')),
            h('input', {
              key: 'mizu-url-' + (voice.mizuUrl || ''),
              type: 'text',
              defaultValue: voice.mizuUrl || 'http://127.0.0.1:7869',
              'data-hp-text': '',
              onBlur: (event) => patchVoice({ mizuUrl: event.target.value }),
            })),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('mizuModel')),
            h('input', {
              key: 'mizu-model-' + (voice.mizuModel || ''),
              type: 'text',
              defaultValue: voice.mizuModel || 'gptsovits/v2pro-base',
              'data-hp-text': '',
              onBlur: (event) => patchVoice({ mizuModel: event.target.value }),
            })),
          h('label', { 'data-hp': 'slider' },
            h('span', { 'data-hp': 'label' }, t('mizuVoice')),
            h('input', {
              key: 'mizu-voice-' + (voice.mizuVoice || ''),
              type: 'text',
              defaultValue: voice.mizuVoice || '',
              'data-hp-text': '',
              onBlur: (event) => patchVoice({ mizuVoice: event.target.value }),
            })),
          h('div', { 'data-hp': 'row' },
            h('button', {
              type: 'button',
              'data-hp': 'btn',
              onClick: loadVoices,
            }, t('voiceFetch'))),
          voiceOptions.length
            ? h('label', { 'data-hp': 'slider' },
                h('span', { 'data-hp': 'label' }, t('voiceSelect')),
                h('select', {
                  'data-hp-text': '',
                  value: voice.mizuVoice || '',
                  onChange: (event) => patchVoice({ mizuVoice: event.target.value }),
                },
                h('option', { value: '' }, '—'),
                voiceOptions.map((item) => h('option', { key: item.id, value: item.id },
                  (item.name || item.id) + ' · ' + item.id))))
            : null,
          h('div', { 'data-hp': 'row' },
            h('button', {
              type: 'button',
              'data-hp': 'btn',
              disabled: voiceBusy ? '' : undefined,
              onClick: testVoice('ja'),
            }, t('voiceTest'))),
          h('div', { 'data-hp': 'hint' }, t('mizuHint')),
          voiceMsg ? h('div', { 'data-hp': 'msg', 'data-tone': voiceMsg.tone }, voiceMsg.text) : null),

        h('section', { 'data-hp': 'card' },
          h('div', { 'data-hp': 'row' },
            h('div', { 'data-hp': 'grow' },
              h('div', { 'data-hp': 'section-title' }, t('preview')),
              h('div', { 'data-hp': 'hint' }, mode === 'custom' ? t('previewHint') : t('previewAutoHint'))),
            h('div', { 'data-hp': 'row' },
              mode === 'custom'
                ? h('button', {
                    type: 'button',
                    'data-hp': 'btn',
                    onClick: regenerate,
                  }, t('previewRegenerate'))
                : null,
              h('span', { 'data-hp': 'hint' }, String(editorValue.length) + ' ' + t('chars')))),
          enabled ? null : h('div', { 'data-hp': 'off' }, t('previewOff')),
          h('details', { 'data-hp': 'safety' },
            h('summary', null, t('safetyTitle')),
            h('pre', { 'data-hp': 'safety-pre' }, safety)),
          h('textarea', {
            'data-hp-prompt-editor': '',
            value: editorValue,
            spellCheck: false,
            rows: 12,
            placeholder: t('promptPlaceholder'),
            onChange: (event) => editPrompt(event.target.value),
          })),

        h('div', { 'data-hp': 'actions' },
          h('span', {
            'data-hp': 'dirty',
            'data-dirty': dirty ? '' : undefined,
          }, dirty ? t('dirty') : t('clean')),
          h('button', {
            type: 'button',
            'data-hp': 'btn',
            disabled: busy ? '' : undefined,
            onClick: reset,
          }, t('reset')),
          h('button', {
            type: 'button',
            'data-hp': 'btn',
            'data-primary': '',
            disabled: busy || !dirty ? '' : undefined,
            onClick: save,
          }, busy === 'save' ? t('saving') : t('save'))),

        message ? h('div', { 'data-hp': 'msg', 'data-tone': message.tone }, message.text) : null)
    }

    /** 春日会话里，每条回复下面署一个头像和名字。 */
    /** 每条回复开头：用小头像替掉「已完成 / 用时」那一行。 */
    function HaruhiTurnHead(props) {
      const sessionId = props?.sessionId ? String(props.sessionId) : ''
      const [active, setActive] = React.useState(() => sessionModeCache.get(sessionId) === true)
      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        if (sessionModeCache.get(sessionId) === undefined) {
          callApi('/state?sessionId=' + encodeURIComponent(sessionId))
            .then((data) => {
              if (!alive) return
              const value = data.sessionMode === 'haruhi'
              rememberMode(sessionId, value)
              setActive(value)
            })
            .catch(() => { /* 读不到就先不显示 */ })
        }
        const onChange = (event) => {
          if (event?.detail?.sessionId === sessionId) setActive(!!event.detail.active)
        }
        window.addEventListener('haruhi-mode', onChange)
        return () => {
          alive = false
          window.removeEventListener('haruhi-mode', onChange)
        }
      }, [sessionId])
      if (!sessionId || !active) return null
      return null
    }

    function HaruhiByline(props) {
      const t = makeT()
      const sessionId = props?.sessionId ? String(props.sessionId) : ''
      const [active, setActive] = React.useState(() => sessionModeCache.get(sessionId) === true)
      const [voiceCfg, setVoiceCfg] = React.useState(null)
      const [speaking, setSpeaking] = React.useState(false)
      const [targetReady, setTargetReady] = React.useState(false)
      const ref = React.useRef(null)
      const targetRef = React.useRef(null)
      const langRef = React.useRef('ja')
      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        if (sessionModeCache.get(sessionId) === undefined) {
          callApi('/state?sessionId=' + encodeURIComponent(sessionId))
            .then((data) => {
              if (!alive) return
              const value = data.sessionMode === 'haruhi'
              rememberMode(sessionId, value)
              setActive(value)
            })
            .catch(() => { /* 读不到就先不显示 */ })
        }
        const onChange = (event) => {
          if (event?.detail?.sessionId === sessionId) setActive(!!event.detail.active)
        }
        window.addEventListener('haruhi-mode', onChange)
        return () => {
          alive = false
          window.removeEventListener('haruhi-mode', onChange)
        }
      }, [sessionId])
      React.useEffect(() => {
        if (!active) return undefined
        let alive = true
        callApi('/state?sessionId=' + encodeURIComponent(sessionId))
          .then((data) => {
            if (!alive) return
            const language = data.language === 'ja' ? 'ja' : 'zh'
            langRef.current = language
            setVoiceCfg({ ...(data.voice || {}), language })
          })
          .catch(() => { /* 没有语音状态就不显示按钮 */ })
        const onVoice = (event) => {
          if (event?.detail?.voice) setVoiceCfg(event.detail.voice)
        }
        const onLanguage = (event) => {
          const next = event?.detail?.language === 'ja' ? 'ja' : 'zh'
          langRef.current = next
          setVoiceCfg((previous) => (previous ? { ...previous, language: next } : previous))
        }
        window.addEventListener('haruhi-voice', onVoice)
        window.addEventListener('haruhi-language', onLanguage)
        return () => {
          alive = false
          window.removeEventListener('haruhi-voice', onVoice)
          window.removeEventListener('haruhi-language', onLanguage)
        }
      }, [active, sessionId])
      const speak = React.useCallback(async () => {
        const target = targetRef.current
        fetch(API + '/debug', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'speak', hasTarget: Boolean(target), time: Date.now() }),
        }).catch(() => {})
        if (!target) return
        // 只取“上一条动作行之后、当前动作行之前”的段落
        const anchor = ref.current
        const row = anchor ? anchor.parentElement : null
        let text = ''
        if (anchor && row) {
          const bylines = Array.from(document.querySelectorAll('[data-hp-byline]'))
          const index = bylines.indexOf(anchor)
          const prevRow = index > 0 ? bylines[index - 1].parentElement : null
          const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING
          const paragraphs = Array.from(document.querySelectorAll('p')).filter((node) => {
            const value = (node.innerText || '').trim()
            if (value.length < 2) return false
            if (!(node.compareDocumentPosition(row) & FOLLOWING)) return false
            if (prevRow && !(prevRow.compareDocumentPosition(node) & FOLLOWING)) return false
            return true
          })
          text = paragraphs.map((node) => (node.innerText || '').trim()).join('\n')
        }
        if (!text) {
          const clone = target.cloneNode(true)
          clone.querySelectorAll('[data-hp-byline],[data-hp-abs-avatar],button,[role="button"],time').forEach((node) => node.remove())
          text = (clone.innerText || clone.textContent || '').trim()
        }
        text = text
          .replace(/\d{1,2}:\d{2}/g, '')
          .replace(/复制|点赞|点踩|语音|春日/g, '')
          .trim()
        if (!text) return
        fetch(API + '/debug', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'speak-text', length: text.length, head: text.slice(0, 60), time: Date.now() }),
        }).catch(() => {})
        setSpeaking(true)
        try {
          const response = await fetch(API + '/voice/play', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: text.slice(0, 260), sessionId }),
          })
          const body = await response.text()
          fetch(API + '/debug', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'speak-result', status: response.status, body: body.slice(0, 300), time: Date.now() }),
          }).catch(() => {})
        } catch (error) {
          fetch(API + '/debug', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'speak-error', message: String(error?.message ?? error), time: Date.now() }),
          }).catch(() => {})
        } finally {
          setSpeaking(false)
        }
      }, [])
      React.useEffect(() => {
        if (!active || !targetReady || !voiceCfg?.enabled || !voiceCfg?.autoPlay) return
        const messageId = props?.messageId
          ? String(props.messageId)
          : (targetRef.current?.innerText || '').trim().slice(0, 60)
        if (!messageId) return
        const key = sessionId + ':' + messageId
        if (autoPlayedIds.has(key)) return
        const anchor = ref.current
        if (!anchor) return
        const all = Array.from(document.querySelectorAll('[data-hp-byline]')).filter((node) => node.getClientRects().length > 0)
        if (all[all.length - 1] !== anchor) return
        if (Date.now() < autoPlayCutoff) {
          autoPlayedIds.add(key)
          return
        }
        autoPlayedIds.add(key)
        if (autoPlayedIds.size > 300) autoPlayedIds.clear()
        speak()
      }, [active, targetReady, voiceCfg, speak, sessionId, props?.messageId])
      React.useLayoutEffect(() => {
        if (!active) return undefined
        const anchor = ref.current
        if (!anchor) return undefined

        // 当前消息正文段落：从动作行往前找最近的一个 p
        const row = anchor.parentElement
        let target = null
        let candidate = row ? row.previousElementSibling : null
        while (candidate && !target) {
          if (candidate.matches && candidate.matches('p')) {
            target = candidate
          } else if (candidate.querySelectorAll) {
            const paragraphs = candidate.querySelectorAll('p')
            if (paragraphs.length) target = paragraphs[paragraphs.length - 1]
          }
          candidate = candidate.previousElementSibling
        }
        if (!target) {
          target = row
          while (target && target !== document.body) {
            const rect = target.getBoundingClientRect()
            const text = (target.textContent || '').trim()
            if (rect.height >= 36 && rect.height < 2000 && rect.width > 200 && text.length > 8) break
            target = target.parentElement
          }
        }
        if (!target || target === document.body) return undefined
        targetRef.current = target
        setTargetReady(true)
        return () => {
          targetRef.current = null
          setTargetReady(false)
        }
      }, [active, sessionId])
      if (!sessionId || !active) return null
      const canVoice = voiceCfg?.enabled && voiceCfg?.mizuVoice
      return h('span', { ref, 'data-hp-byline': '' },
        canVoice
          ? h('button', {
              type: 'button',
              'data-hp': 'voice',
              disabled: speaking ? '' : undefined,
              onClick: speak,
            }, speaking ? '…' : t('voicePlay'))
          : null)
    }

    /** 输入框左侧的开关：只切换当前会话，切到春日就按春日说话。 */
    function QuickSwitch(props) {
      const t = makeT()
      const sessionId = props?.sessionId ? String(props.sessionId) : ''
      const [mode, setMode] = React.useState('ai')
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [, forceRender] = React.useReducer((n) => n + 1, 0)

      React.useEffect(() => {
        if (!localeRef?.subscribe) return undefined
        try {
          return localeRef.subscribe(() => forceRender())
        } catch {
          return undefined
        }
      }, [])

      const load = React.useCallback(async () => {
        if (!sessionId) return
        try {
          const data = await callApi('/state?sessionId=' + encodeURIComponent(sessionId))
          const active = data.sessionMode === 'haruhi'
          setMode(active ? 'haruhi' : 'ai')
          setFailed(false)
          setHaruhiActive(active)
          sessionModeCache.set(String(sessionId), active)
          rememberMode(sessionId, active)
          setChatWallpaper(active)
          autoPlayCutoff = Date.now() + 1200
        } catch (error) {
          /* 读不到就保持原状，点一下仍会尝试 */
        }
      }, [sessionId])

      React.useEffect(() => { load() }, [load])
      React.useEffect(() => () => setChatWallpaper(false), [])

      const toggle = async () => {
        if (!sessionId || busy) return
        const previous = mode
        const next = mode === 'haruhi' ? 'ai' : 'haruhi'
        setBusy(true)
        setFailed(false)
        setMode(next)
        setHaruhiActive(next === 'haruhi')
        setChatWallpaper(next === 'haruhi')
        try {
          const data = await callApi('/session', {
            method: 'POST',
            body: JSON.stringify({ sessionId, mode: next }),
          })
          setMode(data.sessionMode === 'haruhi' ? 'haruhi' : 'ai')
          setHaruhiActive(data.sessionMode === 'haruhi')
          sessionModeCache.set(String(sessionId), data.sessionMode === 'haruhi')
          rememberMode(sessionId, data.sessionMode === 'haruhi')
          setChatWallpaper(data.sessionMode === 'haruhi')
        } catch (error) {
          setMode(previous)
          setHaruhiActive(previous === 'haruhi')
          setChatWallpaper(previous === 'haruhi')
          setFailed(true)
        } finally {
          setBusy(false)
        }
      }

      const active = mode === 'haruhi'
      const title = failed ? t('quickFail') : (active ? t('quickBack') : t('quickTo'))

      return h('button', {
        type: 'button',
        'data-hp-quick-btn': '',
        'data-on': active ? '' : undefined,
        'data-err': failed ? '' : undefined,
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': title,
        title,
        disabled: !sessionId || busy ? '' : undefined,
        onClick: toggle,
      },
      h('span', { 'data-hp-star': '', 'aria-hidden': 'true' }, '✦'),
      h('span', null, t('quickButton')),
      h('span', { 'data-hp-dot': '', 'aria-hidden': 'true' }))
    }

    /** 全屏时在输入框左侧给一个「窗口」按钮，点一下就退回去。 */
    function FullscreenExit() {
      const t = makeT()
      const [full, setFull] = React.useState(Boolean(document.fullscreenElement))
      React.useEffect(() => {
        const onChange = () => setFull(Boolean(document.fullscreenElement))
        document.addEventListener('fullscreenchange', onChange)
        return () => document.removeEventListener('fullscreenchange', onChange)
      }, [])
      if (!full) return null
      return h('button', {
        type: 'button',
        'data-hp-quick-btn': '',
        title: t('exitFullscreen'),
        onClick: exitFullscreen,
      },
      h('span', null, t('exitFullscreen')))
    }

    let splashShown = false
    let audioCtx = null
    let soundPlayed = false

    /** 退出全屏（只有用户自己进全屏时才用得到）。 */
    function exitFullscreen() {
      try {
        sessionStorage.setItem('haruhi-windowed', '1')
      } catch {
        /* 没有存储就算了 */
      }
      if (!document.fullscreenElement) return
      try {
        const result = document.exitFullscreen?.()
        if (result && typeof result.catch === 'function') result.catch(() => { /* 忽略 */ })
      } catch {
        /* 环境不支持 */
      }
    }

    /** 启动音效：短促的上行琶音 + 噪声扫频，明亮、带点横冲直撞的劲儿。 */
    function playStartupSound() {
      if (soundPlayed) return
      const AudioCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioCtor) return
      try {
        if (!audioCtx) audioCtx = new AudioCtor()
        const ctx = audioCtx
        const run = () => {
          if (soundPlayed) return
          soundPlayed = true
          const now = ctx.currentTime + 0.02
          const master = ctx.createGain()
          master.gain.setValueAtTime(0.0001, now)
          master.gain.exponentialRampToValueAtTime(0.16, now + 0.04)
          master.gain.exponentialRampToValueAtTime(0.0001, now + 1.15)
          master.connect(ctx.destination)

          const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate)
          const data = buffer.getChannelData(0)
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
          const noise = ctx.createBufferSource()
          noise.buffer = buffer
          const hp = ctx.createBiquadFilter()
          hp.type = 'highpass'
          hp.frequency.setValueAtTime(420, now)
          hp.frequency.exponentialRampToValueAtTime(2600, now + 0.45)
          const ng = ctx.createGain()
          ng.gain.setValueAtTime(0.05, now)
          ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)
          noise.connect(hp).connect(ng).connect(master)
          noise.start(now)
          noise.stop(now + 0.5)

          ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const t = now + 0.12 + i * 0.11
            const osc = ctx.createOscillator()
            osc.type = i === 3 ? 'triangle' : 'square'
            const gain = ctx.createGain()
            gain.gain.setValueAtTime(0.0001, t)
            gain.gain.exponentialRampToValueAtTime(0.085, t + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
            osc.frequency.setValueAtTime(freq, t)
            osc.connect(gain).connect(master)
            osc.start(t)
            osc.stop(t + 0.26)
          })

          const shine = ctx.createOscillator()
          shine.type = 'sine'
          shine.frequency.setValueAtTime(1567.98, now + 0.62)
          const sg = ctx.createGain()
          sg.gain.setValueAtTime(0.0001, now + 0.62)
          sg.gain.exponentialRampToValueAtTime(0.07, now + 0.66)
          sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.15)
          shine.connect(sg).connect(master)
          shine.start(now + 0.62)
          shine.stop(now + 1.16)
        }

        if (ctx.state === 'suspended') {
          ctx.resume().then(run).catch(() => { /* 浏览器拦了就先静音 */ })
          const kick = () => {
            document.removeEventListener('pointerdown', kick, true)
            document.removeEventListener('keydown', kick, true)
            if (soundPlayed) return
            ctx.resume().then(run).catch(() => { /* 还是不行就算了 */ })
          }
          document.addEventListener('pointerdown', kick, true)
          document.addEventListener('keydown', kick, true)
        } else {
          run()
        }
      } catch {
        /* 没有音频环境就算了 */
      }
    }

    const SPARKS = [
      ['14%', '24%', 4, '0s'],
      ['82%', '18%', 3, '.4s'],
      ['8%', '70%', 3, '.9s'],
      ['88%', '66%', 4, '1.3s'],
      ['28%', '6%', 3, '.2s'],
      ['68%', '88%', 3, '1.1s'],
      ['50%', '4%', 2, '1.6s'],
      ['94%', '46%', 2, '.7s'],
    ]

    /** 启动动画：每次页面加载播一次，可点击跳过。 */
    function Splash() {
      const t = makeT()
      const dialogRef = React.useRef(null)
      const [out, setOut] = React.useState(false)
      const [gone, setGone] = React.useState(splashShown)
      const [ready, setReady] = React.useState(true)
      const [name, setName] = React.useState('鳕鱼')
      const [welcomeText, setWelcomeText] = React.useState('欢迎，鳕鱼')
      const done = React.useCallback(() => {
        setOut(true)
        setTimeout(() => setGone(true), 480)
      }, [])
      React.useEffect(() => {
        setReady(true)
      }, [])
      React.useEffect(() => {
        document.documentElement.setAttribute('data-hp-splashing', '1')
        return () => {
          document.documentElement.removeAttribute('data-hp-splashing')
        }
      }, [])
      React.useEffect(() => {
        if (!gone) return
        document.documentElement.setAttribute('data-hp-ready', '1')
      }, [gone])
      React.useEffect(() => {
        const el = dialogRef.current
        if (!el) return undefined
        try {
          if (!el.open) el.showModal()
        } catch {
          /* 已经打开或环境不支持 */
        }
        return () => {
          try { el.close() } catch { /* 已经关了 */ }
        }
      }, [])
      React.useEffect(() => {
        if (!ready) return undefined
        playStartupSound()
        const fade = setTimeout(() => setOut(true), 1600)
        const end = setTimeout(() => setGone(true), 2000)
        return () => { clearTimeout(fade); clearTimeout(end) }
      }, [ready])
      React.useEffect(() => {
        let alive = true
        callApi('/state')
          .then((data) => {
            const custom = typeof data.welcome === 'string' ? data.welcome.trim() : ''
            if (custom) {
              setWelcomeText(custom)
              return
            }
            const address = data?.params?.address_user_as
            if (typeof address === 'string' && address && address !== '你') {
              setName(address)
              setWelcomeText('欢迎，' + address)
            }
          })
          .catch(() => { /* 读不到就用默认称呼 */ })
        return () => { alive = false }
      }, [])
      if (gone) return null
      return h('dialog', {
        ref: dialogRef,
        'data-hp-splash': '',
        'data-out': out ? '' : undefined,
        'aria-label': t('splashSkip'),
        onClick: done,
        onCancel: (event) => {
          event.preventDefault()
          done()
        },
      },
      h('div', { 'data-hp-splash-body': '' },
        h('img', { 'data-hp-splash2-avatar': '', src: '/api/haruhi-persona/icon', alt: '' }),
        h('div', { 'data-hp-splash2-line': '' }),
        h('div', { 'data-hp-splash2-title': '' }, '凉宫春日'),
        h('div', { 'data-hp-splash2-sub': '' }, 'S O S 团'),
        h('div', { 'data-hp-splash2-welcome': '' }, welcomeText),
        h('div', { 'data-hp-splash2-wsub': '' }, '这里是 SOS 团'),
        h('div', { 'data-hp-splash2-bar': '' }, h('i', null))),
      h('div', { 'data-hp-splash2-skip': '' }, t('splashSkip')))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-hp-style', 'haruhi-persona')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'haruhi-persona: 设置页样式')
        startStatusHider(ctx)
        const decorateAvatars = () => {
          const paragraphs = Array.from(document.querySelectorAll('p')).filter((node) => {
            if (!node.getClientRects().length) return false
            if (node.closest('form, textarea, [contenteditable="true"], [role="textbox"], button, [data-hp-byline]')) return false
            return (node.textContent || '').trim().length >= 1
          })
          for (const byline of document.querySelectorAll('[data-hp-byline]')) {
            if (byline.getClientRects().length === 0) continue
            const bylineRect = byline.getBoundingClientRect()
            let paragraph = null
            let best = Infinity
            for (const node of paragraphs) {
              const nodeRect = node.getBoundingClientRect()
              if (nodeRect.left > bylineRect.left + 120) continue
              const distance = Math.abs(nodeRect.top - bylineRect.top)
              if (distance < best) {
                best = distance
                paragraph = node
              }
            }
            if (!paragraph) continue
            // 向上找到这条回复的第一段（同一组连续段落）
            let index = paragraphs.indexOf(paragraph)
            let first = paragraph
            while (index > 0) {
              const prev = paragraphs[index - 1]
              const gap = first.getBoundingClientRect().top - prev.getBoundingClientRect().top
              if (gap > 150) break
              first = prev
              index -= 1
            }
            paragraph = first
            if (paragraph.querySelector('[data-hp-abs-avatar]')) continue
            // 同一条回复被拆成多段时，只给第一段挂头像
            const paragraphTop = paragraph.getBoundingClientRect().top
            const nearby = Array.from(document.querySelectorAll('[data-hp-abs-avatar]')).some((img) => {
              const host = img.parentElement
              if (!host) return false
              return Math.abs(host.getBoundingClientRect().top - paragraphTop) < 90
            })
            if (nearby) continue
            if (getComputedStyle(paragraph).position === 'static') paragraph.style.position = 'relative'
            const img = document.createElement('img')
            img.src = '/api/haruhi-persona/icon'
            img.alt = '春日'
            img.setAttribute('data-hp-abs-avatar', '')
            img.style.cssText = 'position:absolute;top:0;left:-32px;width:24px;height:24px;border-radius:50%;object-fit:cover;border:2px solid var(--dsw-alias-border-l2);pointer-events:none;display:block;z-index:3;'
            paragraph.appendChild(img)
          }
        }
        decorateAvatars()
        const avatarTimer = setInterval(decorateAvatars, 800)
        const avatarObserver = new MutationObserver(() => {
          decorateAvatars()
        })
        avatarObserver.observe(document.body, { childList: true, subtree: true })
        ctx.effect(() => () => {
          clearInterval(avatarTimer)
          avatarObserver.disconnect()
        }, 'haruhi-persona: 头像维护')
        const syncTheme = () => {
          try {
            const themeAttr = document.documentElement.getAttribute('data-theme')
              || document.body.getAttribute('data-theme')
              || document.documentElement.getAttribute('data-dsw-theme')
            let raw = String(themeAttr || '').toLowerCase()
            if (!raw.includes('light') && !raw.includes('dark')) {
              raw = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim()
              if (!raw || /rgba\([^)]*,\s*0\s*\)/.test(raw)) {
                let el = document.body
                while (el && el !== document.documentElement) {
                  const bg = getComputedStyle(el).backgroundColor
                  if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) { raw = bg; break }
                  el = el.parentElement
                }
              }
            }
            let lum = 24
            const match = String(raw).match(/rgba?\(([^)]+)\)/)
            const hex = String(raw).match(/^#([0-9a-f]{6})/i)
            if (match) {
              const parts = match[1].split(',').map(Number)
              if (parts.length >= 3) lum = 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2]
            } else if (hex) {
              const value = parseInt(hex[1], 16)
              const r = (value >> 16) & 255
              const g = (value >> 8) & 255
              const b = value & 255
              lum = 0.299 * r + 0.587 * g + 0.114 * b
            }
            document.documentElement.setAttribute('data-hp-theme', lum > 140 ? 'light' : 'dark')
          } catch {
            document.documentElement.setAttribute('data-hp-theme', 'dark')
          }
        }
        syncTheme()
        const themeTimer = setInterval(syncTheme, 1500)
        const readyTimer = setTimeout(() => document.documentElement.setAttribute('data-hp-ready', '1'), 5000)
        ctx.effect(() => () => {
          clearInterval(themeTimer)
          clearTimeout(readyTimer)
        }, 'haruhi-persona: 主题跟随')

        const onEsc = (event) => {
          if (event.key === 'Escape' && document.fullscreenElement) exitFullscreen()
        }
        document.addEventListener('keydown', onEsc, true)
        ctx.effect(() => () => document.removeEventListener('keydown', onEsc, true), 'haruhi-persona: 退出全屏')

        const get = typeof ctx.get === 'function' ? (key) => ctx.get(key) : () => undefined
        localeRef = get('locale') || null
        const slots = get('slots') || ctx.slots
        if (!slots) return

        slots.inject('settings.section', () => slots.register({
          name: 'settings.section',
          id: 'haruhi-persona',
          order: 35,
          label: () => (activeLang().startsWith('zh') ? DICT.zh.nav : DICT.en.nav),
        }, () => h(PanelBoundary, null, h(Panel))))

        slots.inject('conversation.input.left', () => slots.register({
          name: 'conversation.input.left',
          id: 'haruhi-persona',
          order: 40,
          label: () => (activeLang().startsWith('zh') ? DICT.zh.quickButton : DICT.en.quickButton),
        }, QuickSwitch))

        slots.inject('conversation.input.left', () => slots.register({
          name: 'conversation.input.left',
          id: 'haruhi-persona-window',
          order: 41,
        }, FullscreenExit))

        try {
          slots.inject('conversation.chat.node', () => {
            try {
              return slots.register({
                name: 'conversation.chat.node',
                key: 'turn-process',
              }, HaruhiTurnHead)
            } catch (error) {
              return () => {}
            }
          })
        } catch (error) {
          /* 这个槽位挂了也不能拖垮整个插件 */
        }

        slots.inject('conversation.chat.assistant-actions', () => slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'haruhi-persona-byline',
          order: 100,
        }, HaruhiByline))

        slots.inject('shell.overlay', () => slots.register({
          name: 'shell.overlay',
          id: 'haruhi-persona-splash',
          order: -100,
        }, Splash))
      },
    }
  },
})
