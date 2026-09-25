// Shared runtime contracts for the Vulcan Qwencode extension.
// 本文件定义 Vulcan Qwencode 扩展共享的运行时契约。

// JsonPrimitive represents scalar JSON values crossing the gRPC and hook boundaries.
// JsonPrimitive 表示跨 gRPC 与 hook 边界传递的 JSON 标量值。
export type JsonPrimitive = string | number | boolean | null;

// JsonValue represents recursive JSON data accepted by the extension runtime.
// JsonValue 表示扩展运行时接受的递归 JSON 数据。
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

// JsonObject represents one string-keyed JSON object payload.
// JsonObject 表示一个以字符串为键的 JSON 对象载荷。
export interface JsonObject {
  [key: string]: JsonValue;
}

// VulcanHostBootstrapConfig describes the optional local vulcan-host auto-start policy.
// VulcanHostBootstrapConfig 描述可选的本地 vulcan-host 自启动策略。
export interface VulcanHostBootstrapConfig {
  autoStart?: boolean | undefined;
  command?: string | undefined;
  args?: string[] | undefined;
  cwd?: string | undefined;
  readyTimeoutMs?: number | undefined;
  env?: Record<string, string | number | boolean> | undefined;
}

// ResolvedVulcanHostBootstrapConfig is the normalized host auto-start policy consumed by runtime code.
// ResolvedVulcanHostBootstrapConfig 是运行时代码消费的归一化宿主自启动策略。
export interface ResolvedVulcanHostBootstrapConfig {
  autoStart: boolean;
  command?: string | undefined;
  args: string[];
  cwd?: string | undefined;
  readyTimeoutMs: number;
  env: Record<string, string>;
}

// VulcanQwencodePluginConfig mirrors the user-facing global/workspace JSON configuration.
// VulcanQwencodePluginConfig 映射面向用户的全局与工作区 JSON 配置。
export interface VulcanQwencodePluginConfig {
  endpoint?: string | undefined;
  protoPath?: string | undefined;
  clientName?: string | undefined;
  clientVersion?: string | undefined;
  enabled?: boolean | undefined;
  host?: VulcanHostBootstrapConfig | undefined;
  bindings?: {
    defaultUserId?: string | number | undefined;
    defaultProjectId?: string | number | undefined;
  };
  memory?: {
    enabled?: boolean | undefined;
    autoRecall?: boolean | undefined;
    autoPostAction?: boolean | undefined;
    recallTopK?: number | undefined;
    implicitMemoryTurns?: number | undefined;
    profileRefreshTurns?: number | undefined;
    timeoutMs?: number | undefined;
  };
}

// ResolvedVulcanQwencodeConfig is the normalized configuration used by the extension runtime.
// ResolvedVulcanQwencodeConfig 是扩展运行时使用的归一化配置。
export interface ResolvedVulcanQwencodeConfig {
  endpoint: string;
  protoPath?: string | undefined;
  clientName: string;
  clientVersion: string;
  enabled: boolean;
  configFiles: {
    globalPath: string;
    workspacePath?: string | undefined;
  };
  host: ResolvedVulcanHostBootstrapConfig;
  bindings: {
    defaultUserId: string;
    defaultProjectId: string;
  };
  memory: {
    enabled: boolean;
    autoRecall: boolean;
    autoPostAction: boolean;
    recallTopK: number;
    implicitMemoryTurns: number;
    profileRefreshTurns: number;
    timeoutMs: number;
  };
}

// VulcanHostContext carries trusted host identity and session data to vulcan-host.
// VulcanHostContext 承载传递给 vulcan-host 的受信任宿主身份与会话数据。
export interface VulcanHostContext {
  clientName: string;
  clientVersion: string;
  requestId: string;
  hostKind: "qwen-code";
  sessionKey?: string | undefined;
  sessionId?: string | undefined;
  workspaceDir?: string | undefined;
  conversationId?: string | undefined;
  rootSessionId?: string | undefined;
  turnId?: string | undefined;
  userMessage?: string | undefined;
}

// VulcanHostAdapterRuntime reports the normalized host runtime returned by HostAdapterService.
// VulcanHostAdapterRuntime 报告 HostAdapterService 返回的归一化宿主运行时。
export interface VulcanHostAdapterRuntime {
  hostKind: string;
  sessionId?: string | undefined;
  workmemId?: string | undefined;
  workmemSource?: string | undefined;
  identityReady: boolean;
  degradedReasons: string[];
  isError: boolean;
  message?: string | undefined;
  vmmEnabled: boolean;
  vmmStatus: string;
  runtime?: JsonObject | undefined;
}

// VulcanVmmResolvedUser carries the durable VMM user identity resolved by gRPC.
// VulcanVmmResolvedUser 承载通过 gRPC 解析出的长期 VMM 用户身份。
export interface VulcanVmmResolvedUser {
  userId: string;
  userName: string;
  message: string;
  created: boolean;
  exists: boolean;
}

// VulcanVmmResolvedProject carries the canonical VMM project identity resolved by gRPC.
// VulcanVmmResolvedProject 承载通过 gRPC 解析出的标准 VMM 项目身份。
export interface VulcanVmmResolvedProject {
  projectId: string;
  teamName: string;
  spaceName: string;
  projectName: string;
  displayPath: string;
  message: string;
  exists: boolean;
  needsConfirm: boolean;
  createdTeam: boolean;
  createdSpace: boolean;
  createdProject: boolean;
}

// VulcanVmmPrecheckContextItem represents one injected context item assembled by VMM precheck.
// VulcanVmmPrecheckContextItem 表示一条由 VMM precheck 组装出的注入上下文项。
export interface VulcanVmmPrecheckContextItem {
  text: string;
  score: number;
  turnId: string;
  hasDialogue: boolean;
  createdDatetime: string;
  memoryId: string;
}

// VulcanVmmDeleteMemoriesResponse carries the audited result of one explicit durable-memory delete batch.
// VulcanVmmDeleteMemoriesResponse 承载一次明确长期记忆删除批次的审计结果。
export interface VulcanVmmDeleteMemoriesResponse {
  deletedMemoryIds: string[];
  notFoundMemoryIds: string[];
  deletedVectorRows: string;
  traceId?: string | undefined;
}

// VulcanVmmPrecheckResponse carries one precheck injection decision.
// VulcanVmmPrecheckResponse 承载一次 precheck 注入决策。
export interface VulcanVmmPrecheckResponse {
  shouldInject: boolean;
  degraded: boolean;
  contextItems: VulcanVmmPrecheckContextItem[];
  traceId?: string | undefined;
}

// VulcanVmmProfileBundleResponse carries the authoritative hidden profile bundle assembled by VMM.
// VulcanVmmProfileBundleResponse 承载由 VMM 组装的权威隐藏画像 bundle。
export interface VulcanVmmProfileBundleResponse {
  combinedText: string;
  explanationText?: string | undefined;
  environmentPriorityText?: string | undefined;
  teamProfile?: string | undefined;
  spaceProfile?: string | undefined;
  projectProfile?: string | undefined;
  userProfile?: string | undefined;
  traceId?: string | undefined;
}

// VulcanVmmTurnTimelineItem represents one middle timeline node used by postaction.
// VulcanVmmTurnTimelineItem 表示 postaction 使用的一条中间 timeline 节点。
export interface VulcanVmmTurnTimelineItem {
  type: string;
  content: string;
}

// VulcanVmmPostActionResponse acknowledges one durable postaction append request.
// VulcanVmmPostActionResponse 用于确认一次持久化 postaction 追加请求。
export interface VulcanVmmPostActionResponse {
  accepted: boolean;
  traceId?: string | undefined;
}

// VulcanVmmChatCompactResponse acknowledges one compaction boundary update request.
// VulcanVmmChatCompactResponse 用于确认一次压缩边界更新请求。
export interface VulcanVmmChatCompactResponse {
  accepted: boolean;
  updated: boolean;
  compactedTurnId?: string | undefined;
  traceId?: string | undefined;
}

// VulcanVmmMemorySearchHit represents one grouped memory-search hit from VMM.
// VulcanVmmMemorySearchHit 表示一条来自 VMM 的分组记忆检索命中。
export interface VulcanVmmMemorySearchHit {
  memoryId: string;
  sourceTurnId: string;
  abstract: string;
  detailsPreview: string;
  category: string;
  createdDatetime: string;
}

// VulcanVmmMemorySearchGroupResult represents one normalized query plus its hit list.
// VulcanVmmMemorySearchGroupResult 表示一条归一化查询及其命中列表。
export interface VulcanVmmMemorySearchGroupResult {
  queryIndex: number;
  query: string;
  hits: VulcanVmmMemorySearchHit[];
}

// VulcanVmmMemorySearchResponse carries grouped memory-search results plus trace metadata.
// VulcanVmmMemorySearchResponse 承载分组记忆检索结果和 trace 元数据。
export interface VulcanVmmMemorySearchResponse {
  results: VulcanVmmMemorySearchGroupResult[];
  traceId?: string | undefined;
}

// VulcanStatus reports whether the target gRPC service is currently usable.
// VulcanStatus 报告目标 gRPC 服务当前是否可用。
export interface VulcanStatus {
  ok: boolean;
  message: string;
  version?: string | undefined;
  protocolVersion?: string | undefined;
}

// VulcanVmmStatus reports whether the VMM backend is enabled for the current host runtime.
// VulcanVmmStatus 报告当前宿主运行时是否启用了 VMM 后端。
export interface VulcanVmmStatus {
  enabled: boolean;
  status: string;
  isError?: boolean | undefined;
  message?: string | undefined;
}

// VulcanResolvedMemoryScope carries the resolved runtime plus the effective VMM binding set.
// VulcanResolvedMemoryScope 承载已解析的宿主运行时与最终 VMM 绑定集合。
export interface VulcanResolvedMemoryScope {
  runtime: VulcanHostAdapterRuntime;
  sessionId?: string | undefined;
  workmemId?: string | undefined;
  identityReady: boolean;
  degradedReasons: string[];
  user: VulcanVmmResolvedUser;
  project: VulcanVmmResolvedProject;
}

// VulcanResolvedMemoryScopeError preserves diagnostics when VMM scope resolution cannot complete.
// VulcanResolvedMemoryScopeError 在 VMM 作用域解析失败时保留诊断信息。
export interface VulcanResolvedMemoryScopeError {
  error: string;
  runtime?: VulcanHostAdapterRuntime | undefined;
  sessionId?: string | undefined;
  workmemId?: string | undefined;
  identityReady: boolean;
  degradedReasons: string[];
}

// VulcanResolvedMemoryScopeResult reports either a usable scope or a structured diagnostic failure.
// VulcanResolvedMemoryScopeResult 用于返回可用作用域或结构化诊断失败。
export type VulcanResolvedMemoryScopeResult =
  | { scope: VulcanResolvedMemoryScope }
  | VulcanResolvedMemoryScopeError;

// VulcanProfileBundleState keeps one fetched hidden profile bundle plus the committed-turn checkpoint used for periodic refresh.
// VulcanProfileBundleState 保存一份已获取的隐藏画像 bundle，以及定期刷新所需的 committed-turn 检查点。
export interface VulcanProfileBundleState {
  signature: string;
  userId: string;
  projectId: string;
  bundleText: string;
  traceId?: string | undefined;
  fetchedAt: number;
  fetchedAtCommittedTurnCount: number;
}

// VulcanActiveRecallState keeps one bounded short-lived recall slot for later turn reuse.
// VulcanActiveRecallState 保存一个有界的短期 recall 槽位，供后续轮次复用。
export interface VulcanActiveRecallState {
  generation: number;
  sourceTurnKey: string;
  lines: string[];
  remainingTurns: number;
  createdAt: number;
  lastInjectedAt: number;
}

// VulcanPendingTurnState keeps the current user prompt until the turn closes or fails.
// VulcanPendingTurnState 在回合闭合或失败前保存当前用户提示。
export interface VulcanPendingTurnState {
  turnKey: string;
  prompt: string;
  transcriptPath?: string | undefined;
  createdAt: number;
}

// VulcanQwencodeSessionState groups the runtime-only profile, recall, and pending-turn state tracked per Qwen session.
// VulcanQwencodeSessionState 汇总每个 Qwen 会话跟踪的运行时画像、recall 与待提交回合状态。
export interface VulcanQwencodeSessionState {
  sessionId: string;
  committedTurnCount: number;
  lastTouchedAt: number;
  lastTurnKey?: string | undefined;
  lastDisconnectNoticeAt?: number | undefined;
  profileBundle?: VulcanProfileBundleState | undefined;
  activeRecall?: VulcanActiveRecallState | undefined;
  pendingTurn?: VulcanPendingTurnState | undefined;
}

// TranscriptTimelineItem represents one tool-like middle step reconstructed from the Qwen transcript.
// TranscriptTimelineItem 表示一条从 Qwen 转录重建出的工具型中间步骤。
export interface TranscriptTimelineItem {
  type: string;
  content: string;
}

// TranscriptTurnSnapshot carries the latest best-effort user/assistant/tool slice reconstructed from JSONL transcript records.
// TranscriptTurnSnapshot 承载从 JSONL 转录记录尽力重建出的最近一组 user/assistant/tool 片段。
export interface TranscriptTurnSnapshot {
  userText?: string | undefined;
  assistantText?: string | undefined;
  timeline: TranscriptTimelineItem[];
}

// HookCommandInput is the common JSON payload delivered by Qwen command hooks.
// HookCommandInput 表示 Qwen command hooks 统一传入的 JSON 载荷。
export interface HookCommandInput {
  session_id?: string | undefined;
  transcript_path?: string | undefined;
  cwd?: string | undefined;
  hook_event_name?: string | undefined;
  timestamp?: string | undefined;
  prompt?: string | undefined;
  source?: string | undefined;
  last_assistant_message?: string | undefined;
  compact_summary?: string | undefined;
  trigger?: string | undefined;
  reason?: string | undefined;
}

// HookCommandOutput is the JSON result printed back to Qwen after one hook run.
// HookCommandOutput 表示单次 hook 执行后回写给 Qwen 的 JSON 结果。
export interface HookCommandOutput {
  continue?: boolean | undefined;
  suppressOutput?: boolean | undefined;
  stopReason?: string | undefined;
  systemMessage?: string | undefined;
  decision?: "ask" | "block" | "deny" | "approve" | "allow" | undefined;
  reason?: string | undefined;
  hookSpecificOutput?: {
    hookEventName?: string | undefined;
    additionalContext?: string | undefined;
    [key: string]: unknown;
  };
}

// DiagnosticReport groups the text lines produced by status/doctor CLI commands.
// DiagnosticReport 汇总 status 与 doctor CLI 命令输出的文本行。
export interface DiagnosticReport {
  lines: string[];
  ok: boolean;
}
