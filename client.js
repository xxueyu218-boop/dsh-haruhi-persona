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
    const STATUS_RE = /正在(?:分析请求|调取命令|调用命令|执行命令|调用工具)|深度(?:求索|思考)中|(?:调取|调用|执行)(?:命令|工具|指令)|思考中|已完成|用时|完成\s*·\s*用时/
    /** 只有整行本身就是状态时才收掉；别碰输入框下方的用量条。 */
    const STRICT_RE = /^(正在分析请求|深度求索中|深度思考中|正在调取(?:命令|工具)|正在调用(?:命令|工具)|调取命令|调用命令|已完成|用时\s*\d+\s*秒)/
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
        resetDone: '已恢复为标准版。',
        dirty: '有未保存的修改',
        clean: '已保存',
        loading: '读设置中…',
        loadFail: '读不到设置',
        retry: '重试',
        chars: '字',
        presetCalm: '冷静版',
        presetCalmTag: '低刺激 · 适合工作',
        presetStandard: '标准版',
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
        presetStandard: 'Standard',
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

    function presetName(preset, t) {
      if (PRESET_IDS.includes(preset.id)) {
        return t('preset' + preset.id.charAt(0).toUpperCase() + preset.id.slice(1))
      }
      return preset.name
    }

    function presetTag(preset, t) {
      if (PRESET_IDS.includes(preset.id)) {
        return t('preset' + preset.id.charAt(0).toUpperCase() + preset.id.slice(1) + 'Tag')
      }
      return preset.tagline
    }

    const CSS = `
html[data-hp-splashing] body{background-color:#05070c !important;}
html[data-hp-chat="on"][data-hp-ready="1"] body::after{content:'';position:fixed;inset:0;background:url('/api/haruhi-persona/background?v=4k2') center/cover no-repeat;pointer-events:none;z-index:2147483646;mix-blend-mode:soft-light;opacity:.30;}
html[data-hp-theme="light"][data-hp-chat="on"][data-hp-ready="1"] body::after{mix-blend-mode:multiply;opacity:.24;}
html[data-hp-theme="dark"][data-hp-chat="on"][data-hp-ready="1"] body::after{mix-blend-mode:screen;opacity:.38;}
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
[data-hp-byline]{display:inline-block;width:0;height:0; overflow:visible;}
[data-hp-fixed-avatar]{position:fixed;width:24px;height:24px;border-radius:50%;object-fit:cover;border:2px solid var(--dsw-alias-border-l2);z-index:20;pointer-events:none;visibility:hidden;}
[data-hp-dot]{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);}
[data-hp-quick-btn][data-on] [data-hp-dot]{background:var(--dsw-alias-state-success-primary);}
[data-hp-quick-btn][disabled]{opacity:.45;cursor:default;}
[data-hp-quick-btn][data-err]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
[data-hp="safety"]{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-layer-2);}
[data-hp="safety"] summary{cursor:pointer;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}
[data-hp="safety-pre"]{margin:7px 0 0;white-space:pre-wrap;word-break:break-word;max-height:160px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);}
[data-hp-prompt-editor]{width:100%;box-sizing:border-box;min-height:200px;resize:vertical;padding:9px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:17px;}
[data-hp-prompt-editor]:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
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
          callApi('/preview', { method: 'POST', body: JSON.stringify({ params, mode: 'auto', customPrompt: '' }) })
            .then((data) => {
              if (!alive) return
              setSafety(data.safety || '')
              setBody(data.body || '')
            })
            .catch(() => { /* 预览失败不打断编辑 */ })
        }, 180)
        return () => { alive = false; clearTimeout(timer) }
      }, [loaded, params, mode])

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
            body: JSON.stringify({ enabled, params, preset, mode, customPrompt, welcome }),
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

      return h('div', { 'data-hp': 'page' },
        h('header', { 'data-hp': 'head' },
          h('div', { 'data-hp': 'title-row' },
            h('h2', { 'data-hp': 'title' }, t('title')),
            h('span', { 'data-hp': 'badge' }, t('badge'))),
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
      return h('div', { 'data-hp-turn-head': '' },
        h('img', { src: '/api/haruhi-persona/icon', alt: '春日' }),
        h('span', null, '春日'))
    }

    function HaruhiByline(props) {
      const sessionId = props?.sessionId ? String(props.sessionId) : ''
      const [active, setActive] = React.useState(() => sessionModeCache.get(sessionId) === true)
      const ref = React.useRef(null)
      const imgRef = React.useRef(null)
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
      React.useLayoutEffect(() => {
        if (!active) return undefined
        const anchor = ref.current
        if (!anchor) return undefined
        let box = anchor.parentElement
        while (box && box !== document.body) {
          const rect = box.getBoundingClientRect()
          const text = (box.textContent || '').trim()
          if (rect.height > 100 && rect.height < 700 && rect.width > 200 && text.length > 40) break
          box = box.parentElement
        }
        const target = box && box !== document.body ? box : null
        let raf = 0
        const update = () => {
          if (raf) return
          raf = requestAnimationFrame(() => {
            raf = 0
            const img = imgRef.current
            if (!img) return
            if (!target) {
              img.style.visibility = 'hidden'
              return
            }
            const rect = target.getBoundingClientRect()
            const visible = rect.bottom > 8 && rect.top < window.innerHeight - 8
            img.style.visibility = visible ? 'visible' : 'hidden'
            img.style.left = Math.max(8, Math.round(rect.left - 32)) + 'px'
            img.style.top = Math.round(rect.top + 2) + 'px'
          })
        }
        update()
        document.addEventListener('scroll', update, true)
        window.addEventListener('resize', update)
        return () => {
          if (raf) cancelAnimationFrame(raf)
          document.removeEventListener('scroll', update, true)
          window.removeEventListener('resize', update)
        }
      }, [active, sessionId])
      if (!sessionId || !active) return null
      return h('span', { ref, 'data-hp-byline': '' },
        h('img', {
          ref: imgRef,
          'data-hp-fixed-avatar': '',
          src: '/api/haruhi-persona/icon',
          alt: '春日',
        }))
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
          setChatWallpaper(active)        } catch (error) {
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

        const syncTheme = () => {
          try {
            const raw = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base').trim()
              || getComputedStyle(document.body).backgroundColor
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
        }, () => h(Panel)))

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
