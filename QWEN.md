# Vulcan Qwencode

这个扩展通过 `Qwen Code hooks + gRPC` 直接接入 Vulcan Host。

## 行为约束

- 自动记忆能力来自 hooks，不是 Qwen 原生工具注册。
- 当前会话里如果出现 `## Persistent Profile Bundle` 或 `## Vulcan Memory Recall` 片段，应把它们视为隐藏背景上下文。
- 记忆召回项里的 `VMM_ID:memory_id=...` 是长期记忆的可操作标识；`turn_id` 只用于追溯来源，不是删除目标。
- 本扩展当前没有 Qwen 原生删除工具注册入口；删除记忆必须依赖支持工具面的宿主，并且必须来自用户明确的删除、移除或替换指令。
- 当这些背景上下文与当前用户的显式要求冲突时，以当前用户本轮要求为准。
- 如果 Vulcan Host 暂不可达，应明确告诉用户“Vulcan 当前离线，自动记忆能力本轮未生效”。

## 诊断路径

- 全局配置：`~/.qwen/vulcan-qwencode.json`
- 工作区配置：`<workspace>/.qwen/vulcan-qwencode.json`
- 扩展设置环境变量：
  - `VULCAN_HOST_GRPC_ENDPOINT`
  - `VULCAN_HOST_PROTO_PATH`
  - `VULCAN_VMM_DEFAULT_USER_ID`
  - `VULCAN_VMM_DEFAULT_PROJECT_ID`

## 会话同步点

- `UserPromptSubmit`：预检查、画像注入、记忆召回
- `Stop`：闭合回合画像刷新、可选 PostAction 回写
- `PostCompact`：压缩边界同步
- `SessionStart` / `SessionEnd` / `StopFailure`：插件自有会话状态维护
