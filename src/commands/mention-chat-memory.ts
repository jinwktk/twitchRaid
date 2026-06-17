import fs from "fs";
import path from "path";

export interface MentionChatMemoryResult {
  text: string | null;
  itemCount: number;
  charCount: number;
}

export interface LoadMentionChatMemoryOptions {
  enabled: boolean;
  filePath: string;
  maxItems: number;
  maxChars: number;
}

type MemoryRecord = Record<string, unknown>;

export interface MentionChatMemoryEntry {
  key: string;
  value: string;
}

export interface ExtractMentionChatMemoryEntryOptions {
  maxKeyChars: number;
  maxValueChars: number;
}

export interface SaveMentionChatAutoLearnMemoryOptions
  extends ExtractMentionChatMemoryEntryOptions {
  enabled: boolean;
  filePath: string;
  promptText: string;
  maxItems: number;
}

export interface SaveMentionChatAutoLearnMemoryResult {
  saved: boolean;
  reason:
    | "disabled"
    | "not_memory_request"
    | "invalid_file"
    | "write_failed"
    | "saved";
  key?: string;
}

const EMPTY_MEMORY: MentionChatMemoryResult = {
  text: null,
  itemCount: 0,
  charCount: 0,
};
const RESERVED_MEMORY_KEYS = new Set(["global", "users"]);
const MEMORY_REQUEST_PATTERN =
  /(?:^|\s)(?:覚えて|記憶して|メモして|忘れないで)[：:\s]*(.+)$/u;
const SUFFIX_MEMORY_REQUEST_PATTERN =
  /^(.+?)[。.!！?？\s]*(?:覚えて|記憶して|メモして|忘れないで)[！!。.\s]*$/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{8,}\d)/u;
const SECRET_PATTERN =
  /\b(?:token|secret|password|passwd|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b|認証|パスワード|秘密|環境変数/iu;

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

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^[`"'「『]+/, "").replace(/[`"'」』]+$/, "").trim();
}

function stripTrailingSentenceNoise(value: string): string {
  return value
    .replace(/[。.!！?？\s]+$/u, "")
    .replace(/(?:だよね|だよ|だね|です|だ|ね)$/u, "")
    .trim();
}

function isUnsafeMemoryText(value: string): boolean {
  return (
    URL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
    SECRET_PATTERN.test(value)
  );
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

function dictionaryValueToText(value: unknown): string | null {
  const primitive = primitiveToText(value);
  if (primitive) return primitive;
  if (!isRecord(value)) return null;

  return primitiveToText(value["text"]) ?? primitiveToText(value["value"]);
}

function dictionaryEntriesToLines(record: MemoryRecord): string[] {
  const reservedKeys = new Set(["global", "users"]);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = singleLine(key);
    if (!normalizedKey || reservedKeys.has(normalizedKey)) continue;

    const text = dictionaryValueToText(value);
    if (text) lines.push(`${normalizedKey}: ${text}`);
  }

  return lines;
}

function splitMemoryKeyValue(body: string): MentionChatMemoryEntry | null {
  for (const separator of ["=", "：", ":"]) {
    const index = body.indexOf(separator);
    if (index <= 0) continue;
    return {
      key: body.slice(0, index),
      value: body.slice(index + separator.length),
    };
  }

  const match = body.match(/^(.+?)は(.+)$/u);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

export function extractMentionChatMemoryEntry(
  promptText: string,
  { maxKeyChars, maxValueChars }: ExtractMentionChatMemoryEntryOptions
): MentionChatMemoryEntry | null {
  if (maxKeyChars <= 0 || maxValueChars <= 0) return null;

  const prompt = singleLine(promptText);
  const requestMatch = prompt.match(MEMORY_REQUEST_PATTERN);
  const suffixRequestMatch = requestMatch
    ? null
    : prompt.match(SUFFIX_MEMORY_REQUEST_PATTERN);
  const requestBody = requestMatch?.[1] ?? suffixRequestMatch?.[1];
  if (!requestBody) return null;

  const parsed = splitMemoryKeyValue(requestBody);
  if (!parsed) return null;

  const key = stripWrappingQuotes(singleLine(parsed.key));
  const rawValue = stripWrappingQuotes(singleLine(parsed.value));
  const value = stripTrailingSentenceNoise(rawValue);
  const normalizedKey = key.toLowerCase();
  if (!key || !value) return null;
  if (key.length > maxKeyChars || rawValue.length > maxValueChars) return null;
  if (RESERVED_MEMORY_KEYS.has(normalizedKey)) return null;
  if (isUnsafeMemoryText(key) || isUnsafeMemoryText(value)) return null;

  return { key, value };
}

function loadWritableMemoryRecord(filePath: string): MemoryRecord | null {
  if (!fs.existsSync(filePath)) return {};

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function capMemoryRecord(record: MemoryRecord, maxItems: number, keepKey: string): void {
  if (maxItems <= 0) return;

  let keys = Object.keys(record).filter(
    (key) => !RESERVED_MEMORY_KEYS.has(key)
  );
  while (keys.length > maxItems) {
    const deleteKey = keys.find((key) => key !== keepKey) ?? keys[0];
    delete record[deleteKey];
    keys = Object.keys(record).filter((key) => !RESERVED_MEMORY_KEYS.has(key));
  }
}

function writeMemoryRecordAtomically(filePath: string, record: MemoryRecord): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`
  );

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
}

export function saveMentionChatAutoLearnMemory({
  enabled,
  filePath,
  promptText,
  maxKeyChars,
  maxValueChars,
  maxItems,
}: SaveMentionChatAutoLearnMemoryOptions): SaveMentionChatAutoLearnMemoryResult {
  if (!enabled || !filePath.trim()) return { saved: false, reason: "disabled" };

  const entry = extractMentionChatMemoryEntry(promptText, {
    maxKeyChars,
    maxValueChars,
  });
  if (!entry) return { saved: false, reason: "not_memory_request" };

  try {
    const record = loadWritableMemoryRecord(filePath);
    if (!record) return { saved: false, reason: "invalid_file" };

    record[entry.key] = entry.value;
    capMemoryRecord(record, maxItems, entry.key);
    writeMemoryRecordAtomically(filePath, record);
    return { saved: true, reason: "saved", key: entry.key };
  } catch {
    return { saved: false, reason: "write_failed" };
  }
}

export function loadMentionChatMemory({
  enabled,
  filePath,
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
      ...dictionaryEntriesToLines(parsed),
      ...asArray(parsed["global"]).map(itemToText),
    ]
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
