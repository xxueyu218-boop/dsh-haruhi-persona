# v1.14.0 更新说明

## 本地语音版：中文回复 + 日语朗读

### 本次更新

- 语音从云端改为完全本地：接入 Mizuoto TTS WebUI，不需要 API Key，不按次收费
- Windows 原生播放，点语音就能出声
- 中文文字回复，自动翻译成日语再合成
- 回复字数上限可调（20–500 字）
- 语音设置新增：
  - 开机自动启动服务
  - 打开插件时加载模型（关闭立即卸载，释放显存）
  - 空闲卸载模型：15 / 60 / 120 / 240 分钟
  - 「获取音色列表」按钮，选中音色自动填 ID
- Mizuoto 启动脚本路径可配置，适配不同电脑
- 预设精简为「默认」一套
- 修复：语音重复上一条、长回复不触发、字数上限保存无效、模型/音色显示旧值、翻译偶发失败

### 安装

```bash
dsh plugin --profile <profile> add "dsh-haruhi-persona-1.14.0.tgz"
```

装好后在 **设置 → 凉宫春日** 配置。

### 语音需要自己准备

插件**不包含**模型、音色和参考音频。

1. 安装 Mizuoto：
   - 整合包：<https://licyk.github.io/sd-webui-all-in-one/portable/portable>
   - 项目：<https://github.com/licyk/qwen-tts-webui>
   - 视频：<https://www.bilibili.com/video/BV1sr6GB5Emd/>
2. 下载模型，推荐 `gptsovits/v2pro-base`（显存约 2.5 GB，约 1–2 秒）
3. 用有权使用的 5–10 秒日语参考音频创建音色
4. 插件设置里点「获取音色列表」，选中音色即可

完整步骤见 `docs/SETUP.md`。

### 模型选择

| 模型 | 显存 | 速度 | 建议 |
|---|---|---|---|
| `gptsovits/v2pro-base` | 约 2.5 GB | 快，约 1–2 秒 | 推荐 |
| `qwen3tts/0.6b-base` | 约 4 GB | 慢，十余秒 | GPT-SoVITS 装不上时的备选 |

只装一个即可；换模型后插件里的模型 ID 要同步改。

### 要求

- Windows 10/11
- 建议 6 GB 显存；纯 CPU 会很慢
- 下载模型建议挂代理
- 翻译需要外网

### 已知限制

- 语音播放目前仅 Windows
- 模型、音色、参考音频需用户自备
- 首次加载模型较慢，之后约 1–2 秒
- 闲置卸载后，下次首句会重新加载

### 署名

Mizuoto TTS WebUI / Qwen3-TTS / GPT-SoVITS 作者：**licyk**

本插件不包含、不重新分发上述软件与模型，仅调用本机 HTTP 接口，与作者无隶属或官方授权关系。
