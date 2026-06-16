import fs from "fs";

export interface MentionChatMemoryResult {
  text: string | null;
  itemCount: number;
  charCount: number;
}

export interface LoadMentionChatMemoryOptions {
  enabled: boolean;
  filePath: string;
  userName: string;
  maxItems: number;
  maxChars: number;
}

type MemoryRecord = Record<string, unknown>;

const EMPTY_MEMORY: MentionChatMemoryResult = {
  text: null,
  itemCount: 0,
  charCount: 0,
};

function normalizeUserName(value: string): string {
  return value.trim().replace(/^[@＠]+/, "").toLowerCase();
}

function isRecord(value: unknown): value is MemoryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function primitiveToText(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }

  const text = singleLine(String(value));
  return text || null;
}

function itemToText(item: unknown): string | null {
  const primitive = primitiveToText(item);
  if (primitive) return primitive;
  if (!isRecord(item)) return null;

  const text = primitiveToText(item["text"]);
  if (text) return text;

  const key = primitiveToText(item["key"]);
  const value = primitiveToText(item["value"]);
  if (key && value) return `${key}: ${value}`;
  return value ?? key;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function userItems(users: unknown, userName: string): unknown[] {
  if (!isRecord(users)) return [];
  const normalizedUser = normalizeUserName(userName);
  const items: unknown[] = [];

  for (const [key, value] of Object.entries(users)) {
    if (normalizeUserName(key) === normalizedUser) {
      items.push(...asArray(value));
    }
  }

  return items;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function capLines(lines: string[], maxItems: number, maxChars: number): string[] {
  const capped: string[] = [];
  let usedChars = 0;

  for (const line of lines) {
    if (capped.length >= maxItems || usedChars >= maxChars) break;

    const separatorChars = capped.length > 0 ? 1 : 0;
    const remaining = maxChars - usedChars - separatorChars;
    if (remaining <= 0) break;

    const next = truncate(line, remaining);
    if (!next) break;
    capped.push(next);
    usedChars += separatorChars + next.length;
  }

  return capped;
}

export function loadMentionChatMemory({
  enabled,
  filePath,
  userName,
  maxItems,
  maxChars,
}: LoadMentionChatMemoryOptions): MentionChatMemoryResult {
  if (!enabled || !filePath.trim() || maxItems <= 0 || maxChars <= 0) {
    return { ...EMPTY_MEMORY };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { ...EMPTY_MEMORY };

    const lines = [
      ...asArray(parsed["global"]),
      ...userItems(parsed["users"], userName),
    ]
      .map(itemToText)
      .filter((line): line is string => Boolean(line));
    const capped = capLines(lines, maxItems, maxChars);
    const text = capped.join("\n");

    return {
      text: text || null,
      itemCount: capped.length,
      charCount: text.length,
    };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}
