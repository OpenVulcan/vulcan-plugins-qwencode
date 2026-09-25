---
description: 按 vulcan-qwencode 的接入方式排查 hooks、gRPC、配置和会话状态问题
when_to_use: 当用户反馈 Vulcan 记忆没有注入、画像没有刷新、压缩同步失败、或者想做完整故障诊断时使用
---

请把排查过程聚焦在 `vulcan-qwencode` 这条链路：

1. 确认插件是否通过 `qwen-extension.json` 正常安装并启用。
2. 确认 `hooks/hooks.json` 是否已经注册 `SessionStart`、`UserPromptSubmit`、`Stop`、`PostCompact`、`SessionEnd`、`StopFailure`。
3. 确认 `VULCAN_HOST_GRPC_ENDPOINT` 与 proto 路径是否正确。
4. 检查全局与工作区配置文件是否存在冲突。
5. 说明这个插件为什么不能像 OpenCode / OpenClaw 那样做宿主原生工具注册。
6. 如果用户在当前机器上调试，提醒可以直接运行：
   - `node .\dist\cli.js status --cwd <workspace>`
   - `node .\dist\cli.js doctor --cwd <workspace> --session-id <session-id>`
