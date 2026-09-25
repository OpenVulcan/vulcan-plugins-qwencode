---
description: 解释 vulcan-qwencode 插件的工作方式、配置路径与排查入口
when_to_use: 当你想了解当前 Qwen 工作区里的 Vulcan 插件如何工作、为什么没有原生工具注册、或者应该从哪里开始排查时使用
---

请基于当前工作区内已安装的 `vulcan-qwencode` 插件回答用户问题，并优先覆盖以下信息：

- 这个插件采用 `Qwen Extension + hooks + gRPC`，不是把 MCP 当主执行面
- 自动行为来自 `UserPromptSubmit`、`Stop`、`PostCompact`
- 隐藏上下文分为 `Persistent Profile Bundle` 与 `Vulcan Memory Recall`
- 配置文件路径：
  - 全局：`~/.qwen/vulcan-qwencode.json`
  - 工作区：`<workspace>/.qwen/vulcan-qwencode.json`
- 关键环境变量：
  - `VULCAN_HOST_GRPC_ENDPOINT`
  - `VULCAN_HOST_PROTO_PATH`
  - `VULCAN_VMM_DEFAULT_USER_ID`
  - `VULCAN_VMM_DEFAULT_PROJECT_ID`
- 如果 Vulcan 不可达，应如何向用户说明降级行为
