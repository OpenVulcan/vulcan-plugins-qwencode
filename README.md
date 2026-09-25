# vulcan-plugins-qwencode

`vulcan-plugins-qwencode` 是面向 `Qwen Code` 的 Vulcan 插件扩展仓库。  
它优先采用 `Qwen Extension + hooks + gRPC` 的接入方式，把会话态记忆、画像注入、压缩同步与回合回写直接挂到 Qwen 的插件注册链路上，而不是把 MCP 当作主执行面。

## 设计目标

- 通过 `UserPromptSubmit` 自动执行会话预检查与记忆召回
- 通过 `Stop` 在回合闭合后执行画像刷新与可选 `PostAction` 回写
- 通过 `PostCompact` 同步 Qwen 的压缩边界到 VMM
- 通过 `SessionStart` / `SessionEnd` / `StopFailure` 维护插件自有的会话状态
- 直接走 `vulcan-host` / `vulcan-agent-service` 的 gRPC 契约，以便携带稳定 `session_id`

## 目录说明

- `qwen-extension.json`：Qwen 扩展入口清单
- `hooks/hooks.json`：扩展注册的 hooks 定义
- `QWEN.md`：扩展加载到会话中的静态上下文
- `commands/`：插件注册的帮助命令
- `skills/`：插件注册的技能说明
- `src/`：TypeScript 运行时代码
- `proto/v1/`：随插件分发的 gRPC 协议定义

## 配置方式

插件按以下优先级合并配置：

1. 环境变量 / 扩展设置
2. 工作区配置：`<workspace>/.qwen/vulcan-qwencode.json`
3. 全局配置：`~/.qwen/vulcan-qwencode.json`
4. 内置默认值

默认支持的关键环境变量：

- `VULCAN_HOST_GRPC_ENDPOINT`
- `VULCAN_HOST_PROTO_PATH`
- `VULCAN_QWENCODE_HOST_AUTOSTART`
- `VULCAN_HOST_COMMAND`
- `VULCAN_HOST_COMMAND_ARGS`
- `VULCAN_HOST_CWD`
- `VULCAN_VMM_DEFAULT_USER_ID`
- `VULCAN_VMM_DEFAULT_PROJECT_ID`
- `VULCAN_QWENCODE_ENABLED`
- `VULCAN_QWENCODE_MEMORY_ENABLED`
- `VULCAN_QWENCODE_AUTO_RECALL`
- `VULCAN_QWENCODE_AUTO_POSTACTION`

扩展已内置所需的 gRPC 协议文件，通常不需要设置 `VULCAN_HOST_PROTO_PATH`。使用记忆与 Vulcan 宿主能力仍需连接可用的 `vulcan-host` gRPC 服务；默认地址为 `127.0.0.1:19202`。
默认不会尝试启动宿主程序。若要由扩展启动，请显式设置 `VULCAN_QWENCODE_HOST_AUTOSTART=true` 和当前机器上的 `VULCAN_HOST_COMMAND`；可按需提供启动参数与工作目录。

## 本地开发

```powershell
npm install
npm run build
npm run check
```

## 安装方式

Qwen Code 原生支持从本地路径、Git 仓库或 npm 包安装扩展，因此这个仓库可以直接走插件注册链路，而不需要把 MCP 作为主入口。

### 方式一：从本地仓库安装

```powershell
npm run install:qwen-local
```

该脚本会先构建 `dist/`，再调用：

```powershell
qwen extensions install .
```

### 方式二：手动安装本地路径

```powershell
qwen extensions install .
```

请在插件仓库根目录运行此命令。

### 方式三：从 Git 源码安装

```powershell
git clone https://github.com/OpenVulcan/vulcan-plugins-qwencode.git
Set-Location vulcan-plugins-qwencode
npm install
npm run install:qwen-local
```

这组步骤会先安装 gRPC 运行依赖并编译 TypeScript，再执行 Qwen 扩展安装，确保源码树中已有运行所需的依赖与 `dist/` 产物。

## 本地安装到 Qwen Code

```powershell
qwen extensions install .
```

安装后，Qwen 会把扩展复制到：

`%USERPROFILE%\.qwen\extensions\vulcan-qwencode`

## 调试命令

构建完成后，可直接在仓库里执行：

```powershell
node ./dist/cli.js status --cwd .
node ./dist/cli.js doctor --cwd . --session-id demo-session
node .\dist\cli.js dump-session-state --session-id demo-session
node .\dist\cli.js print-config-template
```

也可以通过 `npm run` 包装脚本执行：

```powershell
npm run status -- --cwd .
npm run doctor -- --cwd . --session-id demo-session
npm run dump-session-state -- --session-id demo-session
```

## 当前实现边界

- 主路径是 `hooks + gRPC`，不是 `MCP tools` 注册
- Qwen 原生扩展当前没有 OpenCode / OpenClaw 那种“宿主原生工具注册”入口
- 因此自动能力依赖 hooks，显式帮助能力放在 `commands`、`skills`、`QWEN.md`
