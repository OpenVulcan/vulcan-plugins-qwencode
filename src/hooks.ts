// Prompt and lifecycle hooks for full-mode Vulcan memory integration in Qwen Code.
// 本文件实现 Qwen Code 完整模式 Vulcan 记忆接入所需的提示与生命周期 hooks。

import { buildHookHostContext } from "./context.js";
import { createVulcanHostClient } from "./grpc-client.js";
import { createRuntimeLogger, type RuntimeLogger } from "./logger.js";
import { ensureHostReady } from "./host-bootstrap.js";
import { readOptionalString } from "./json.js";
import {
  clearActiveRecall,
  clearPendingTurn,
  consumeActiveRecallForNewTurn,
  deleteSessionState,
  incrementCommittedTurnCount,
  loadSessionState,
  markSessionTurn,
  peekActiveRecallLines,
  replaceActiveRecall,
  saveSessionState,
  startPendingTurn,
} from "./state.js";
import { loadLatestTranscriptTurn } from "./transcript.js";
import type {
  HookCommandInput,
  HookCommandOutput,
  ResolvedVulcanQwencodeConfig,
  TranscriptTimelineItem,
  VulcanHostContext,
  VulcanProfileBundleState,
  VulcanQwencodeSessionState,
  VulcanResolvedMemoryScope,
  VulcanResolvedMemoryScopeResult,
  VulcanVmmMemorySearchHit,
  VulcanVmmPrecheckContextItem,
  VulcanVmmTurnTimelineItem,
} from "./types.js";
import { resolvePluginConfig } from "./config.js";

// MAX_RECALL_QUERY_CHARS bounds the prompt text forwarded to VMM precheck so recall remains focused and transport-safe.
// MAX_RECALL_QUERY_CHARS 用于限制转发给 VMM precheck 的 prompt 文本长度，保持 recall 聚焦且传输安全。
const MAX_RECALL_QUERY_CHARS = 2_000;

// MAX_TURN_FINGERPRINT_CHARS keeps user-turn fingerprints compact while still distinguishing most follow-up prompts.
// MAX_TURN_FINGERPRINT_CHARS 用于保持用户回合指纹足够紧凑，同时仍能区分大多数 follow-up 提示。
const MAX_TURN_FINGERPRINT_CHARS = 400;

// MAX_FALLBACK_PREVIEW_CHARS keeps fallback grouped-search previews readable inside one bounded recall slot.
// MAX_FALLBACK_PREVIEW_CHARS 用于把降级 grouped-search 预览控制在可读范围内，适配单槽 recall。
const MAX_FALLBACK_PREVIEW_CHARS = 220;

// DISCONNECT_NOTICE_COOLDOWN_MS bounds how often one offline notice may be reinjected into the same Qwen session.
// DISCONNECT_NOTICE_COOLDOWN_MS 用于限制同一 Qwen 会话中离线提示的重复注入频率。
const DISCONNECT_NOTICE_COOLDOWN_MS = 5 * 60 * 1000;

// POSTACTION_BLOCKED_STATE_RE matches blocked or approval-gated terminal texts that should never be persisted as durable VMM memories.
// POSTACTION_BLOCKED_STATE_RE 匹配阻断态或审批门控终态文本，这些回合绝不应该被持久化为稳定 VMM 记忆。
const POSTACTION_BLOCKED_STATE_RE =
  /\b(?:task needs follow-up|background task blocked|command did not run|approval (?:timed out|was denied|is required|request failed)|exec approval is required|blocked by sandbox|sandbox\b.*\b(?:blocked|denied|forbidden|disabled|not allowed)|approval-pending)\b/i;

// POSTACTION_FOLLOW_UP_REQUEST_RE detects assistant turns that are still asking for confirmation, approval, or extra user input.
// POSTACTION_FOLLOW_UP_REQUEST_RE 用于识别仍在索取确认、审批或补充输入的 assistant 回合。
const POSTACTION_FOLLOW_UP_REQUEST_RE =
  /\b(?:let me know|please confirm|please approve|reply with:?\s*\/approve|do you want me to|should I|can you confirm|could you confirm|once you confirm|waiting for approval|need(?:s)? your approval|need(?:s)? follow-up|what would you like me to|which .* would you like|before I continue)\b/i;

// POSTACTION_PLAN_ONLY_PROMISE_RE captures plan-only language that indicates the assistant described next steps but did not finish yet.
// POSTACTION_PLAN_ONLY_PROMISE_RE 捕获纯计划性语言，用于识别 assistant 只是描述下一步而尚未真正完成。
const POSTACTION_PLAN_ONLY_PROMISE_RE =
  /\b(?:i(?:'ll| will)|let me|i(?:'m| am)\s+going to|first[, ]+i(?:'ll| will)|next[, ]+i(?:'ll| will)|then[, ]+i(?:'ll| will)|i can do that)\b/i;

// POSTACTION_RESULT_SIGNAL_RE captures completion-oriented wording that usually means the assistant already delivered a stable result.
// POSTACTION_RESULT_SIGNAL_RE 捕获偏完成态的表达，用于识别 assistant 已经交付稳定结果。
const POSTACTION_RESULT_SIGNAL_RE =
  /\b(?:done|finished|implemented|updated|fixed|changed|ran|verified|found|here(?:'s| is) what|root cause|result|summary|completed|resolved|wrote|built|restarted|synced|installed|uninstalled)\b/i;

// POSTACTION_PLAN_HEADING_RE detects structured planning headings that usually appear in incomplete turns.
// POSTACTION_PLAN_HEADING_RE 用于识别结构化计划标题，这类标题通常出现在未闭合回合中。
const POSTACTION_PLAN_HEADING_RE = /^(?:plan|steps?|next steps?)\s*:/i;

// POSTACTION_BULLET_RE detects bullet-heavy assistant outputs so the planning-only heuristic can distinguish checklists from completed summaries.
// POSTACTION_BULLET_RE 用于识别项目符号密集输出，帮助 planning-only 启发式区分待办清单与完成总结。
const POSTACTION_BULLET_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/u;

// runHook resolves config and dispatches one Qwen hook event into the plugin runtime.
// runHook 负责解析配置，并把单个 Qwen hook 事件分发到插件运行时。
export async function runHook(eventName: string, input: HookCommandInput): Promise<HookCommandOutput | undefined> {
  const logger = createRuntimeLogger();
  const config = await resolvePluginConfig(readOptionalString(input.cwd));
  if (!config.enabled || !config.memory.enabled) {
    return undefined;
  }
  switch (eventName) {
    case "SessionStart":
      return await handleSessionStart(config, input, logger);
    case "SessionEnd":
      return await handleSessionEnd(input);
    case "UserPromptSubmit":
      return await handleUserPromptSubmit(config, input, logger);
    case "Stop":
      return await handleStop(config, input, logger);
    case "StopFailure":
      return await handleStopFailure(input);
    case "PostCompact":
      return await handlePostCompact(config, input, logger);
    default:
      logger.debug(`unsupported hook event ${eventName}, skipping.`);
      return undefined;
  }
}

// handleSessionStart initializes or refreshes file-backed session state when Qwen starts or resumes a session.
// handleSessionStart 在 Qwen 启动或恢复会话时初始化或刷新文件型会话状态。
async function handleSessionStart(
  config: ResolvedVulcanQwencodeConfig,
  input: HookCommandInput,
  logger: RuntimeLogger,
): Promise<HookCommandOutput | undefined> {
  const sessionId = readOptionalString(input.session_id);
  if (!sessionId) {
    return undefined;
  }
  const state = await loadSessionState(sessionId);
  clearPendingTurn(state);
  await saveSessionState(state);
  logger.debug(`session_start initialized state for ${sessionId}.`);
  return undefined;
}

// handleSessionEnd removes the persisted state snapshot so abandoned sessions do not keep stale recall/profile caches alive.
// handleSessionEnd 移除持久化状态快照，避免废弃会话长期保留过期 recall 或画像缓存。
async function handleSessionEnd(input: HookCommandInput): Promise<HookCommandOutput | undefined> {
  await deleteSessionState(readOptionalString(input.session_id));
  return undefined;
}

// handleStopFailure clears the pending turn because the current model turn closed with an API failure instead of a stable assistant result.
// handleStopFailure 会清理待提交回合，因为当前模型回合以 API 失败而不是稳定 assistant 结果结束。
async function handleStopFailure(input: HookCommandInput): Promise<HookCommandOutput | undefined> {
  const sessionId = readOptionalString(input.session_id);
  if (!sessionId) {
    return undefined;
  }
  const state = await loadSessionState(sessionId);
  clearPendingTurn(state);
  await saveSessionState(state);
  return undefined;
}

// handleUserPromptSubmit injects durable profile bundle context and bounded short-lived recall ahead of the active Qwen turn.
// handleUserPromptSubmit 在当前 Qwen 回合前注入持久画像 bundle 上下文与有界短期 recall。
async function handleUserPromptSubmit(
  config: ResolvedVulcanQwencodeConfig,
  input: HookCommandInput,
  logger: RuntimeLogger,
): Promise<HookCommandOutput | undefined> {
  const sessionId = readOptionalString(input.session_id);
  const prompt = normalizeRecallQuery(input.prompt);
  if (!sessionId || !prompt) {
    return undefined;
  }
  const state = await loadSessionState(sessionId);
  const turnKey = buildPromptTurnKey(prompt);
  const openedNewTurn = markSessionTurn(state, turnKey);
  startPendingTurn(state, {
    turnKey,
    prompt,
    transcriptPath: readOptionalString(input.transcript_path),
    createdAt: Date.now(),
  });
  const hostContext = buildHookHostContext(input, config);
  try {
    await ensureHostReady(config, logger);
    const client = createVulcanHostClient(config);
    const resolved = await resolveVulcanMemoryScope({
      client,
      config,
      context: hostContext,
      requireSession: false,
      purpose: "precheck",
    });
    if (!("scope" in resolved)) {
      logger.warn(`before prompt skipped because scope resolution failed: ${resolved.error}`);
      const cached = buildCachedInjectionOnScopeFailure(config, state, openedNewTurn, resolved.error);
      await saveSessionState(state);
      return cached ? createAdditionalContextOutput(cached) : undefined;
    }
    reconcileSessionScopeState(state, resolved.scope);
    const profileBundle = await buildProfileBundleInjection({
      client,
      config,
      state,
      scope: resolved.scope,
      hostContext,
    });
    const recallText = await buildRecallInjection({
      client,
      config,
      state,
      scope: resolved.scope,
      hostContext,
      query: prompt,
      turnKey,
      openedNewTurn,
      logger,
    });
    await saveSessionState(state);
    const merged = [profileBundle, recallText].filter(Boolean).join("\n\n");
    return merged ? createAdditionalContextOutput(merged) : undefined;
  } catch (error) {
    logger.warn(`before prompt injection skipped: ${String(error)}`);
    const fallback = buildDisconnectedHostInjection(state);
    await saveSessionState(state);
    return fallback ? createAdditionalContextOutput(fallback) : undefined;
  }
}

// handleStop records one closed committed turn for profile refresh cadence and optionally forwards the turn to VMM postaction.
// handleStop 记录一次闭合 committed turn 以驱动画像刷新节奏，并在启用时把该回合转发给 VMM postaction。
async function handleStop(
  config: ResolvedVulcanQwencodeConfig,
  input: HookCommandInput,
  logger: RuntimeLogger,
): Promise<HookCommandOutput | undefined> {
  const sessionId = readOptionalString(input.session_id);
  if (!sessionId) {
    return undefined;
  }
  const state = await loadSessionState(sessionId);
  const transcriptTurn = await loadLatestTranscriptTurn(
    state.pendingTurn?.transcriptPath ?? readOptionalString(input.transcript_path),
  );
  const userContent = state.pendingTurn?.prompt ?? transcriptTurn.userText ?? "";
  const assistantContent = readOptionalString(input.last_assistant_message) ?? transcriptTurn.assistantText ?? "";
  clearPendingTurn(state);
  if (!userContent.trim() || !assistantContent.trim()) {
    await saveSessionState(state);
    return undefined;
  }
  incrementCommittedTurnCount(state);
  const hostContext = buildHookHostContext(
    {
      ...input,
      prompt: userContent,
    },
    config,
  );
  try {
    await ensureHostReady(config, logger);
    const client = createVulcanHostClient(config);
    const profileScopeResult = await resolveVulcanMemoryScope({
      client,
      config,
      context: hostContext,
      requireSession: false,
      purpose: "profile",
    });
    if ("scope" in profileScopeResult) {
      reconcileSessionScopeState(state, profileScopeResult.scope);
      await maybeRefreshProfileBundleAfterCommittedTurn({
        client,
        config,
        state,
        scope: profileScopeResult.scope,
        hostContext,
      });
    }
    if (!config.memory.autoPostAction) {
      await saveSessionState(state);
      return undefined;
    }
    if (!isClosedAssistantResultTurn(assistantContent, transcriptTurn.timeline)) {
      await saveSessionState(state);
      return undefined;
    }
    const resolved =
      "scope" in profileScopeResult && profileScopeResult.scope.sessionId
        ? profileScopeResult
        : await resolveVulcanMemoryScope({
            client,
            config,
            context: hostContext,
            requireSession: true,
            purpose: "postaction",
          });
    if (!("scope" in resolved) || !resolved.scope.sessionId) {
      await saveSessionState(state);
      return undefined;
    }
    await client.postActionVmm({
      context: hostContext,
      sessionId: resolved.scope.sessionId,
      userId: resolved.scope.user.userId,
      projectId: resolved.scope.project.projectId,
      userContent: userContent.slice(0, 4000),
      assistantContent: assistantContent.slice(0, 6000),
      timeline: transcriptTurn.timeline.map((item) => ({
        type: item.type,
        content: item.content,
      })),
    });
    await saveSessionState(state);
    return undefined;
  } catch (error) {
    logger.warn(`postaction write skipped: ${String(error)}`);
    await saveSessionState(state);
    return undefined;
  }
}

// handlePostCompact acknowledges the new Qwen compact boundary so later VMM recall can reopen only compacted-away turns.
// handlePostCompact 确认 Qwen 新产生的 compact 边界，让后续 VMM 召回只重新开放已被压缩的回合。
async function handlePostCompact(
  config: ResolvedVulcanQwencodeConfig,
  input: HookCommandInput,
  logger: RuntimeLogger,
): Promise<HookCommandOutput | undefined> {
  const sessionId = readOptionalString(input.session_id);
  if (!sessionId) {
    return undefined;
  }
  const hostContext = buildHookHostContext(input, config);
  try {
    await ensureHostReady(config, logger);
    const client = createVulcanHostClient(config);
    const resolved = await resolveVulcanMemoryScope({
      client,
      config,
      context: hostContext,
      requireSession: true,
      purpose: "compact",
    });
    if (!("scope" in resolved) || !resolved.scope.sessionId) {
      return undefined;
    }
    await client.chatCompactVmm({
      context: hostContext,
      sessionId: resolved.scope.sessionId,
      userId: resolved.scope.user.userId,
      projectId: resolved.scope.project.projectId,
    });
    return undefined;
  } catch (error) {
    logger.warn(`post compact sync skipped: ${String(error)}`);
    return undefined;
  }
}

// resolveVulcanMemoryScope resolves host runtime state plus the effective user/project bindings required by VMM flows.
// resolveVulcanMemoryScope 解析宿主运行时状态，以及 VMM 链路所需的最终用户/项目绑定。
async function resolveVulcanMemoryScope(params: {
  client: ReturnType<typeof createVulcanHostClient>;
  config: ResolvedVulcanQwencodeConfig;
  context: VulcanHostContext;
  requireSession: boolean;
  purpose: "precheck" | "profile" | "compact" | "postaction" | "status";
}): Promise<VulcanResolvedMemoryScopeResult> {
  const runtime = await params.client.buildHostAdapterRuntime(params.context);
  const sessionId = runtime.sessionId ?? runtime.workmemId ?? params.context.sessionId ?? params.context.sessionKey;
  const degradedReasons = [...new Set(runtime.degradedReasons.map((reason) => reason.trim()).filter(Boolean))];
  if (runtime.isError) {
    return {
      error: runtime.message?.trim() || "Host adapter runtime initialization failed.",
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons,
    };
  }
  if (!runtime.vmmEnabled) {
    return {
      error: runtime.message?.trim() || runtime.vmmStatus.trim() || "VMM backend is disabled.",
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons,
    };
  }
  if (params.requireSession && !sessionId) {
    return {
      error: `VMM ${params.purpose} requires a session identity, but Qwen did not provide one.`,
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons: [...degradedReasons, "missing-session"],
    };
  }
  const [user, project] = await Promise.all([
    params.client.resolveVmmUser({
      context: params.context,
      userRef: params.config.bindings.defaultUserId,
      confirmCreate: false,
    }),
    params.client.resolveVmmProject({
      context: params.context,
      projectRef: params.config.bindings.defaultProjectId,
    }),
  ]);
  if (!user.userId.trim()) {
    return {
      error:
        user.message.trim() ||
        `Configured VMM user reference ${params.config.bindings.defaultUserId} could not be resolved.`,
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons,
    };
  }
  if (!project.projectId.trim()) {
    return {
      error:
        project.message.trim() ||
        `Configured VMM project reference ${params.config.bindings.defaultProjectId} could not be resolved.`,
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons,
    };
  }
  return {
    scope: {
      runtime,
      sessionId,
      workmemId: runtime.workmemId,
      identityReady: runtime.identityReady,
      degradedReasons,
      user,
      project,
    },
  };
}

// buildProfileBundleInjection resolves the hidden bundle cache for the current user/project scope and returns one context block when available.
// buildProfileBundleInjection 解析当前 user/project 作用域下的隐藏 bundle 缓存，并在可用时返回一段上下文区块。
async function buildProfileBundleInjection(params: {
  client: ReturnType<typeof createVulcanHostClient>;
  config: ResolvedVulcanQwencodeConfig;
  state: VulcanQwencodeSessionState;
  scope: VulcanResolvedMemoryScope;
  hostContext: VulcanHostContext;
}): Promise<string | undefined> {
  const signature = buildProfileBundleSignature(params.scope.user.userId, params.scope.project.projectId);
  const cachedBundle = params.state.profileBundle;
  const shouldRefresh = shouldRefreshProfileBundle({
    cachedBundle,
    signature,
    committedTurnCount: params.state.committedTurnCount,
    refreshTurns: params.config.memory.profileRefreshTurns,
  });
  let bundleText = cachedBundle?.bundleText.trim() ?? "";
  if (shouldRefresh) {
    const response = await params.client.getVmmProfileBundle({
      context: params.hostContext,
      userId: params.scope.user.userId,
      projectId: params.scope.project.projectId,
      includeExplanation: true,
    });
    bundleText = response.combinedText.trim();
    params.state.profileBundle = {
      signature,
      userId: params.scope.user.userId,
      projectId: params.scope.project.projectId,
      bundleText,
      traceId: response.traceId,
      fetchedAt: Date.now(),
      fetchedAtCommittedTurnCount: params.state.committedTurnCount,
    };
  }
  return bundleText ? renderImplicitProfileBundleContext(bundleText) : undefined;
}

// maybeRefreshProfileBundleAfterCommittedTurn refreshes the hidden profile bundle only after enough closed turns have accumulated.
// maybeRefreshProfileBundleAfterCommittedTurn 仅在累计了足够多的闭合回合后刷新隐藏画像 bundle。
async function maybeRefreshProfileBundleAfterCommittedTurn(params: {
  client: ReturnType<typeof createVulcanHostClient>;
  config: ResolvedVulcanQwencodeConfig;
  state: VulcanQwencodeSessionState;
  scope: VulcanResolvedMemoryScope;
  hostContext: VulcanHostContext;
}): Promise<void> {
  const cachedBundle = params.state.profileBundle;
  if (!cachedBundle) {
    return;
  }
  const signature = buildProfileBundleSignature(params.scope.user.userId, params.scope.project.projectId);
  const shouldRefresh = shouldRefreshProfileBundle({
    cachedBundle,
    signature,
    committedTurnCount: params.state.committedTurnCount,
    refreshTurns: params.config.memory.profileRefreshTurns,
  });
  if (!shouldRefresh) {
    return;
  }
  const response = await params.client.getVmmProfileBundle({
    context: params.hostContext,
    userId: params.scope.user.userId,
    projectId: params.scope.project.projectId,
    includeExplanation: true,
  });
  params.state.profileBundle = {
    signature,
    userId: params.scope.user.userId,
    projectId: params.scope.project.projectId,
    bundleText: response.combinedText.trim(),
    traceId: response.traceId,
    fetchedAt: Date.now(),
    fetchedAtCommittedTurnCount: params.state.committedTurnCount,
  };
}

// shouldRefreshProfileBundle decides whether the cached bundle is missing, out-of-scope, or stale enough to justify one refresh.
// shouldRefreshProfileBundle 用于判断缓存 bundle 是否缺失、作用域失配，或已经陈旧到需要刷新。
function shouldRefreshProfileBundle(params: {
  cachedBundle: VulcanProfileBundleState | undefined;
  signature: string;
  committedTurnCount: number;
  refreshTurns: number;
}): boolean {
  if (!params.cachedBundle) {
    return true;
  }
  if (params.cachedBundle.signature !== params.signature) {
    return true;
  }
  if (params.refreshTurns <= 0) {
    return false;
  }
  const turnsSinceFetch = Math.max(
    0,
    params.committedTurnCount - params.cachedBundle.fetchedAtCommittedTurnCount,
  );
  return turnsSinceFetch >= params.refreshTurns;
}

// buildRecallInjection drives one bounded single-slot recall state machine that favors fresh recall and falls back to carried recall.
// buildRecallInjection 驱动一个有界的单槽 recall 状态机，在有新 recall 时优先使用新结果，否则回退到保温 recall。
async function buildRecallInjection(params: {
  client: ReturnType<typeof createVulcanHostClient>;
  config: ResolvedVulcanQwencodeConfig;
  state: VulcanQwencodeSessionState;
  scope: VulcanResolvedMemoryScope;
  hostContext: VulcanHostContext;
  query: string;
  turnKey: string;
  openedNewTurn: boolean;
  logger: RuntimeLogger;
}): Promise<string | undefined> {
  if (!params.config.memory.autoRecall) {
    return undefined;
  }
  const carriedLines = params.openedNewTurn
    ? consumeActiveRecallForNewTurn(params.state)
    : peekActiveRecallLines(params.state);
  const freshLines = params.openedNewTurn
    ? await fetchFreshRecallLines({
        client: params.client,
        config: params.config,
        scope: params.scope,
        hostContext: params.hostContext,
        query: params.query,
        logger: params.logger,
      })
    : [];
  if (freshLines.length > 0) {
    if (params.config.memory.implicitMemoryTurns > 0) {
      replaceActiveRecall(
        params.state,
        params.turnKey,
        freshLines,
        params.config.memory.implicitMemoryTurns,
      );
    }
    return buildPrecheckContext(freshLines);
  }
  return carriedLines.length > 0 ? buildPrecheckContext(carriedLines) : undefined;
}

// fetchFreshRecallLines prefers VMM precheck for session-bound runs and falls back to grouped search only when session identity is unavailable.
// fetchFreshRecallLines 优先在具备 session 身份时走 VMM precheck，仅在 session 身份不可用时退回 grouped search。
async function fetchFreshRecallLines(params: {
  client: ReturnType<typeof createVulcanHostClient>;
  config: ResolvedVulcanQwencodeConfig;
  scope: VulcanResolvedMemoryScope;
  hostContext: VulcanHostContext;
  query: string;
  logger: RuntimeLogger;
}): Promise<string[]> {
  if (params.scope.sessionId) {
    const response = await params.client.preCheckVmm({
      context: params.hostContext,
      sessionId: params.scope.sessionId,
      userId: params.scope.user.userId,
      projectId: params.scope.project.projectId,
      userContent: params.query,
      recallMode: "session_compact",
    });
    if (!response.shouldInject || response.contextItems.length === 0) {
      return [];
    }
    return dedupeTextLines(response.contextItems.map((item) => formatPrecheckRecallItem(item)));
  }
  const fallback = await params.client.searchVmmMemories({
    context: params.hostContext,
    userId: params.scope.user.userId,
    projectId: params.scope.project.projectId,
    queries: [params.query],
    topK: params.config.memory.recallTopK,
  });
  return buildFallbackRecallItems(fallback.results);
}

// buildFallbackRecallItems compacts grouped VMM hits into concise recall segments that fit the single-slot recall cache.
// buildFallbackRecallItems 把分组 VMM 命中压缩成简洁的 recall 片段，适配单槽 recall 缓存。
function buildFallbackRecallItems(hitsByQuery: Array<{ query: string; hits: VulcanVmmMemorySearchHit[] }>): string[] {
  const items: string[] = [];
  for (const group of hitsByQuery) {
    for (const hit of group.hits) {
      const summary = compactInline(hit.abstract || hit.detailsPreview || `Memory ${hit.memoryId}`);
      if (!summary) {
        continue;
      }
      items.push(`[${group.query}|${formatVmmIdLabel(hit.memoryId, hit.sourceTurnId)}] ${summary}`);
    }
  }
  return dedupeTextLines(items);
}

// formatPrecheckRecallItem keeps one actionable memory id beside the backend-provided recall text.
// formatPrecheckRecallItem 会把可操作 memory id 与后端提供的召回文本放在一起。
function formatPrecheckRecallItem(item: VulcanVmmPrecheckContextItem): string {
  const summary = compactInline(item.text);
  if (!summary) {
    return "";
  }
  return `[${formatVmmIdLabel(item.memoryId, item.turnId)}|SOURCE:${item.score.toFixed(3)}${
    item.createdDatetime ? `|TIME:${item.createdDatetime}` : ""
  }] ${summary}`;
}

// formatVmmIdLabel renders the durable memory id as the delete-safe identifier while keeping the turn id as trace-only metadata.
// formatVmmIdLabel 把长期 memory id 渲染为可安全删除的标识，同时仅把 turn id 作为追溯元数据保留。
function formatVmmIdLabel(memoryId: string | undefined, turnId: string | undefined): string {
  const normalizedMemoryId = normalizePositiveId(memoryId);
  const normalizedTurnId = normalizePositiveId(turnId);
  return `VMM_ID:memory_id=${normalizedMemoryId || "unavailable"};turn_id=${normalizedTurnId || "none"}`;
}

// normalizePositiveId returns one decimal positive id or an empty string when the value cannot identify VMM data.
// normalizePositiveId 返回十进制正整数 id；当该值不能标识 VMM 数据时返回空字符串。
function normalizePositiveId(value: string | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[1-9][0-9]*$/.test(normalized) ? normalized : "";
}

// reconcileSessionScopeState clears stale recall and profile cache whenever the resolved user/project signature changes.
// reconcileSessionScopeState 会在解析出的 user/project 签名变化时清理陈旧的 recall 与画像缓存。
function reconcileSessionScopeState(state: VulcanQwencodeSessionState, scope: VulcanResolvedMemoryScope): void {
  const signature = buildProfileBundleSignature(scope.user.userId, scope.project.projectId);
  if (state.profileBundle?.signature && state.profileBundle.signature !== signature) {
    state.profileBundle = undefined;
    clearActiveRecall(state);
  }
}

// buildCachedInjectionOnScopeFailure reuses safe cached profile/recall state when runtime scope resolution transiently fails.
// buildCachedInjectionOnScopeFailure 会在运行时作用域解析暂时失败时复用安全的缓存画像与 recall 状态。
function buildCachedInjectionOnScopeFailure(
  config: ResolvedVulcanQwencodeConfig,
  state: VulcanQwencodeSessionState,
  openedNewTurn: boolean,
  error: string,
): string | undefined {
  if (!shouldReuseCachedInjectionOnScopeFailure(error)) {
    return undefined;
  }
  const carriedLines = config.memory.autoRecall
    ? openedNewTurn
      ? consumeActiveRecallForNewTurn(state)
      : peekActiveRecallLines(state)
    : [];
  const profileText = state.profileBundle?.bundleText
    ? renderImplicitProfileBundleContext(state.profileBundle.bundleText)
    : undefined;
  const recallText = carriedLines.length > 0 ? buildPrecheckContext(carriedLines) : undefined;
  const merged = [profileText, recallText].filter(Boolean).join("\n\n");
  return merged || undefined;
}

// shouldReuseCachedInjectionOnScopeFailure rejects clearly invalid binding/session failures while allowing transient failures to fall back.
// shouldReuseCachedInjectionOnScopeFailure 会拒绝明显的绑定或 session 非法失败，但允许暂时性失败回退到缓存。
function shouldReuseCachedInjectionOnScopeFailure(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return !(
    normalized.includes("could not be resolved") ||
    normalized.includes("vmm backend is disabled") ||
    normalized.includes("requires a session identity")
  );
}

// buildDisconnectedHostInjection injects one bounded warning block so the model can notify the user when Vulcan is temporarily offline.
// buildDisconnectedHostInjection 在 Vulcan 暂时离线时注入一条有界警示，让模型能通知用户当前服务失联。
function buildDisconnectedHostInjection(state: VulcanQwencodeSessionState): string | undefined {
  const now = Date.now();
  if (
    state.lastDisconnectNoticeAt &&
    now - state.lastDisconnectNoticeAt < DISCONNECT_NOTICE_COOLDOWN_MS
  ) {
    return undefined;
  }
  state.lastDisconnectNoticeAt = now;
  return [
    "Vulcan 服务当前失联。",
    "本轮不要依赖 Vulcan 记忆能力。",
    "请直接告知用户当前 Vulcan 服务未启动或暂不可达，并建议稍后重试。",
  ].join("\n");
}

// renderImplicitProfileBundleContext turns the hidden VMM profile bundle into a stable injected context block.
// renderImplicitProfileBundleContext 把隐藏的 VMM 画像 bundle 转换成稳定的注入上下文区块。
function renderImplicitProfileBundleContext(bundleText: string): string {
  return [
    "## Persistent Profile Bundle",
    "The following profile bundle is the latest persisted background context for the current user and project scope.",
    "Treat it as hidden durable background context, and let explicit current-turn user instructions override it when they conflict.",
    "",
    bundleText.trim(),
  ].join("\n");
}

// buildPrecheckContext assembles the compact prompt section injected ahead of the active Qwen user turn.
// buildPrecheckContext 组装注入到当前 Qwen 用户回合前的紧凑提示词片段。
function buildPrecheckContext(items: string[]): string {
  return [
    "## Vulcan Memory Recall",
    items
      .map((item, index) => `${index + 1}. ${item.trim()}`)
      .filter(Boolean)
      .join("\n\n"),
  ].join("\n\n");
}

// createAdditionalContextOutput wraps one merged context string into the Qwen hook output shape.
// createAdditionalContextOutput 将合并后的上下文字符串包装成 Qwen hook 输出结构。
function createAdditionalContextOutput(additionalContext: string): HookCommandOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };
}

// normalizeRecallQuery chooses the safest current prompt text as the VMM recall seed.
// normalizeRecallQuery 选择最安全的当前提示文本作为 VMM recall 种子。
function normalizeRecallQuery(prompt: string | undefined): string | undefined {
  const trimmed = prompt?.trim();
  return trimmed ? trimmed.slice(0, MAX_RECALL_QUERY_CHARS) : undefined;
}

// buildPromptTurnKey creates one compact deterministic fingerprint from the user prompt.
// buildPromptTurnKey 基于用户提示创建一个紧凑的确定性指纹。
function buildPromptTurnKey(prompt: string): string {
  return hashText(prompt.slice(0, MAX_TURN_FINGERPRINT_CHARS));
}

// buildProfileBundleSignature creates the stable cache key for one user/project pair.
// buildProfileBundleSignature 为一组 user/project 组合创建稳定的缓存键。
function buildProfileBundleSignature(userId: string, projectId: string): string {
  return `${userId.trim()}::${projectId.trim()}`;
}

// dedupeTextLines compacts one list of recall segments into stable unique text blocks.
// dedupeTextLines 把一组 recall 片段压缩成稳定的唯一文本块。
function dedupeTextLines(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

// compactInline keeps grouped-search snippets short enough to fit one bounded recall slot.
// compactInline 保持 grouped-search 片段足够紧凑，以便装入一个有界 recall 槽位。
function compactInline(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= MAX_FALLBACK_PREVIEW_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_FALLBACK_PREVIEW_CHARS - 3)}...`;
}

// hashText creates one compact deterministic fingerprint from text so retries can be deduplicated without storing the full prompt.
// hashText 基于文本创建一个紧凑的确定性指纹，让重试去重时不必持久保存完整提示。
function hashText(value: string): string {
  let hash = 0;
  for (const codePoint of value) {
    hash = (hash * 31 + codePoint.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

// isClosedAssistantResultTurn keeps postaction writeback limited to stable, closed assistant turns instead of follow-up asks or plan-only narration.
// isClosedAssistantResultTurn 将 postaction 写回限制在稳定闭合的 assistant 回合，避免追问或纯计划叙述进入长期记忆。
function isClosedAssistantResultTurn(
  assistantContent: string,
  timeline: TranscriptTimelineItem[],
): boolean {
  if (hasBlockedOrApprovalSignals(assistantContent, timeline)) {
    return false;
  }
  if (isFollowUpAssistantTurn(assistantContent)) {
    return false;
  }
  if (isPlanningOnlyAssistantTurn(assistantContent)) {
    return false;
  }
  return true;
}

// hasBlockedOrApprovalSignals scans the assistant text and nearby timeline entries for explicit blocked or approval-gated messages.
// hasBlockedOrApprovalSignals 扫描 assistant 文本与附近 timeline 条目，识别显式阻断态或审批门控消息。
function hasBlockedOrApprovalSignals(text: string, timeline: TranscriptTimelineItem[]): boolean {
  const candidateTexts = [text, ...timeline.slice(-4).map((item) => item.content)];
  return candidateTexts.some((candidate) => POSTACTION_BLOCKED_STATE_RE.test(candidate));
}

// isFollowUpAssistantTurn rejects assistant turns that still ask the operator for approval, confirmation, or a next-step choice.
// isFollowUpAssistantTurn 会拒绝仍在向操作者索要审批、确认或下一步选择的 assistant 回合。
function isFollowUpAssistantTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (POSTACTION_FOLLOW_UP_REQUEST_RE.test(trimmed)) {
    return true;
  }
  return trimmed.endsWith("?") && !POSTACTION_RESULT_SIGNAL_RE.test(trimmed);
}

// isPlanningOnlyAssistantTurn rejects checklist or promise-style replies that describe intended work but do not yet represent a durable completed outcome.
// isPlanningOnlyAssistantTurn 会拒绝清单式或承诺式回复，这些回复描述的是计划执行内容，而不是可沉淀的完成结果。
function isPlanningOnlyAssistantTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 1_200 || trimmed.includes("```")) {
    return false;
  }
  if (POSTACTION_RESULT_SIGNAL_RE.test(trimmed)) {
    return false;
  }
  if (!POSTACTION_PLAN_ONLY_PROMISE_RE.test(trimmed)) {
    return false;
  }
  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasPlanHeading = POSTACTION_PLAN_HEADING_RE.test(lines[0] ?? "");
  const bulletCount = lines.filter((line) => POSTACTION_BULLET_RE.test(line)).length;
  return hasPlanHeading || bulletCount >= 2 || !trimmed.includes("?");
}
