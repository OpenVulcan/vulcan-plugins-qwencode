---
name: vulcan-qwencode-ops
description: 解释和排查 vulcan-qwencode 插件的 hooks、gRPC 会话接入、配置文件与自动记忆行为
---

# Vulcan Qwencode Ops

## 适用场景

- 用户想了解 `vulcan-qwencode` 为什么采用 hooks 而不是原生工具注册
- 用户反馈记忆召回、画像注入、压缩同步、回合回写没有生效
- 用户需要确认全局与工作区配置从哪里读取

## 回答重点

- 这个插件的主链路是 `Qwen Extension + hooks + gRPC`
- 自动能力挂在 `UserPromptSubmit`、`Stop`、`PostCompact`
- 关键配置路径：
  - `~/.qwen/vulcan-qwencode.json`
  - `<workspace>/.qwen/vulcan-qwencode.json`
- 关键环境变量：
  - `VULCAN_HOST_GRPC_ENDPOINT`
  - `VULCAN_HOST_PROTO_PATH`
  - `VULCAN_VMM_DEFAULT_USER_ID`
  - `VULCAN_VMM_DEFAULT_PROJECT_ID`

## 诊断原则

- 先确认 Qwen 扩展是否启用
- 再确认 hooks 是否触发
- 再确认 gRPC 端点是否可达
- 最后再看 VMM 绑定与 session_id 是否正常解析
