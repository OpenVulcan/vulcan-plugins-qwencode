# 任务目标

在 `vulcan-plugins-qwencode` 仓库中实现面向 QwenCode 宿主的 Vulcan 插件，参考 `vulcan-plugins-opencode` 与 `vulcan-plugins-openclaw` 的成熟能力，尽可能完整地落地记忆检索、写回、配置加载、宿主适配、工具桥接、诊断与文档说明。同时核对 Qwen Code 当前代码，确保实现与宿主接口形态保持一致。

# 详细执行步骤

1. 盘点 `vulcan-plugins-qwencode` 当前仓库状态，确认现有文件、构建基础与缺失内容。
2. 更新并梳理 Qwen Code 源码，了解插件加载、事件生命周期、配置入口、工具扩展与命令面板相关实现。
3. 对照 `vulcan-plugins-opencode` 的业务链路，识别可以直接复用的领域逻辑、配置模型、gRPC 交互层与状态管理组件。
4. 对照 `vulcan-plugins-openclaw` 的宿主适配方式，提炼适用于 QwenCode 的宿主桥接、事件解析、消息提取与命令入口实现。
5. 在 `vulcan-plugins-qwencode` 中建立完整工程骨架，包括源码目录、TypeScript 配置、构建脚本、入口文件与必要依赖。
6. 实现配置层、日志层、gRPC 传输层、记忆检索/写回链路、宿主生命周期编排层以及必要的工具与诊断入口。
7. 根据 QwenCode 的能力边界实现尽可能完整的用户可见入口；若某些 OpenCode 特性在 QwenCode 中不存在，则提供降级策略并明确记录边界。
8. 补充 README 和必要文档，说明安装方式、配置方式、当前能力、验证命令与已知限制。
9. 运行类型检查、构建及可执行验证；对照本计划逐项回验，不满足项继续修正直至闭环。

# 技术选型

- 语言与工程：沿用 TypeScript + NodeNext 模块输出，保持与现有 Vulcan 插件仓库一致，降低跨仓维护成本。
- 架构策略：优先复用 `vulcan-plugins-opencode` 中与宿主无关的领域逻辑；把 QwenCode 特有接口收口到独立宿主适配层，避免业务逻辑与宿主 API 强耦合。
- 配置策略：优先兼容项目级与全局级配置读写；若 QwenCode 原生支持插件 options，则同时预留 options 覆盖入口。
- 交互策略：优先实现宿主已有的命令、事件与工具扩展接口；对缺失的 TUI 或 toast 能力采用日志、文本命令或安全 fail-open 降级。
- 质量策略：新增代码严格遵守仓库双语注释规范，关键类型、函数、配置常量与复杂逻辑块全部补充中英文说明。

# 验收标准

- `vulcan-plugins-qwencode` 不再是占位仓库，而是具备可构建、可检查、可阅读的完整插件工程。
- 插件能够基于 QwenCode 当前接口完成至少一套稳定的记忆检索与写回主链，且具备失败降级与日志观测能力。
- 配置、传输、状态管理、宿主适配、用户入口与文档说明相互一致，不出现文档和实现脱节。
- 关键新增文件、类型、函数与复杂逻辑区域满足双语注释规范。
- README 中明确写清安装、配置、验证方式，以及当前已知边界。
- 完成后补写“执行变更总结”，并将本计划文件迁移到 `docs/completed/20260506/01-QWENCODE_PLUGIN_IMPLEMENTATION.md`。

# 执行变更总结

## 1. 核心修复与调整概述

- 已在 `vulcan-plugins-qwencode` 内完成面向 `Qwen Code` 的 Vulcan 插件工程落地，采用 `Qwen Extension + hooks + gRPC` 作为主链路，而非以 MCP 工具注册作为主执行面。
- 已对齐 `qwen-code` 最新接口形态，完成 `SessionStart`、`UserPromptSubmit`、`Stop`、`StopFailure`、`PostCompact`、`SessionEnd` 的 hooks 编排，实现画像注入、记忆召回、回合闭合写回与压缩同步。
- 已将 Vulcan gRPC 协议定义随插件分发，完成 `health`、运行时构建、用户/项目解析、pre-check、post-action、compact 等关键能力调用。
- 已补齐本地安装脚本、CLI 会话状态导出能力、README 安装与联调文档，以及 `.gitignore` 等工程化基础收尾。

## 2. 📂文件变更清单

- 新增：
  - `.gitignore`
  - `QWEN.md`
  - `commands/vulcan/help.md`
  - `commands/vulcan/troubleshoot.md`
  - `docs/plan/20260506-01-QWENCODE_PLUGIN_IMPLEMENTATION.md`
  - `hooks/hooks.json`
  - `package-lock.json`
  - `package.json`
  - `qwen-extension.json`
  - `scripts/install-qwen-local.mjs`
  - `skills/vulcan-qwencode-ops/SKILL.md`
  - `src/cli.ts`
  - `src/config.ts`
  - `src/context.ts`
  - `src/grpc-client.ts`
  - `src/hooks.ts`
  - `src/host-bootstrap.ts`
  - `src/json.ts`
  - `src/logger.ts`
  - `src/state.ts`
  - `src/transcript.ts`
  - `src/types.ts`
  - `tsconfig.json`
- 修改：
  - `README.md`
- 删除：
  - `temp-stop.json`
  - `temp-userprompt.json`

## 3. 💻关键代码调整详情

- 在 `src/hooks.ts` 中建立基于 Qwen hooks 的运行时编排层，`UserPromptSubmit` 负责 session-bound recall 与画像注入，`Stop` 负责回合闭合判定、画像刷新与可选 `PostAction` 回写，`PostCompact` 负责 compact 后同步 VMM。
- 在 `src/grpc-client.ts`、`src/context.ts`、`src/config.ts` 中完成 Qwen 宿主上下文到 Vulcan Host gRPC 请求的映射，确保 `hostKind=qwen-code`、`session_id`、工作区路径与用户/项目绑定都能稳定透传。
- 在 `src/state.ts` 中实现文件型会话状态持久化，并新增会话状态文件路径导出能力，支撑调试时定位 `pendingTurn`、画像缓存与 recall 保温状态。
- 在 `src/cli.ts` 中补充 `dump-session-state` 诊断命令，并保留 `status`、`doctor`、`print-config-template` 等联调入口。
- 在 `scripts/install-qwen-local.mjs` 与 `package.json` 中补充本地安装脚本，形成“构建后直接注册到 Qwen”的交付路径。
- 在 `README.md` 中补充安装方式、npm 包装脚本、诊断命令与当前边界说明，保证实现与使用文档一致。

## 4. ⚠️遗留问题与注意事项

- 当前 Qwen 原生扩展接口没有 OpenCode / OpenClaw 那种宿主原生工具注册面，因此本插件的自动化能力主要依赖 hooks，显式能力主要通过 `commands`、`skills`、`QWEN.md` 暴露。
- 当前默认 gRPC endpoint 与 proto 自动探测路径偏向本地开发环境；若部署到其他机器，需要通过扩展设置、环境变量或 `.qwen/vulcan-qwencode.json` 显式覆盖。
- 本次验证未执行 `npm run install:qwen-local`，以避免直接改动当前用户环境中的 Qwen 扩展安装状态；已通过构建、类型检查、`status`、`doctor`、hook stdin 与 `dump-session-state` 完成主链路验证。
