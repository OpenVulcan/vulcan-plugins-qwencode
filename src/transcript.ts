// JSONL transcript readers for reconstructing the latest Qwen turn around Stop hooks.
// 本文件提供 JSONL 转录读取逻辑，用于在 Stop hook 周围重建最近的 Qwen 回合。

import { readFile } from "node:fs/promises";
import { asRecord, readOptionalString, safeJsonParse } from "./json.js";
import type { TranscriptTimelineItem, TranscriptTurnSnapshot } from "./types.js";

// MAX_TIMELINE_ITEM_CHARS keeps tool-result snippets compact before they are forwarded to VMM postaction.
// MAX_TIMELINE_ITEM_CHARS 用于在把工具结果转发给 VMM postaction 前保持片段足够紧凑。
const MAX_TIMELINE_ITEM_CHARS = 500;

// loadLatestTranscriptTurn reconstructs the latest user/assistant/tool slice from one Qwen JSONL transcript file.
// loadLatestTranscriptTurn 从一份 Qwen JSONL 转录文件重建最近一组 user/assistant/tool 片段。
export async function loadLatestTranscriptTurn(
  transcriptPath: string | undefined,
): Promise<TranscriptTurnSnapshot> {
  if (!transcriptPath?.trim()) {
    return { timeline: [] };
  }
  try {
    const lines = (await readFile(transcriptPath, "utf8"))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    const records = lines.map((line) => asRecord(safeJsonParse(line)));
    const assistantIndex = findLastIndex(records, (record) => record.type === "assistant");
    if (assistantIndex < 0) {
      return { timeline: [] };
    }
    const userIndex = findLastIndex(
      records.slice(0, assistantIndex),
      (record) => record.type === "user",
    );
    const absoluteUserIndex = userIndex >= 0 ? userIndex : -1;
    const userRecord = absoluteUserIndex >= 0 ? records[absoluteUserIndex] : undefined;
    const assistantRecord = records[assistantIndex];
    const middleRecords =
      absoluteUserIndex >= 0
        ? records.slice(absoluteUserIndex + 1, assistantIndex)
        : records.slice(0, assistantIndex);
    return {
      userText: extractTranscriptMessageText(userRecord),
      assistantText: extractTranscriptMessageText(assistantRecord),
      timeline: middleRecords
        .filter((record) => record.type === "tool_result")
        .map((record) => normalizeTimelineItem(record))
        .filter((item): item is TranscriptTimelineItem => Boolean(item)),
    };
  } catch {
    return { timeline: [] };
  }
}

// normalizeTimelineItem maps one transcript tool-result record into the compact timeline item shape used by VMM postaction.
// normalizeTimelineItem 将一条转录工具结果记录映射为 VMM postaction 使用的紧凑 timeline 结构。
function normalizeTimelineItem(record: Record<string, unknown>): TranscriptTimelineItem | null {
  const toolCallResult = asRecord(record.toolCallResult);
  const displayName = readOptionalString(toolCallResult.displayName) ?? readOptionalString(toolCallResult.name) ?? "tool_result";
  const text =
    compactText(
      readOptionalString(toolCallResult.result) ??
        readOptionalString(toolCallResult.output) ??
        extractTranscriptMessageText(record),
      MAX_TIMELINE_ITEM_CHARS,
    ) ?? "";
  return text ? { type: displayName, content: text } : null;
}

// extractTranscriptMessageText supports the most common string and part-array message shapes used by Qwen transcript records.
// extractTranscriptMessageText 支持 Qwen 转录记录中最常见的字符串与 part 数组消息结构。
function extractTranscriptMessageText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  const message = asRecord(record.message);
  const directText = readOptionalString(message.text);
  if (directText) {
    return directText;
  }
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const joined = parts
    .map((part) => {
      const partRecord = asRecord(part);
      return readOptionalString(partRecord.text) ?? readOptionalString(partRecord.outputText) ?? "";
    })
    .filter(Boolean)
    .join("\n");
  if (joined.trim()) {
    return joined.trim();
  }
  return readOptionalString(record.systemMessage) ?? readOptionalString(record.result);
}

// compactText keeps tool-result previews short enough to fit one bounded timeline slot.
// compactText 保持工具结果预览足够紧凑，以便装入一个有界 timeline 槽位。
function compactText(value: string | undefined, maxChars: number): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

// findLastIndex scans one array from the end and returns the last matching index.
// findLastIndex 从数组尾部扫描并返回最后一个满足条件的索引。
function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) {
      return index;
    }
  }
  return -1;
}
