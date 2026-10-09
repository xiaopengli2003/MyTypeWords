# Win / Mac 兼容性

验证日期：2026-10-09。目标宿主为 uTools 8.0.0-beta，对应 Node.js 20.19.1。项目运行代码采用 CommonJS、Node 原生模块和标准 Web 技术，不依赖开发电脑的固定路径或原生编译扩展。

## 已验证行为

| 范围       | 验证                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| 数据路径   | 优先取系统文档目录；模拟 Windows 重定向文档、中文路径、UNC 与 macOS 路径           |
| 配置迁移   | 导入保留本机目录；外国系统路径回落默认值；拒绝相对路径和 NUL                       |
| 文件对话框 | 仅 macOS 使用 createDirectory，Windows 使用 openDirectory                          |
| 持久化     | 同目录临时文件与 rename；词库、设置及恢复失败尝试回退；配置导出保留失败前原文件    |
| AI 请求    | 模型列表去重、地址修正、UTF-8 分片、响应中断、本地 IPv4/IPv6 HTTP 以及配置切换竞态 |
| 初次使用   | 空配置可进入设置；保存自动建立目录结构；未保存时也可创建并打开默认目录             |
| 窗口与输入 | 指令不预填；划词保留；取消后丢弃旧生成结果；主窗口/分离窗口/原生对话框分支         |
| 快捷键     | Mac 显示 ⌘ ↵，Windows 显示 Ctrl ↵                                                  |

六组回归通过 `npm test` 运行，使用隔离临时目录、模拟宿主和本机 HTTP 服务。平台测试使用 `path.win32`、`path.posix` 与内存文件系统，**不能替代 Windows 的 uTools 实机测试**。

浏览器隔离预览使用正式 app.js、style.css 和 Logo。已检查 800×620 与 480×480 的设置、数据、备份和词库布局，验证模型菜单向上展开、搜索选择、保存和撤销。原生 uTools 的已安装分离窗口测得内容区约 800×620，未替换用户安装包；新版仍需重新打包后原生验收。

`pluginSetting` 使用文档支持的 height，不设置 width。高度 API 优先使用 setExpandHeight，旧宿主回落 setExpendHeight。主窗口隐藏后的退出依赖宿主 Page Visibility 事件，原生对话框期间和关闭后的短暂事件受到保护。

## 实机验收项目

- 在 Win/Mac 的 uTools 中安装发布包，使用带中文和空格的目录，保存、重进并核对模型。
- 验证文件选择、取消、覆盖确认，以及文档目录权限和文件占用时的提示。
- 验证主窗口收起后再次呼出回到搜索框、× 主动退出、分离窗口保护。
- 检查 Windows 125%/150% 缩放和 Mac Retina 的字体、滚动、弹窗。

当前未完成 Windows uTools 实机验收，也未验证所有原生 DPI 与窗口隐藏行为。朗读尚未实装，不涉及系统语音命令的跨平台依赖。

迁移说明见 [数据存储](data-storage.md)。本机 API 地址 localhost、127.0.0.1 或 ::1 指向当前电脑，迁移后需要该电脑运行相应服务。

官方依据：[uTools 更新公告](https://next.u-tools.cn/changelog/)、[preload](https://next.u-tools.cn/docs/development/preload.html)、[系统 API](https://next.u-tools.cn/docs/api-reference/system.html)、[窗口 API](https://next.u-tools.cn/docs/api-reference/window.html)、[插件配置](https://next.u-tools.cn/docs/development/plugin-json.html)。
