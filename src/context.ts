// Qwen hook context conversion helpers for vulcan-host requests.
// 本文件提供面向 vulcan-host 请求的 Qwen hook 上下文转换工具。

import { readOptionalString } from "./json.js";
import type { HookCommandInput, ResolvedVulcanQwencodeConfig, VulcanHostContext } from "./types.js";

// createRequestId creates one compact correlation id for diagnostics without implying session state.
// createRequestId 创建一个紧凑的诊断关联 ID，但不表达会话状态。
export function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// buildHookHostContext converts one Qwen command-hook payload into the trusted host context sent to vulcan-host.
// buildHookHostContext 将 Qwen command-hook 载荷转换为发送给 vulcan-host 的受信任宿主上下文。
export function buildHookHostContext(
  input: HookCommandInput,
  config: ResolvedVulcanQwencodeConfig,
): VulcanHostContext {
  const sessionId = readOptionalString(input.session_id);
  return {
    clientName: config.clientName,
    clientVersion: config.clientVersion,
    requestId: createRequestId("qwen-hook"),
    hostKind: "qwen-code",
    sessionKey: sessionId,
    sessionId,
    workspaceDir: readOptionalString(input.cwd),
    conversationId: readOptionalString(input.transcript_path),
    rootSessionId: sessionId,
    turnId: readOptionalString(input.timestamp),
    userMessage: readOptionalString(input.prompt),
  };
}
