// CLI entrypoint for the Vulcan Qwencode extension runtime.
// 本文件是 Vulcan Qwencode 扩展运行时的 CLI 入口。

import process from "node:process";
import { buildConfigTemplate, fileExists, resolvePluginConfig } from "./config.js";
import { buildHookHostContext, createRequestId } from "./context.js";
import { createVulcanHostClient } from "./grpc-client.js";
import { runHook } from "./hooks.js";
import { ensureHostReady } from "./host-bootstrap.js";
import { createRuntimeLogger } from "./logger.js";
import { readOptionalString } from "./json.js";
import {
  loadSessionState,
  resolveSessionStateDir,
  resolveSessionStateFilePath,
} from "./state.js";
import type { DiagnosticReport, HookCommandInput } from "./types.js";

// main dispatches CLI subcommands for hook execution and local diagnostics.
// main 负责分发 hook 执行与本地诊断所需的 CLI 子命令。
async function main(argv: string[]): Promise<number> {
  const logger = createRuntimeLogger();
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    writeText(buildHelpText());
    return 0;
  }
  if (command === "hook") {
    const eventName = rest[0];
    if (!eventName) {
      writeText("Missing hook event name.\n");
      return 1;
    }
    const input = (await readStdinJson()) as HookCommandInput;
    const output = await runHook(eventName, input);
    if (output) {
      writeText(`${JSON.stringify(output)}\n`);
    }
    return 0;
  }
  if (command === "status") {
    const report = await buildStatusReport(rest);
    writeText(`${report.lines.join("\n")}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === "doctor") {
    const report = await buildDoctorReport(rest);
    writeText(`${report.lines.join("\n")}\n`);
    return report.ok ? 0 : 1;
  }
  if (command === "dump-session-state") {
    const sessionId = readFlagValue(rest, "--session-id");
    if (!sessionId) {
      writeText("Missing --session-id.\n");
      return 1;
    }
    const report = await buildSessionStateReport(sessionId);
    writeText(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  if (command === "print-config-template") {
    writeText(buildConfigTemplate());
    return 0;
  }
  logger.error(`Unknown command: ${command}`);
  writeText(buildHelpText());
  return 1;
}

// buildSessionStateReport renders one session-state snapshot for hook flow debugging.
// buildSessionStateReport 渲染一份会话状态快照，用于 hook 链路调试。
async function buildSessionStateReport(sessionId: string): Promise<Record<string, unknown>> {
  return {
    sessionId,
    stateDir: resolveSessionStateDir(),
    stateFilePath: resolveSessionStateFilePath(sessionId),
    state: await loadSessionState(sessionId),
  };
}

// buildStatusReport renders one resolved-config status snapshot without forcing host startup.
// buildStatusReport 渲染一份已解析配置的状态快照，但不会强制启动宿主。
async function buildStatusReport(args: string[]): Promise<DiagnosticReport> {
  const cwd = readFlagValue(args, "--cwd");
  const config = await resolvePluginConfig(cwd);
  const [globalExists, workspaceExists] = await Promise.all([
    fileExists(config.configFiles.globalPath),
    fileExists(config.configFiles.workspacePath),
  ]);
  return {
    ok: true,
    lines: [
      "# vulcan-qwencode status",
      `enabled: ${config.enabled}`,
      `memory.enabled: ${config.memory.enabled}`,
      `memory.autoRecall: ${config.memory.autoRecall}`,
      `memory.autoPostAction: ${config.memory.autoPostAction}`,
      `endpoint: ${config.endpoint}`,
      `protoPath: ${config.protoPath ?? "(auto-detect)"}`,
      `defaultUserRef: ${config.bindings.defaultUserId}`,
      `defaultProjectRef: ${config.bindings.defaultProjectId}`,
      `host.autoStart: ${config.host.autoStart}`,
      `host.command: ${config.host.command ?? "(not set)"}`,
      `globalConfig: ${config.configFiles.globalPath} (${globalExists ? "exists" : "missing"})`,
      `workspaceConfig: ${config.configFiles.workspacePath ?? "(not available)"} (${workspaceExists ? "exists" : "missing"})`,
    ],
  };
}

// buildDoctorReport performs runtime reachability, gRPC health, and VMM binding checks for the current configuration.
// buildDoctorReport 对当前配置执行运行时可达性、gRPC 健康与 VMM 绑定检查。
async function buildDoctorReport(args: string[]): Promise<DiagnosticReport> {
  const logger = createRuntimeLogger();
  const cwd = readFlagValue(args, "--cwd") ?? process.cwd();
  const sessionId = readFlagValue(args, "--session-id");
  const config = await resolvePluginConfig(cwd);
  const lines: string[] = ["# vulcan-qwencode doctor"];
  try {
    await ensureHostReady(config, logger);
    lines.push(`hostReachable: yes (${config.endpoint})`);
  } catch (error) {
    lines.push(`hostReachable: no (${String(error)})`);
    return { ok: false, lines };
  }
  try {
    const client = createVulcanHostClient(config);
    const health = await client.health();
    lines.push(`grpcHealth: ${health.ok ? "ok" : "not-ok"} (${health.message})`);
    const hostContext = buildHookHostContext(
      {
        cwd,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      },
      config,
    );
    const runtime = await client.buildHostAdapterRuntime(hostContext);
    lines.push(`hostKind: ${runtime.hostKind}`);
    lines.push(`runtimeSessionId: ${runtime.sessionId ?? "(missing)"}`);
    lines.push(`runtimeWorkmemId: ${runtime.workmemId ?? "(missing)"}`);
    lines.push(`vmmEnabled: ${runtime.vmmEnabled}`);
    lines.push(`vmmStatus: ${runtime.vmmStatus}`);
    const user = await client.resolveVmmUser({
      context: hostContext,
      userRef: config.bindings.defaultUserId,
      confirmCreate: false,
    });
    const project = await client.resolveVmmProject({
      context: hostContext,
      projectRef: config.bindings.defaultProjectId,
    });
    lines.push(`resolvedUser: ${user.userId || "(missing)"} ${user.message ? `- ${user.message}` : ""}`.trim());
    lines.push(`resolvedProject: ${project.projectId || "(missing)"} ${project.displayPath ? `- ${project.displayPath}` : ""}`.trim());
    return {
      ok: health.ok && Boolean(user.userId) && Boolean(project.projectId),
      lines,
    };
  } catch (error) {
    lines.push(`grpcCheck: failed (${String(error)})`);
    return { ok: false, lines };
  }
}

// readFlagValue reads the value immediately following one named CLI flag.
// readFlagValue 读取某个具名 CLI 标志后紧随的值。
function readFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return readOptionalString(args[index + 1]);
}

// readStdinJson reads one hook JSON payload from stdin and returns an empty object when stdin is empty.
// readStdinJson 从 stdin 读取一份 hook JSON 载荷，并在 stdin 为空时返回空对象。
async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

// buildHelpText renders the short CLI usage summary.
// buildHelpText 渲染简短的 CLI 用法摘要。
function buildHelpText(): string {
  return [
    "vulcan-qwencode CLI",
    "",
    "Commands:",
    "  hook <EventName>",
    "  status [--cwd <workspace>]",
    "  doctor [--cwd <workspace>] [--session-id <session-id>]",
    "  dump-session-state --session-id <session-id>",
    "  print-config-template",
    "",
  ].join("\n");
}

// writeText writes one text block to stdout without additional formatting.
// writeText 将一段文本原样写入 stdout，而不追加其他格式。
function writeText(text: string): void {
  process.stdout.write(text);
}

// The top-level CLI bootstraps the subcommand dispatcher and exits with the returned status code.
// 顶层 CLI 负责启动子命令分发器，并按返回状态码退出进程。
void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`[vulcan-qwencode][fatal] ${String(error)}\n`);
    process.exitCode = 1;
  });
