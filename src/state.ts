// File-backed session state for Qwen profile injection and short-lived recall retention.
// 本文件负责 Qwen 画像注入与短期 recall 保温所需的文件型会话状态。

import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  asRecord,
  readFiniteNumber,
  readOptionalString,
  safeJsonParse,
} from "./json.js";
import type {
  VulcanActiveRecallState,
  VulcanPendingTurnState,
  VulcanProfileBundleState,
  VulcanQwencodeSessionState,
} from "./types.js";

// SESSION_STATE_IDLE_TTL_MS bounds how long one inactive session-state file stays resident before opportunistic pruning.
// SESSION_STATE_IDLE_TTL_MS 用于限制非活跃会话状态文件在机会性清理前最多保留多久。
const SESSION_STATE_IDLE_TTL_MS = 6 * 60 * 60 * 1000;

// QWEN_CONFIG_DIR is the shared Qwen home/config directory name.
// QWEN_CONFIG_DIR 是共享的 Qwen 主配置目录名。
const QWEN_CONFIG_DIR = ".qwen";

// SESSION_STATE_DIRNAME keeps plugin-owned session files under one dedicated runtime subtree.
// SESSION_STATE_DIRNAME 将插件拥有的会话文件收敛到专用运行时子目录。
const SESSION_STATE_DIRNAME = path.join("runtime", "vulcan-qwencode", "sessions");

// nextRecallGeneration monotonically bumps recall generations so newer recall can clearly supersede older cache.
// nextRecallGeneration 单调递增 recall generation，让新 recall 能明确替换旧缓存。
let nextRecallGeneration = 1;

// resolveRuntimeBaseDir returns the base runtime directory used for session-state persistence.
// resolveRuntimeBaseDir 返回用于持久化会话状态的运行时基础目录。
export function resolveRuntimeBaseDir(): string {
  if (process.env.QWEN_RUNTIME_DIR?.trim()) {
    return process.env.QWEN_RUNTIME_DIR.trim();
  }
  return path.join(os.homedir(), QWEN_CONFIG_DIR);
}

// resolveSessionStateDir returns the session-state directory for the current machine.
// resolveSessionStateDir 返回当前机器上的会话状态目录。
export function resolveSessionStateDir(): string {
  return path.join(resolveRuntimeBaseDir(), SESSION_STATE_DIRNAME);
}

// normalizeSessionId trims one maybe-empty session id so state files never key on whitespace noise.
// normalizeSessionId 裁剪可能为空的 session id，避免状态文件误落到空白键上。
function normalizeSessionId(sessionId: string): string {
  return sessionId.trim();
}

// hashText creates one compact deterministic fingerprint used for safe state-file names.
// hashText 创建一个紧凑的确定性指纹，用于安全的状态文件名。
function hashText(value: string): string {
  let hash = 0;
  for (const codePoint of value) {
    hash = (hash * 31 + codePoint.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

// resolveSessionStateFilePath converts one session id into its backing JSON file path.
// resolveSessionStateFilePath 将 session id 转换为其后端 JSON 文件路径。
export function resolveSessionStateFilePath(sessionId: string): string {
  return path.join(resolveSessionStateDir(), `${hashText(normalizeSessionId(sessionId))}.json`);
}

// createEmptyState creates one fresh default session state.
// createEmptyState 创建一份新的默认会话状态。
function createEmptyState(sessionId: string): VulcanQwencodeSessionState {
  return {
    sessionId: normalizeSessionId(sessionId),
    committedTurnCount: 0,
    lastTouchedAt: Date.now(),
  };
}

// loadSessionState loads one file-backed session state and opportunistically prunes long-idle leftovers.
// loadSessionState 加载一份文件型会话状态，并机会性清理长时间空闲的残留文件。
export async function loadSessionState(sessionId: string): Promise<VulcanQwencodeSessionState> {
  await pruneIdleSessionStates();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const filePath = resolveSessionStateFilePath(normalizedSessionId);
  try {
    const parsed = safeJsonParse(await readFile(filePath, "utf8"));
    const record = asRecord(parsed);
    const state: VulcanQwencodeSessionState = {
      sessionId: readOptionalString(record.sessionId) ?? normalizedSessionId,
      committedTurnCount: readFiniteNumber(record.committedTurnCount, 0),
      lastTouchedAt: Date.now(),
      lastTurnKey: readOptionalString(record.lastTurnKey),
      lastDisconnectNoticeAt: readFiniteNumber(record.lastDisconnectNoticeAt, 0) || undefined,
      profileBundle: normalizeProfileBundle(record.profileBundle),
      activeRecall: normalizeActiveRecall(record.activeRecall),
      pendingTurn: normalizePendingTurn(record.pendingTurn),
    };
    return state;
  } catch {
    return createEmptyState(normalizedSessionId);
  }
}

// saveSessionState writes one fully normalized session state back to disk.
// saveSessionState 将一份完全归一化后的会话状态写回磁盘。
export async function saveSessionState(state: VulcanQwencodeSessionState): Promise<void> {
  const next: VulcanQwencodeSessionState = {
    ...state,
    lastTouchedAt: Date.now(),
  };
  const filePath = resolveSessionStateFilePath(next.sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

// deleteSessionState removes one persisted session-state file.
// deleteSessionState 删除一份已持久化的会话状态文件。
export async function deleteSessionState(sessionId: string | undefined): Promise<void> {
  if (!sessionId?.trim()) {
    return;
  }
  const filePath = resolveSessionStateFilePath(sessionId);
  try {
    await unlink(filePath);
  } catch {
    return;
  }
}

// markSessionTurn records the latest turn key and reports whether this prompt opened a new real turn boundary.
// markSessionTurn 记录最新的 turn key，并报告这次提示是否开启了新的真实回合边界。
export function markSessionTurn(state: VulcanQwencodeSessionState, turnKey: string): boolean {
  state.lastTouchedAt = Date.now();
  if (state.lastTurnKey === turnKey) {
    return false;
  }
  state.lastTurnKey = turnKey;
  return true;
}

// startPendingTurn stores the current user prompt so Stop hooks can perform session-aware writeback.
// startPendingTurn 保存当前用户提示，以便 Stop hook 执行会话感知回写。
export function startPendingTurn(
  state: VulcanQwencodeSessionState,
  pendingTurn: VulcanPendingTurnState,
): void {
  state.pendingTurn = pendingTurn;
  state.lastTouchedAt = Date.now();
}

// clearPendingTurn removes the current pending turn after Stop, StopFailure, or forced cleanup.
// clearPendingTurn 在 Stop、StopFailure 或强制清理后移除当前待提交回合。
export function clearPendingTurn(state: VulcanQwencodeSessionState): void {
  state.pendingTurn = undefined;
  state.lastTouchedAt = Date.now();
}

// incrementCommittedTurnCount advances the stable closed-turn counter used by profile refresh cadence.
// incrementCommittedTurnCount 推进用于画像刷新节奏的稳定闭合回合计数器。
export function incrementCommittedTurnCount(state: VulcanQwencodeSessionState): number {
  state.committedTurnCount += 1;
  state.lastTouchedAt = Date.now();
  return state.committedTurnCount;
}

// consumeActiveRecallForNewTurn returns the warmed recall lines for this turn and decrements the remaining-turn budget.
// consumeActiveRecallForNewTurn 返回本轮可继续使用的保温 recall 行，并递减剩余轮次预算。
export function consumeActiveRecallForNewTurn(state: VulcanQwencodeSessionState): string[] {
  const activeRecall = state.activeRecall;
  if (!activeRecall || activeRecall.remainingTurns <= 0) {
    state.activeRecall = undefined;
    return [];
  }
  const lines = [...activeRecall.lines];
  activeRecall.remainingTurns = Math.max(0, activeRecall.remainingTurns - 1);
  activeRecall.lastInjectedAt = Date.now();
  if (activeRecall.remainingTurns <= 0) {
    state.activeRecall = undefined;
  }
  return lines;
}

// peekActiveRecallLines returns the current active recall lines without consuming the remaining-turn budget.
// peekActiveRecallLines 返回当前激活的 recall 行，但不会消耗剩余轮次预算。
export function peekActiveRecallLines(state: VulcanQwencodeSessionState): string[] {
  const activeRecall = state.activeRecall;
  if (!activeRecall || activeRecall.remainingTurns <= 0) {
    return [];
  }
  return [...activeRecall.lines];
}

// replaceActiveRecall rewrites the single active recall slot so new recall safely supersedes stale context.
// replaceActiveRecall 重写当前唯一的 recall 槽位，让新 recall 可以安全替换旧上下文。
export function replaceActiveRecall(
  state: VulcanQwencodeSessionState,
  turnKey: string,
  lines: string[],
  turns: number,
): VulcanActiveRecallState | undefined {
  const normalizedLines = [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
  if (normalizedLines.length === 0 || turns <= 0) {
    state.activeRecall = undefined;
    return undefined;
  }
  const recall: VulcanActiveRecallState = {
    generation: nextRecallGeneration++,
    sourceTurnKey: turnKey,
    lines: normalizedLines,
    remainingTurns: Math.max(0, Math.floor(turns)),
    createdAt: Date.now(),
    lastInjectedAt: Date.now(),
  };
  state.activeRecall = recall;
  state.lastTouchedAt = Date.now();
  return recall;
}

// clearActiveRecall removes the single active recall slot after expiry or scope changes.
// clearActiveRecall 在 recall 过期或作用域变化后移除唯一的 recall 槽位。
export function clearActiveRecall(state: VulcanQwencodeSessionState): void {
  state.activeRecall = undefined;
  state.lastTouchedAt = Date.now();
}

// normalizeProfileBundle narrows unknown persisted profile data into one safe bundle state.
// normalizeProfileBundle 将未知的持久化画像数据收窄为安全的 bundle 状态。
function normalizeProfileBundle(value: unknown): VulcanProfileBundleState | undefined {
  const record = asRecord(value);
  const signature = readOptionalString(record.signature);
  const userId = readOptionalString(record.userId);
  const projectId = readOptionalString(record.projectId);
  const bundleText = readOptionalString(record.bundleText);
  if (!signature || !userId || !projectId || !bundleText) {
    return undefined;
  }
  return {
    signature,
    userId,
    projectId,
    bundleText,
    traceId: readOptionalString(record.traceId),
    fetchedAt: readFiniteNumber(record.fetchedAt, Date.now()),
    fetchedAtCommittedTurnCount: readFiniteNumber(record.fetchedAtCommittedTurnCount, 0),
  };
}

// normalizeActiveRecall narrows unknown persisted recall data into one safe active-recall state.
// normalizeActiveRecall 将未知的持久化 recall 数据收窄为安全的激活 recall 状态。
function normalizeActiveRecall(value: unknown): VulcanActiveRecallState | undefined {
  const record = asRecord(value);
  const sourceTurnKey = readOptionalString(record.sourceTurnKey);
  const lines = Array.isArray(record.lines)
    ? record.lines.filter(
        (entry): entry is string => typeof entry === "string" && Boolean(entry.trim()),
      )
    : [];
  if (!sourceTurnKey || lines.length === 0) {
    return undefined;
  }
  return {
    generation: readFiniteNumber(record.generation, 1),
    sourceTurnKey,
    lines,
    remainingTurns: readFiniteNumber(record.remainingTurns, 0),
    createdAt: readFiniteNumber(record.createdAt, Date.now()),
    lastInjectedAt: readFiniteNumber(record.lastInjectedAt, Date.now()),
  };
}

// normalizePendingTurn narrows unknown persisted pending-turn data into one safe pending-turn state.
// normalizePendingTurn 将未知的持久化待提交回合数据收窄为安全的 pending-turn 状态。
function normalizePendingTurn(value: unknown): VulcanPendingTurnState | undefined {
  const record = asRecord(value);
  const turnKey = readOptionalString(record.turnKey);
  const prompt = readOptionalString(record.prompt);
  if (!turnKey || !prompt) {
    return undefined;
  }
  return {
    turnKey,
    prompt,
    transcriptPath: readOptionalString(record.transcriptPath),
    createdAt: readFiniteNumber(record.createdAt, Date.now()),
  };
}

// pruneIdleSessionStates evicts stale on-disk session state so long-running machines do not accumulate abandoned files forever.
// pruneIdleSessionStates 驱逐陈旧的磁盘会话状态，避免长期运行的机器无限堆积废弃文件。
async function pruneIdleSessionStates(): Promise<void> {
  const stateDir = resolveSessionStateDir();
  try {
    const entries = await readdir(stateDir, { withFileTypes: true });
    const cutoff = Date.now() - SESSION_STATE_IDLE_TTL_MS;
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(stateDir, entry.name);
          const fileStat = await stat(filePath);
          if (fileStat.mtimeMs < cutoff) {
            await rm(filePath, { force: true });
          }
        }),
    );
  } catch {
    return;
  }
}
