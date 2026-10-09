# 词捕朗读能力调研

调研日期：2026-10-09。仅调研，未给正式插件接入朗读、下载模型或调用付费语音接口。

## 建议

第一阶段优先做系统朗读：macOS 用系统语音，Windows 用系统语音接口；Web Speech 可作为探测后可用的轻量路径。第二阶段按需加入独立的云端 TTS 配置和音频缓存。这样基本发音不依赖用户的文字生成 API，句子朗读也能在需要时升级音质。

这是一项架构建议，音质与实际延迟尚未试听和测量。已有的文字 API 不能据此认定支持语音。

## 可行方案

| 方案                                          | 单词 / 句子                          | 网络与成本                                                    | 适配工作与限制                                                                                            | 判断                         |
| --------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Web Speech `speechSynthesis`                  | 都支持                               | 通常无直接 API 计费；是否本地取决于 voice.localService 和宿主 | 界面接入简单，可选声线、速率、停止；必须等 voiceschanged 并检测英文语音。浏览器可用不能证明 uTools 内可用 | 可探测使用，不能作为唯一保证 |
| 系统 TTS                                      | 都支持                               | 已安装的系统语音无需逐次 API 费用，可走本地语音               | macOS `say`；Windows System.Speech/SAPI；Linux 需另做后端。不同平台声线与语速刻度不一致                   | 适合首版默认，尤其当前 Mac   |
| 云端 TTS：Azure Speech / OpenAI Speech API 等 | 都支持                               | 联网，按服务商和模型计费                                      | 音色、口音选择与自然度可提升；独立配置、超时、缓存、失败提示。词句会发送给选定服务商                      | 适合可选高质量路径           |
| 本地神经 TTS，例如 Piper                      | 都支持                               | 下载后可本地推理，无逐次服务费                                | 需模型、推理运行时、各平台打包、机器性能测试；引擎 GPL-3.0，声线模型许可单独核对                          | 当前轻量插件暂缓             |
| 正式授权的词典音频                            | 取决于词典覆盖范围；不能处理任意原句 | 取决于授权、接口与缓存约定                                    | 对单词的标准读音有价值，但专业术语、短语和原句覆盖有限；不依赖抓取或未公开音频地址                        | 将来补充，不作为核心         |

Web Speech 的可用声线来自当前设备，初始化时可能为空，应监听声音列表变化。[MDN getVoices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)。Electron 历史上有声线列表为空的报告；该报告针对旧版 Electron/Linux，不能推断 uTools 8 当前必然失败，但足以说明需要宿主验证。[Electron issue #22844](https://github.com/electron/electron/issues/22844)。

Apple 提供系统语音和声线/语速设置；Windows 提供 SpeechSynthesizer。[Apple 系统朗读](https://support.apple.com/guide/mac-help/have-your-mac-speak-text-thats-on-the-screen-mh27448/mac)、[Microsoft SpeechSynthesizer](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer)。本机只执行了 `say -v '?'` 查询，成功列出 Daniel（en_GB）和 Samantha（en_US）等英语声线；未播放音频、未检查每个声线在断网时的行为。

Azure Speech 支持不同语音及 SSML，能调整语速、停顿和发音，但各类声音对标签的支持不同。[Azure TTS 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/text-to-speech)。OpenAI 文档提供 `/v1/audio/speech` 和口音、语速等控制；当前指南仍举 gpt-4o-mini-tts，模型页却已标注 Deprecated。未来接入时需确认当时可用的后继模型，不把旧模型写死为默认。[OpenAI TTS 指南](https://developers.openai.com/api/docs/guides/text-to-speech)、[模型页](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)。具体预算等选定服务后再按其现行定价估算，不把旧的每分钟估计当作统一价格。

Piper 是本地神经语音引擎，其仓库声明 GPL-3.0，打包引擎和声线模型时分别审核许可。[Piper 官方仓库](https://github.com/OHF-Voice/piper1-gpl)。

uTools 8 官方 AI API 当前描述对话、工具和 MCP，未在该页列出直接的 TTS 接口；仍可借助现有 preload 的 Node 网络/系统调用能力实现以上方案。[uTools AI API](https://next.u-tools.cn/docs/api-reference/ai.html)、[preload 桥接层](https://next.u-tools.cn/docs/development/preload.html)。

## 产品交互建议

- 输入阶段就能听目标词与原句，不必等 AI 生成成功；生成结果里在单词及每条例句旁提供朗读入口。
- 默认点击才播放，不自动播放；播放新内容时停止旧内容，再次点击当前按钮可停止。
- 基本设置仅保留英式 / 美式、正常 / 慢速，以及可选声线。若没有对应口音，显示实际声线语言，不静默冒充。
- 单词读写规范后的英文，例句读完整英文；不用中文释义或音标字符代替英文输入。
- 生成任务和语音任务彼此独立，朗读失败不影响生成或保存。关闭/退出页面时取消排队的播放。
- 云端朗读应明确声线由 AI 合成，符合服务商的告知要求；无需把这段说明塞到每个按钮。[OpenAI TTS 指南](https://developers.openai.com/api/docs/guides/text-to-speech)。

## 实现时的关键约束

1. 独立 Speech 服务抽象，暴露声线探测、播放、停止、播放状态。系统、浏览器、云端后端共享交互。
2. macOS/Windows 启动系统语音时采用结构化参数或标准输入，不把用户词句拼到 shell 命令。只管理本插件启动的播放进程。
3. 云端配置与词条生成配置分开；支持文本接口不代表支持 `/audio/speech`，模型列表也不等于可用语音列表。
4. 音频缓存键包含文本、服务、模型、声线、语言和语速。音频放本地缓存目录，不改变每日 TypeWords JSON，也不写入当前词库备份。
5. 精确的专业词、缩写和多读音词可能仍需人工核对。验证 robust、reproducibility、mitochondrial、state-of-the-art、API，以及 read / lead 在不同句子中的读音。
6. 在 uTools 8 的 macOS/Windows 实测首次声线加载、快速切换、慢速、离线、窗口关闭、原生文件选择及断网超时。比较至少两种声线后再决定默认。

## 本轮验证边界

完成了官方资料调研和当前 Mac 的系统声线查询。未进行真人/合成声试听对照，未验证 uTools 内的 Web Speech 声线和播放，未调用任何云端 TTS，也未实装朗读按钮。
