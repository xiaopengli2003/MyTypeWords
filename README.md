# 词捕 · v1.0.0

在 uTools 中记录英文生词，调用 OpenAI 兼容服务生成释义和例句，按天导出 TypeWords 自定义词典。

源码在 `utools-plugin-word-catcher/`。安装、配置和使用方法见 [插件说明](utools-plugin-word-catcher/README.md)，首次使用与目录结构见 [数据存储说明](utools-plugin-word-catcher/docs/data-storage.md)。

```sh
cd utools-plugin-word-catcher
npm ci
npm run verify
npm run build
```

构建后，在 uTools 开发者工具中选择 `utools-plugin-word-catcher/dist/word-catcher-v1.0.0/plugin.json`，由 uTools 打包插件。发布目录只包含运行文件，不含测试、开发依赖、演示数据或用户配置。

本地 `typewords-data/` 属于用户数据，已从 Git 排除。API Key、词库、每日导出和个人提示词不随源码提交。源码仓库保留隔离预览、测试和高清 Logo 原稿，方便后续维护。
