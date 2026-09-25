// JSON and primitive normalization helpers for the Vulcan Qwencode runtime.
// 本文件提供 Vulcan Qwencode 运行时使用的 JSON 与基础类型归一化辅助函数。

import type { JsonObject } from "./types.js";

// asRecord safely narrows unknown JSON-like input into one plain object shell.
// asRecord 将未知 JSON 风格输入安全收窄成普通对象外壳。
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// readOptionalString preserves non-empty strings and drops all other values.
// readOptionalString 保留非空字符串，并丢弃其他值。
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// readString converts unknown input into one trimmed string with a fallback.
// readString 将未知输入转换成带回退值的裁剪字符串。
export function readString(value: unknown, fallback: string): string {
  return readOptionalString(value) ?? fallback;
}

// readBoolean reads a boolean config value with a default fallback.
// readBoolean 读取布尔配置值，并在缺失时使用默认回退值。
export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// readFiniteNumber reads one finite numeric value and falls back when missing or invalid.
// readFiniteNumber 读取有限数值，并在缺失或非法时使用回退值。
export function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// readPositiveNumber reads one positive numeric value and falls back when invalid.
// readPositiveNumber 读取正数配置值，并在非法时使用回退值。
export function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

// readNonNegativeInteger reads one non-negative integer and falls back when invalid.
// readNonNegativeInteger 读取非负整数，并在非法时使用回退值。
export function readNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.max(0, Math.floor(value))
    : fallback;
}

// readStringArray normalizes a loose string-array input into trimmed non-empty strings.
// readStringArray 将宽松的字符串数组输入归一化为裁剪后的非空字符串列表。
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// readStringRecord normalizes a loose env-like object into a stable string map.
// readStringRecord 将宽松的类环境变量对象归一化为稳定的字符串映射。
export function readStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const next: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (typeof rawValue === "string" && rawValue.trim()) {
      next[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      next[key] = String(rawValue);
      continue;
    }
    if (typeof rawValue === "boolean") {
      next[key] = rawValue ? "true" : "false";
    }
  }
  return next;
}

// parseJsonObject parses a JSON object string while returning an empty object for invalid input.
// parseJsonObject 解析 JSON 对象字符串，并在输入非法时返回空对象。
export function parseJsonObject(value: string | undefined): JsonObject {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

// readArray normalizes unknown array-like input into one array of records.
// readArray 将未知数组型输入归一化为记录对象数组。
export function readArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => asRecord(entry));
}

// readPrimitiveArray normalizes unknown array-like input into a string array.
// readPrimitiveArray 将未知数组型输入归一化为字符串数组。
export function readPrimitiveArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (typeof entry === "number" && Number.isFinite(entry)) {
        return String(entry);
      }
      return "";
    })
    .filter(Boolean);
}

// safeJsonParse reads unknown JSON text into one unknown value without throwing.
// safeJsonParse 将未知 JSON 文本读取为 unknown 值，并避免抛出异常。
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
