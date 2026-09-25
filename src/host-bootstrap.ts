// Local vulcan-host bootstrap helpers for hook and diagnostic runs.
// 本文件提供 hook 与诊断运行共用的本地 vulcan-host 启动辅助逻辑。

import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { ResolvedVulcanQwencodeConfig } from "./types.js";
import type { RuntimeLogger } from "./logger.js";

// DEFAULT_PROBE_TIMEOUT_MS bounds one TCP reachability probe so failed bootstrap checks return quickly.
// DEFAULT_PROBE_TIMEOUT_MS 用于限制单次 TCP 可达性探测时长，让失败的自启动检查尽快返回。
const DEFAULT_PROBE_TIMEOUT_MS = 800;

// normalizeGrpcEndpoint removes URL schemes because both probing and grpc-js expect host:port targets.
// normalizeGrpcEndpoint 会移除 URL scheme，因为探测逻辑与 grpc-js 都期望使用 host:port 目标。
function normalizeGrpcEndpoint(endpoint: string): string {
  return endpoint.replace(/^https?:\/\//u, "");
}

// parseEndpoint splits one normalized host:port endpoint into a TCP target pair.
// parseEndpoint 将规范化后的 host:port 端点拆分为 TCP 目标对。
function parseEndpoint(endpoint: string): { host: string; port: number } {
  const normalized = normalizeGrpcEndpoint(endpoint);
  const lastColonIndex = normalized.lastIndexOf(":");
  if (lastColonIndex <= 0) {
    throw new Error(`Invalid gRPC endpoint: ${endpoint}`);
  }
  const host = normalized.slice(0, lastColonIndex);
  const port = Number(normalized.slice(lastColonIndex + 1));
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid gRPC endpoint port: ${endpoint}`);
  }
  return { host, port };
}

// probeTcpReachability performs one bounded TCP connect probe against the configured endpoint.
// probeTcpReachability 对配置端点执行一次有界 TCP 连接探测。
export async function probeTcpReachability(endpoint: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  const target = parseEndpoint(endpoint);
  return await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(target.port, target.host);
  });
}

// ensureHostReady optionally auto-starts vulcan-host and waits for the gRPC endpoint to become reachable.
// ensureHostReady 会在需要时自启动 vulcan-host，并等待 gRPC 端点变为可达。
export async function ensureHostReady(
  config: ResolvedVulcanQwencodeConfig,
  logger: RuntimeLogger,
): Promise<void> {
  const reachable = await probeTcpReachability(config.endpoint);
  if (reachable) {
    return;
  }
  if (!config.host.autoStart || !config.host.command) {
    return;
  }
  logger.info(`vulcan-host endpoint ${config.endpoint} is unreachable, starting local host process.`);
  const child = spawn(config.host.command, config.host.args, {
    cwd: config.host.cwd,
    detached: true,
    env: {
      ...process.env,
      ...config.host.env,
    },
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  const deadline = Date.now() + config.host.readyTimeoutMs;
  while (Date.now() < deadline) {
    if (await probeTcpReachability(config.endpoint)) {
      logger.info(`vulcan-host is now reachable at ${config.endpoint}.`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for vulcan-host at ${config.endpoint} after local auto-start.`);
}
