// Configuration loading and resolution for the Vulcan Qwencode extension.
// 本文件负责 Vulcan Qwencode 扩展的配置加载与归一化解析。

import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  asRecord,
  readBoolean,
  readNonNegativeInteger,
  readOptionalString,
  readPositiveNumber,
  readString,
  readStringArray,
  readStringRecord,
  safeJsonParse,
} from "./json.js";
import type { ResolvedVulcanQwencodeConfig, VulcanQwencodePluginConfig } from "./types.js";

// DEFAULT_ENDPOINT is the default vulcan-host gRPC endpoint used by the adapter runtime.
// DEFAULT_ENDPOINT 是适配器运行时默认使用的 vulcan-host gRPC 端点。
const DEFAULT_ENDPOINT = "127.0.0.1:19202";

// DEFAULT_CLIENT_NAME keeps vulcan-host client-budget matching stable for Qwen Code.
// DEFAULT_CLIENT_NAME 用于让 Qwen Code 的 vulcan-host 客户端预算匹配保持稳定。
const DEFAULT_CLIENT_NAME = "qwen-code";

// DEFAULT_CLIENT_VERSION identifies this adapter while the package is still pre-release.
// DEFAULT_CLIENT_VERSION 用于在当前预发布阶段标识这个适配器。
const DEFAULT_CLIENT_VERSION = "0.1.0";

// DEFAULT_HOST_READY_TIMEOUT_MS bounds how long host autostart waits for the gRPC endpoint.
// DEFAULT_HOST_READY_TIMEOUT_MS 用于限制宿主自启动等待 gRPC 端点就绪的最长时间。
const DEFAULT_HOST_READY_TIMEOUT_MS = 15_000;

// DEFAULT_BINDING_USER_ID keeps the extension operational before an explicit user binding is configured.
// DEFAULT_BINDING_USER_ID 在尚未配置显式用户绑定前保持扩展仍可运行。
const DEFAULT_BINDING_USER_ID = "1";

// DEFAULT_BINDING_PROJECT_ID keeps the extension operational before an explicit project binding is configured.
// DEFAULT_BINDING_PROJECT_ID 在尚未配置显式项目绑定前保持扩展仍可运行。
const DEFAULT_BINDING_PROJECT_ID = "1";

// DEFAULT_IMPLICIT_MEMORY_TURNS keeps short-lived recall warm for a bounded number of later turns.
// DEFAULT_IMPLICIT_MEMORY_TURNS 用于让短期 recall 在有限后续轮次内保持可复用。
const DEFAULT_IMPLICIT_MEMORY_TURNS = 5;

// DEFAULT_PROFILE_REFRESH_TURNS refreshes the hidden profile bundle after a bounded number of closed turns.
// DEFAULT_PROFILE_REFRESH_TURNS 用于在有限的闭合回合数之后刷新隐藏画像 bundle。
const DEFAULT_PROFILE_REFRESH_TURNS = 5;

// GLOBAL_CONFIG_FILENAME is the user-level JSON config consumed by the extension.
// GLOBAL_CONFIG_FILENAME 是扩展读取的用户级 JSON 配置文件名。
const GLOBAL_CONFIG_FILENAME = "vulcan-qwencode.json";

// QWEN_CONFIG_DIR is the shared Qwen home/config directory name.
// QWEN_CONFIG_DIR 是共享的 Qwen 主配置目录名。
const QWEN_CONFIG_DIR = ".qwen";

// normalizePluginConfig narrows unknown JSON into the loose user-facing plugin config shape.
// normalizePluginConfig 将未知 JSON 收窄为宽松的面向用户插件配置结构。
function normalizePluginConfig(value: unknown): VulcanQwencodePluginConfig {
  const root = asRecord(value);
  const host = asRecord(root.host);
  const bindings = asRecord(root.bindings);
  const memory = asRecord(root.memory);
  return {
    endpoint: typeof root.endpoint === "string" ? root.endpoint : undefined,
    protoPath: typeof root.protoPath === "string" ? root.protoPath : undefined,
    clientName: typeof root.clientName === "string" ? root.clientName : undefined,
    clientVersion: typeof root.clientVersion === "string" ? root.clientVersion : undefined,
    enabled: typeof root.enabled === "boolean" ? root.enabled : undefined,
    host: {
      autoStart: typeof host.autoStart === "boolean" ? host.autoStart : undefined,
      command: typeof host.command === "string" ? host.command : undefined,
      args: Array.isArray(host.args) ? host.args.filter((entry) => typeof entry === "string") : undefined,
      cwd: typeof host.cwd === "string" ? host.cwd : undefined,
      readyTimeoutMs: typeof host.readyTimeoutMs === "number" ? host.readyTimeoutMs : undefined,
      env:
        host.env && typeof host.env === "object" && !Array.isArray(host.env)
          ? (host.env as Record<string, string | number | boolean>)
          : undefined,
    },
    bindings: {
      defaultUserId:
        typeof bindings.defaultUserId === "string" || typeof bindings.defaultUserId === "number"
          ? (bindings.defaultUserId as string | number)
          : undefined,
      defaultProjectId:
        typeof bindings.defaultProjectId === "string" || typeof bindings.defaultProjectId === "number"
          ? (bindings.defaultProjectId as string | number)
          : undefined,
    },
    memory: {
      enabled: typeof memory.enabled === "boolean" ? memory.enabled : undefined,
      autoRecall: typeof memory.autoRecall === "boolean" ? memory.autoRecall : undefined,
      autoPostAction: typeof memory.autoPostAction === "boolean" ? memory.autoPostAction : undefined,
      recallTopK: typeof memory.recallTopK === "number" ? memory.recallTopK : undefined,
      implicitMemoryTurns:
        typeof memory.implicitMemoryTurns === "number" ? memory.implicitMemoryTurns : undefined,
      profileRefreshTurns:
        typeof memory.profileRefreshTurns === "number" ? memory.profileRefreshTurns : undefined,
      timeoutMs: typeof memory.timeoutMs === "number" ? memory.timeoutMs : undefined,
    },
  };
}

// readJsonConfigFile loads one JSON config file when it exists and returns an empty config when absent or invalid.
// readJsonConfigFile 在文件存在时加载 JSON 配置，并在缺失或非法时返回空配置。
async function readJsonConfigFile(filePath: string): Promise<VulcanQwencodePluginConfig> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizePluginConfig(safeJsonParse(raw));
  } catch {
    return {};
  }
}

// mergeConfig overlays one loose plugin config on top of another without attempting a generic deep merge.
// mergeConfig 将一个宽松插件配置叠加到另一个配置之上，而不做通用深合并。
function mergeConfig(
  base: VulcanQwencodePluginConfig,
  overlay: VulcanQwencodePluginConfig,
): VulcanQwencodePluginConfig {
  return {
    ...base,
    ...overlay,
    host: {
      ...(base.host ?? {}),
      ...(overlay.host ?? {}),
      env: {
        ...((base.host?.env as Record<string, string | number | boolean> | undefined) ?? {}),
        ...((overlay.host?.env as Record<string, string | number | boolean> | undefined) ?? {}),
      },
      args: overlay.host?.args ?? base.host?.args,
    },
    bindings: {
      ...(base.bindings ?? {}),
      ...(overlay.bindings ?? {}),
    },
    memory: {
      ...(base.memory ?? {}),
      ...(overlay.memory ?? {}),
    },
  };
}

// readBindingRef normalizes a configured user/project reference into one trimmed string.
// readBindingRef 将配置中的用户或项目引用归一化为裁剪后的字符串。
function readBindingRef(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

// getGlobalConfigPath returns the user-level JSON config file path.
// getGlobalConfigPath 返回用户级 JSON 配置文件路径。
export function getGlobalConfigPath(): string {
  return path.join(os.homedir(), QWEN_CONFIG_DIR, GLOBAL_CONFIG_FILENAME);
}

// getWorkspaceConfigPath returns the workspace JSON config file path when a cwd is available.
// getWorkspaceConfigPath 在存在 cwd 时返回工作区 JSON 配置文件路径。
export function getWorkspaceConfigPath(cwd?: string | undefined): string | undefined {
  return cwd ? path.join(cwd, QWEN_CONFIG_DIR, GLOBAL_CONFIG_FILENAME) : undefined;
}

// resolvePluginConfig merges global config, workspace config, and environment overrides into one normalized runtime config.
// resolvePluginConfig 将全局配置、工作区配置与环境变量覆盖合并为一份归一化运行时配置。
export async function resolvePluginConfig(cwd?: string | undefined): Promise<ResolvedVulcanQwencodeConfig> {
  const globalPath = getGlobalConfigPath();
  const workspacePath = getWorkspaceConfigPath(cwd);
  const [globalConfig, workspaceConfig] = await Promise.all([
    readJsonConfigFile(globalPath),
    workspacePath ? readJsonConfigFile(workspacePath) : Promise.resolve({}),
  ]);
  const merged = mergeConfig(globalConfig, workspaceConfig);
  const hostEnv = readStringRecord(merged.host?.env);
  const resolved: ResolvedVulcanQwencodeConfig = {
    endpoint: readString(
      process.env.VULCAN_HOST_GRPC_ENDPOINT ?? merged.endpoint,
      DEFAULT_ENDPOINT,
    ),
    protoPath: readOptionalString(process.env.VULCAN_HOST_PROTO_PATH ?? merged.protoPath),
    clientName: readString(merged.clientName, DEFAULT_CLIENT_NAME),
    clientVersion: readString(merged.clientVersion, DEFAULT_CLIENT_VERSION),
    enabled: readBoolean(
      parseBooleanEnv(process.env.VULCAN_QWENCODE_ENABLED),
      readBoolean(merged.enabled, true),
    ),
    configFiles: {
      globalPath,
      workspacePath,
    },
    host: {
      autoStart: readBoolean(readEnvBoolean("VULCAN_QWENCODE_HOST_AUTOSTART"), readBoolean(merged.host?.autoStart, false)),
      command: readOptionalString(process.env.VULCAN_HOST_COMMAND ?? merged.host?.command),
      args: readStringArray(
        parseJsonStringArray(process.env.VULCAN_HOST_COMMAND_ARGS) ?? merged.host?.args,
      ),
      cwd: readOptionalString(process.env.VULCAN_HOST_CWD ?? merged.host?.cwd),
      readyTimeoutMs: readPositiveNumber(merged.host?.readyTimeoutMs, DEFAULT_HOST_READY_TIMEOUT_MS),
      env: hostEnv,
    },
    bindings: {
      defaultUserId: readBindingRef(
        process.env.VULCAN_VMM_DEFAULT_USER_ID ?? merged.bindings?.defaultUserId,
        DEFAULT_BINDING_USER_ID,
      ),
      defaultProjectId: readBindingRef(
        process.env.VULCAN_VMM_DEFAULT_PROJECT_ID ?? merged.bindings?.defaultProjectId,
        DEFAULT_BINDING_PROJECT_ID,
      ),
    },
    memory: {
      enabled: readBoolean(
        readEnvBoolean("VULCAN_QWENCODE_MEMORY_ENABLED"),
        readBoolean(merged.memory?.enabled, true),
      ),
      autoRecall: readBoolean(
        readEnvBoolean("VULCAN_QWENCODE_AUTO_RECALL"),
        readBoolean(merged.memory?.autoRecall, true),
      ),
      autoPostAction: readBoolean(
        readEnvBoolean("VULCAN_QWENCODE_AUTO_POSTACTION"),
        readBoolean(merged.memory?.autoPostAction, true),
      ),
      recallTopK: readPositiveNumber(merged.memory?.recallTopK, 5),
      implicitMemoryTurns: readNonNegativeInteger(
        merged.memory?.implicitMemoryTurns,
        DEFAULT_IMPLICIT_MEMORY_TURNS,
      ),
      profileRefreshTurns: readNonNegativeInteger(
        merged.memory?.profileRefreshTurns,
        DEFAULT_PROFILE_REFRESH_TURNS,
      ),
      timeoutMs: readPositiveNumber(merged.memory?.timeoutMs, 15_000),
    },
  };
  return resolved;
}

// buildConfigTemplate renders one commented-free JSON template that users can copy into global or workspace config files.
// buildConfigTemplate 渲染一份无注释 JSON 模板，供用户复制到全局或工作区配置文件中。
export function buildConfigTemplate(): string {
  const template: VulcanQwencodePluginConfig = {
    endpoint: DEFAULT_ENDPOINT,
    enabled: true,
    host: {
      autoStart: false,
      args: [],
      readyTimeoutMs: DEFAULT_HOST_READY_TIMEOUT_MS,
      env: {},
    },
    bindings: {
      defaultUserId: DEFAULT_BINDING_USER_ID,
      defaultProjectId: DEFAULT_BINDING_PROJECT_ID,
    },
    memory: {
      enabled: true,
      autoRecall: true,
      autoPostAction: true,
      recallTopK: 5,
      implicitMemoryTurns: DEFAULT_IMPLICIT_MEMORY_TURNS,
      profileRefreshTurns: DEFAULT_PROFILE_REFRESH_TURNS,
      timeoutMs: 15000,
    },
  };
  return `${JSON.stringify(template, null, 2)}\n`;
}

// fileExists reports whether one config file currently exists on disk.
// fileExists 用于报告某个配置文件当前是否存在于磁盘上。
export async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// parseBooleanEnv parses one env-string boolean override while preserving undefined for absent or invalid values.
// parseBooleanEnv 解析环境变量中的布尔覆盖值，并在缺失或非法时保留 undefined。
function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

// readEnvBoolean reads one named boolean environment variable and returns undefined when not set.
// readEnvBoolean 读取一个具名布尔环境变量，并在未设置时返回 undefined。
function readEnvBoolean(name: string): boolean | undefined {
  return parseBooleanEnv(process.env[name]);
}

// parseJsonStringArray parses one JSON-string array env var and returns undefined when parsing fails.
// parseJsonStringArray 解析一个 JSON 字符串数组环境变量，并在解析失败时返回 undefined。
function parseJsonStringArray(value: string | undefined): string[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = safeJsonParse(value);
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
    ? parsed
    : undefined;
}
