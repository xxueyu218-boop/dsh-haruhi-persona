# dsh-haruhi-persona

凉宫春日风格的可调人格插件（DSH bundle）。**同人作品，非官方。**

## 功能

- 输入框左侧「春日」按钮：按会话切换；亮起才是春日，切回普通立即失效。
- 0–100 人格滑块 + 默认预设；人格提示词可在设置页直接编辑，固定安全段置顶。
- 启动动画、启动音效、自定义启动欢迎语。
- 春日会话直接回答，不显示思考 / 已完成 / 用时等状态行。
- 颜文字表情，频率由「表情频率」滑块控制。
- 回复字数上限滑块（20–500 字）。
- 4K 聊天壁纸，仅春日会话启用，浅色/深色分别适配。
- 每轮回复左侧头像。
- **本地语音**：通过本机 Mizuoto TTS WebUI 合成，Windows 原生播放，支持参考音频克隆。
- 语音设置可分别开关「开机自动启动服务」和「打开插件时加载模型」，控制显存占用。

## 安装

### 方式一：从 Release 安装（推荐）

1. 在本仓库右侧 **Releases** 里下载 `dsh-haruhi-persona-<版本>.tgz`。
2. 执行：

```bash
dsh plugin --profile <profile> add "下载路径/dsh-haruhi-persona-<版本>.tgz"
```

### 方式二：从仓库源码链接

```bash
dsh plugin --profile <profile> add link:/path/to/dsh-haruhi-persona
```

安装后在 **设置 → 凉宫春日** 调整；输入框左侧点「春日」切换当前会话。

完整的安装、模型、音色和排错步骤见 **[docs/SETUP.md](docs/SETUP.md)**。

## 语音：需要你另外安装本地 TTS

语音不是插件自带的，也不包含模型和音色。插件只通过本机 HTTP 调用
[Mizuoto TTS WebUI](https://github.com/licyk/qwen-tts-webui)。

### 1. 安装 Mizuoto

- 项目：<https://github.com/licyk/qwen-tts-webui>
- Windows 整合包 / 文档：<https://licyk.github.io/sd-webui-all-in-one/portable/portable>
- 视频教程：<https://www.bilibili.com/video/BV1sr6GB5Emd/>

整合包自带 Python 和 WebUI；解压后按文档启动，默认监听 `http://127.0.0.1:7869`。

### 2. 下载语音模型

在 Mizuoto 的 **模型** 页面下载：

```
gptsovits/v2pro-base   （约 300 MB + 资源，显存约 2.5 GB）
```

6 GB 显存可用；首次加载会慢，之后合成约 1 秒。

> **网络提示**：模型文件较大，国内网络建议挂代理（梯子），或在 Mizuoto 启动时加
> `--proxy http://127.0.0.1:7877`，否则容易下载失败或中断。Mizuoto 设置里也可以切换
> `huggingface` / `modelscope` 下载源。

### 3. 创建音色

1. 准备 5–10 秒**日语**参考音频；
2. 在 Mizuoto 的 **音色** 页面新建音色，上传音频并填写对应文本；
3. 保存后复制音色 ID。

### 4. 填进插件

**设置 → 凉宫春日 → 语音回复**：

- Mizuoto 地址：`http://127.0.0.1:7869`（端口不同时自动尝试 7869/7870/7871）
- 模型 ID：`gptsovits/v2pro-base`
- 音色 ID：粘贴你的音色 ID
- Mizuoto 启动脚本（可选）：填你自己启动 Mizuoto 的 `.bat` 路径，插件才能自动启动/开机自启；留空就手动开

点「试听」确认，然后回聊天使用「语音」按钮或自动朗读。

### 说明

- 语音播放目前只支持 **Windows**（通过 ffmpeg + Windows 原生播放）；
- 中文回复会先翻译成日语再合成，翻译需要外网；
- 模型、音色、参考音频都由用户自行安装和创建，插件不附带、不上传。

## 第三方软件与署名

本插件**不包含、不重新分发**下列软件或模型，仅在本机调用其 HTTP 接口：

- **Mizuoto TTS WebUI / Qwen3-TTS / GPT-SoVITS** — 作者 **licyk**
  - <https://github.com/licyk/qwen-tts-webui>
  - <https://licyk.github.io/sd-webui-all-in-one/portable/portable>
- 视频教程：<https://www.bilibili.com/video/BV1sr6GB5Emd/>

以上软件、模型、教程的版权归原作者所有；本插件与作者无隶属或官方授权关系。
使用前请阅读对应项目的许可证，尤其是模型和声音克隆的授权条款。

## 资源

- `icon.jpg`：插件图标 / 启动动画头像
- `background.jpg`：4K 聊天壁纸
- 图片版权归原作者，仅随本插件本地使用，不随代码的 MIT 许可分发。

## 许可

代码 MIT；角色名与设定归原作者及权利方所有。本插件不包含、不复制原作台词，不代表任何官方授权。
