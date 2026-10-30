# v1.15.0 更新说明

## 本次更新

- 版本号更新为 `1.15.0`，仓库源码与安装包对齐
- 提示词调整：
  - 只用日式颜文字，不再输出 😊 这类彩色 emoji
  - 明确禁止输出 `<system_warning>` 或“以上内容可能无关”这类安全提示
  - **整条回复只用一个自然段，不空行分段**，动作和停顿写在同一段
- 状态栏：春日模式下保留「正在输入」「正在回复」，其余生成类状态继续隐藏
- 设置面板主题：只作用于「凉宫春日」页，跟随系统浅色/深色，暖金强调色
- 修复浅色/跟随系统下聊天壁纸不显示、过亮的问题
- 情感表达加强：先有情绪再说话，用停顿、改口、语气和短句表现，不再平铺直叙
- 头像：
  - 多段回复只保留一个头像
  - 头像挂在回复的**第一段**左侧，而不是最后一段
  - 连续段落按间距合并，减少每条消息多个头像
- 其余功能与 1.14.0 一致：本地 Mizuoto 语音、回复字数上限、显存开关、空闲卸载、音色列表、默认预设

## 安装

```bash
dsh plugin --profile <profile> add "dsh-haruhi-persona-1.15.0.tgz"
```

## 语音依赖

插件不包含模型、音色和参考音频，需要自行安装：

- Mizuoto TTS WebUI：https://github.com/licyk/qwen-tts-webui
- Windows 整合包：https://licyk.github.io/sd-webui-all-in-one/portable/portable
- 模型：`gptsovits/v2pro-base`（推荐）或 `qwen3tts/0.6b-base`
- 用自己有权使用的 5–10 秒日语参考音频创建音色

完整步骤见 `docs/SETUP.md`。

## 已知限制

- 语音播放目前仅 Windows
- 翻译需要外网
- 首次加载模型较慢，之后约 1–2 秒

## 署名

Mizuoto TTS WebUI / Qwen3-TTS / GPT-SoVITS 作者：**licyk**

本插件不包含、不重新分发上述软件与模型，仅调用本机 HTTP 接口。
