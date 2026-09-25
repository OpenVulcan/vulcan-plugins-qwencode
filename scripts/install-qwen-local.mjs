// Local installer for the Vulcan Qwencode extension inside the Qwen CLI workflow.
// 本文件负责在 Qwen CLI 工作流内执行 Vulcan Qwencode 扩展的本地安装。

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// repoRoot points at the extension repository root so build and install commands run against the correct manifest.
// repoRoot 指向扩展仓库根目录，确保构建与安装命令都作用于正确的清单目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// resolveQwenCommand picks the portable Qwen executable name for the current platform.
// resolveQwenCommand 选择当前平台可移植的 Qwen 可执行文件名。
function resolveQwenCommand() {
  return process.platform === "win32" ? "qwen.cmd" : "qwen";
}

// runStep executes one child-process step and exits immediately when the step fails.
// runStep 执行一个子进程步骤，并在步骤失败时立即退出。
function runStep(command, args, title) {
  console.log(`[vulcan-qwencode] ${title}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`[vulcan-qwencode] ${title} failed: ${String(result.error)}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

// assertBuildOutput checks that the extension runtime bundle exists before asking Qwen to install the extension.
// assertBuildOutput 检查扩展运行时产物是否存在，避免在构建缺失时请求 Qwen 安装扩展。
function assertBuildOutput() {
  const cliOutputPath = path.join(repoRoot, "dist", "cli.js");
  if (!existsSync(cliOutputPath)) {
    console.error(`[vulcan-qwencode] Missing build output: ${cliOutputPath}`);
    process.exit(1);
  }
}

// The top-level installer builds the extension and then delegates installation to the Qwen CLI extension manager.
// 顶层安装器会先构建扩展，再把安装动作委托给 Qwen CLI 的扩展管理器。
runStep("npm", ["run", "build"], "Building extension");
assertBuildOutput();
runStep(resolveQwenCommand(), ["extensions", "install", repoRoot], "Installing extension into Qwen");
