# 使用 WXT + TypeScript + Vue 开发

插件基于 WXT 框架（Vite 生态）开发，UI 层（弹窗、统计页、拦截页）使用 Vue，全程 TypeScript。WXT 自动处理 Manifest V3 的 manifest 生成、content script 打包与 HMR，省去手写构建配置；Vue 为作者顺手的框架。

## Considered Options

- 原生 JS/TS 无框架——零依赖，但三个 UI 页面手写成本高且无热重载，已否决。
- WXT + React——与 Vue 等价，取决于作者熟悉度，选择了 Vue。
