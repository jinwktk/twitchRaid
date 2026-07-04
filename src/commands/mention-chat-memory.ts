import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

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
  queryText?: string;
}

export type MentionChatMemoryStoreKind = "json" | "sqlite";

export interface LoadMentionChatMemoryStoreOptions
  extends Omit<LoadMentionChatMemoryOptions, "filePath"> {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
}

type MemoryRecord = Record<string, unknown>;

export interface MentionChatMemoryEntry {
  key: string;
  value: string;
}

export interface ExtractMentionChatMemoryEntryOptions {
  maxKeyChars: number;
  maxValueChars: number;
  sourceUser?: string;
}

export interface ExtractImplicitMentionChatMemoryEntryOptions
  extends ExtractMentionChatMemoryEntryOptions {}

export interface ExtractStreamCommentMemoryEntriesOptions
  extends ExtractMentionChatMemoryEntryOptions {
  maxEntries: number;
  knownTargets?: string[];
}

export interface SaveMentionChatAutoLearnMemoryOptions
  extends ExtractMentionChatMemoryEntryOptions {
  enabled: boolean;
  filePath: string;
  promptText: string;
  maxItems: number;
  sourceUser?: string;
  now?: () => string;
}

export interface SaveMentionChatImplicitMemoryOptions
  extends SaveMentionChatAutoLearnMemoryOptions {}

export interface SaveMentionChatAutoLearnMemoryStoreOptions
  extends Omit<SaveMentionChatAutoLearnMemoryOptions, "filePath"> {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
}

export interface SaveMentionChatImplicitMemoryStoreOptions
  extends Omit<SaveMentionChatImplicitMemoryOptions, "filePath"> {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
}

export interface SaveMentionChatMemoryEntryStoreOptions {
  enabled: boolean;
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  maxItems: number;
  sourceUser?: string;
  now?: () => string;
}

export interface SaveMentionChatMemoryObservationStoreOptions {
  enabled: boolean;
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  maxItems: number;
  promotionMinObservations: number;
  sourceUser?: string;
  now?: () => string;
}

export type MentionChatMemoryEntryKind = "semantic" | "implicit";
export type MentionChatMemoryEntryStatus = "active" | "inactive" | "candidate";
export type MentionChatMemoryListStatus = MentionChatMemoryEntryStatus | "all";

export interface MentionChatMemoryAdminEntry {
  key: string;
  value: string;
  kind: MentionChatMemoryEntryKind;
  status: MentionChatMemoryEntryStatus;
  sourceUser: string;
  createdAt: string;
  updatedAt: string;
  confidence?: number;
  observedCount?: number;
  promotedAt?: string;
  lastObservedAt?: string;
}

export interface ListMentionChatMemoryEntriesStoreOptions {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
  status?: MentionChatMemoryListStatus;
  queryText?: string;
  limit?: number;
}

export interface ListMentionChatMemoryEntriesResult {
  entries: MentionChatMemoryAdminEntry[];
  totalCount: number;
  activeCount: number;
}

export interface UpsertMentionChatMemoryEntryStoreOptions {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
  key: string;
  value: string;
  kind?: MentionChatMemoryEntryKind;
  status?: MentionChatMemoryEntryStatus;
  sourceUser?: string;
  maxItems: number;
  maxKeyChars?: number;
  maxValueChars?: number;
  now?: () => string;
}

export interface DeleteMentionChatMemoryEntryStoreOptions {
  store: MentionChatMemoryStoreKind;
  jsonPath: string;
  sqlitePath: string;
  key: string;
}

export interface SaveMentionChatAutoLearnMemoryResult {
  saved: boolean;
  reason:
    | "disabled"
    | "not_memory_request"
    | "invalid_format"
    | "unsafe"
    | "reserved_key"
    | "too_long"
    | "invalid_file"
    | "write_failed"
    | "saved";
  key?: string;
}

export interface SaveMentionChatMemoryObservationStoreResult {
  saved: boolean;
  reason:
    | SaveMentionChatAutoLearnMemoryResult["reason"]
    | "observed"
    | "promoted"
    | "already_active"
    | "conflict";
  key?: string;
  status?: MentionChatMemoryEntryStatus;
  observedCount?: number;
  promoted: boolean;
}

export interface DeleteMentionChatMemoryEntryResult {
  deleted: boolean;
  reason: "deleted" | "not_found" | "invalid_file" | "write_failed";
  key?: string;
}

type SaveMentionChatAutoLearnMemoryFailureReason = Exclude<
  SaveMentionChatAutoLearnMemoryResult["reason"],
  "saved"
>;

export interface AnalyzeMentionChatMemoryRequestResult {
  isMemoryRequest: boolean;
  reason:
    | "valid"
    | "not_memory_request"
    | "invalid_format"
    | "unsafe"
    | "reserved_key"
    | "too_long";
  entry?: MentionChatMemoryEntry;
}

interface MemoryMetadata {
  kind?: string;
  status?: string;
  sourceUser?: string;
  createdAt?: string;
  updatedAt?: string;
  confidence?: number;
  observedCount?: number;
  promotedAt?: string;
  lastObservedAt?: string;
}

interface SqliteMemoryRow {
  key: string;
  value: string;
  kind: string;
  status: string;
  source_user: string;
  created_at: string;
  updated_at: string;
  confidence?: number;
  observed_count?: number;
  promoted_at?: string;
  last_observed_at?: string;
}

interface CountRow {
  count: number;
}

interface MemoryLine {
  key: string;
  value: string;
  line: string;
  index: number;
  updatedAt: number;
}

type MemoryTopic = "age" | "birthdate" | "residence";

const EMPTY_MEMORY: MentionChatMemoryResult = {
  text: null,
  itemCount: 0,
  charCount: 0,
};
const MEMORY_META_KEY = "__meta";
const RESERVED_MEMORY_KEYS = new Set(["global", "users", MEMORY_META_KEY]);
const MEMORY_REQUEST_PATTERN =
  /(?:覚えて|記憶して|メモして|忘れないで)[：:\s]+(.+)$/u;
const SUFFIX_MEMORY_REQUEST_PATTERN =
  /^(.+?)[。.!！?？\s]*(?:覚えて|記憶して|メモして|忘れないで)[！!。.\s]*$/u;
const MEMORY_KEYWORD_PATTERN =
  /(?:覚えて(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|記憶して(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|メモして(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|忘れないで(?!いる|いた|います|た|しょ))/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{8,}\d)/u;
const PII_KEY_PATTERN =
  /^(?:本名|氏名|住所|所在地|誕生日|生年月日|マイナンバー|個人番号|電話番号|メールアドレス|メール)$/iu;
const SECRET_PATTERN =
  /\b(?:token|secret|password|passwd|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b|apiキー|トークン|アクセストークン|リフレッシュトークン|シークレット|認証情報|認証|パスワード|秘密鍵|秘密|環境変数/iu;
const CREDENTIAL_VALUE_PATTERN =
  /\b(?:sk(?:-proj)?-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/u;
const PROMPT_INJECTION_PATTERN =
  /前の指示|上の指示|以前の指示|指示を無視|命令を無視|ルールを無視|システムプロンプト|プロンプトを表示|内部設定|developer message|system prompt|ignore (?:all )?(?:previous|above) instructions/iu;
const IMPLICIT_MEMORY_MAX_PROMPT_CHARS = 180;
const DEFAULT_STREAM_COMMENT_MEMORY_TARGETS = [
  "るっか",
  "るっかるん",
  "rukalun",
  "にめいや",
  "にめいやボットくん",
  "nyme_ia2",
];
const DEFAULT_ADMIN_MEMORY_MAX_KEY_CHARS = 40;
const DEFAULT_ADMIN_MEMORY_MAX_VALUE_CHARS = 120;
const DEFAULT_ADMIN_MEMORY_LIST_LIMIT = 200;
const MAX_ADMIN_MEMORY_LIST_LIMIT = 500;
const IMPLICIT_QUESTION_OR_REQUEST_PATTERN =
  /[?？]|(?:何|なに|どこ|いつ|誰|だれ|教えて|知ってる|調べて|検索|お願い|して(?:ください|ほしい)|かな)/u;
const IMPLICIT_TEMPORARY_KEY_PATTERN =
  /^(?:今日|昨日|明日|今|現在|さっき|今回|この|その|あの|これ|それ|あれ|ここ|そこ|あそこ)$/u;
const IMPLICIT_UNSTABLE_VALUE_PATTERN =
  /(?:かも|たぶん|多分|一時的|今だけ|今日だけ|昨日だけ|明日だけ)/u;
const IMPLICIT_TRANSIENT_CONVERSATION_PATTERN =
  /(?:もういい|その話|この話|あの話|同じ話|話は|調子に乗|あんま調子|負け|勝ち|低能|黙れ|やめろ)/u;
const IMPLICIT_RIDDLE_PATTERN =
  /(?:なーん|なぞなぞ|クイズ|答えは|モノマネ)/u;
const TWITCH_EMOTE_TOKEN_PATTERN = /\brukka[A-Za-z0-9_]+\b/u;
const IMPLICIT_PII_KEY_PATTERN =
  /本名|氏名|住所|所在地|誕生日|生年月日|マイナンバー|個人番号|電話番号|メールアドレス|メール/iu;
const FIRST_PERSON_SENSITIVE_VALUE_PATTERN =
  /(?:\d+|[0-9０-９]+)\s*(?:歳|才)|(?:誕生日|生年月日|生まれ|平成|昭和|令和|西暦|\d{4}年|[0-9０-９]+月[0-9０-９]+日)|(?:住んで|すんで|住まい|居住|在住|住所|所在地|出身|都|道|府|県|市|区|町|村)/u;
const FIRST_PERSON_PATTERN = /^(?:私|わたし|僕|ぼく|俺|おれ|うち|自分)$/u;
const STREAM_COMMENT_SENTENCE_PATTERN = /[^。.!！?？]+[。.!！?？]?/gu;
const SUBJECTLESS_FAVORITE_PATTERN =
  /^(.+?)が好き(?:です|だ|だよ|だね)?[。.!！\s]*$/u;

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

function stripTrailingMemoryRequestNoise(value: string): string {
  const withoutQuoteMarker = stripTrailingSentenceNoise(value)
    .replace(/(?:って|と)$/u, "")
    .trim();
  return stripTrailingSentenceNoise(withoutQuoteMarker);
}

function isUnsafeMemoryText(value: string): boolean {
  return (
    URL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
    SECRET_PATTERN.test(value) ||
    CREDENTIAL_VALUE_PATTERN.test(value) ||
    PROMPT_INJECTION_PATTERN.test(value)
  );
}

function isUnsafeMemoryKey(value: string): boolean {
  return PII_KEY_PATTERN.test(value) || isUnsafeMemoryText(value);
}

function isUnsafeImplicitMemoryKey(value: string): boolean {
  return (
    isUnsafeMemoryKey(value) ||
    IMPLICIT_PII_KEY_PATTERN.test(value) ||
    IMPLICIT_TEMPORARY_KEY_PATTERN.test(value)
  );
}

function normalizeImplicitSourceUser(sourceUser: string | undefined): string {
  return singleLine(sourceUser ?? "").replace(/^[@＠]+/, "").toLowerCase();
}

function normalizeStreamCommentMemoryKey(value: string): string {
  return singleLine(value).replace(/^[@＠]+/, "").toLowerCase();
}

function normalizeMemorySubjectKey(
  rawKey: string,
  sourceUser: string | undefined
): { key: string; isFirstPerson: boolean } {
  if (!FIRST_PERSON_PATTERN.test(rawKey)) {
    return { key: rawKey, isFirstPerson: false };
  }

  return {
    key: normalizeImplicitSourceUser(sourceUser) || "unknown",
    isFirstPerson: true,
  };
}

function isSensitiveFirstPersonMemoryValue(value: string): boolean {
  return FIRST_PERSON_SENSITIVE_VALUE_PATTERN.test(value);
}

function cleanImplicitMemoryEntry(
  entry: MentionChatMemoryEntry,
  options: ExtractImplicitMentionChatMemoryEntryOptions
): MentionChatMemoryEntry | null {
  const rawKey = stripWrappingQuotes(singleLine(entry.key));
  const rawValue = stripWrappingQuotes(singleLine(entry.value));
  const value = stripTrailingSentenceNoise(rawValue);
  const subject = normalizeMemorySubjectKey(rawKey, options.sourceUser);
  const key = subject.key;
  const normalizedKey = key.toLowerCase();

  if (!key || !value) return null;
  if (subject.isFirstPerson && isSensitiveFirstPersonMemoryValue(value)) {
    return null;
  }
  if ([...key].length < 2) return null;
  if (key.length > options.maxKeyChars || rawValue.length > options.maxValueChars) {
    return null;
  }
  if (/(?:です|ます)$/u.test(key)) return null;
  if (/(?:の話|話題)$/u.test(key)) return null;
  if (RESERVED_MEMORY_KEYS.has(normalizedKey)) return null;
  if (
    isUnsafeImplicitMemoryKey(key) ||
    isUnsafeMemoryText(value) ||
    IMPLICIT_UNSTABLE_VALUE_PATTERN.test(value) ||
    IMPLICIT_TRANSIENT_CONVERSATION_PATTERN.test(`${key} ${value}`) ||
    IMPLICIT_RIDDLE_PATTERN.test(`${key} ${value}`) ||
    TWITCH_EMOTE_TOKEN_PATTERN.test(`${key} ${value}`)
  ) {
    return null;
  }

  return { key, value };
}

function splitStreamCommentMemoryCandidates(text: string): string[] {
  const prompt = singleLine(text);
  if (!prompt) return [];
  return (
    prompt
      .match(STREAM_COMMENT_SENTENCE_PATTERN)
      ?.map((candidate) => singleLine(candidate))
      .filter(Boolean) ?? []
  );
}

function extractSubjectlessFavoriteStreamCommentMemoryEntry(
  text: string,
  options: ExtractStreamCommentMemoryEntriesOptions
): MentionChatMemoryEntry | null {
  const sourceUser = normalizeImplicitSourceUser(options.sourceUser);
  if (!sourceUser) return null;
  const match = text.match(SUBJECTLESS_FAVORITE_PATTERN);
  if (!match) return null;
  const value = stripWrappingQuotes(singleLine(match[1]));
  if (!value || value.includes("は")) return null;
  return cleanImplicitMemoryEntry(
    {
      key: `${sourceUser}の好きなもの`,
      value,
    },
    options
  );
}

function isAllowedStreamCommentMemoryEntry(
  entry: MentionChatMemoryEntry,
  options: ExtractStreamCommentMemoryEntriesOptions
): boolean {
  const sourceUser = normalizeImplicitSourceUser(options.sourceUser);
  const key = normalizeStreamCommentMemoryKey(entry.key);
  if (sourceUser && (key === sourceUser || key.startsWith(`${sourceUser}の`))) {
    return true;
  }

  const targets = (options.knownTargets ?? DEFAULT_STREAM_COMMENT_MEMORY_TARGETS)
    .map(normalizeStreamCommentMemoryKey)
    .filter(Boolean);
  return targets.some((target) => key === target || key.startsWith(`${target}の`));
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

function metadataRecord(record: MemoryRecord): Record<string, MemoryMetadata> {
  const value = record[MEMORY_META_KEY];
  if (!isRecord(value)) return {};
  return value as Record<string, MemoryMetadata>;
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dictionaryEntriesToMemoryLines(record: MemoryRecord): MemoryLine[] {
  const metadata = metadataRecord(record);
  const lines: MemoryLine[] = [];
  let index = 0;

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = singleLine(key);
    if (!normalizedKey || RESERVED_MEMORY_KEYS.has(normalizedKey)) continue;

    const meta = metadata[normalizedKey];
    if (meta?.status && meta.status !== "active") continue;

    const text = dictionaryValueToText(value);
    if (text && (isUnsafeMemoryKey(normalizedKey) || isUnsafeMemoryText(text))) {
      continue;
    }
    if (text) {
      lines.push({
        key: normalizedKey,
        value: text,
        line: `${normalizedKey}: ${text}`,
        index,
        updatedAt: parseTime(meta?.updatedAt),
      });
    }
    index++;
  }

  return lines;
}

function legacyGlobalItemsToMemoryLines(items: unknown[], startIndex: number): MemoryLine[] {
  return items
    .map((item, offset) => {
      const line = itemToText(item);
      if (!line) return null;
      const separatorIndex = line.indexOf(":");
      const key =
        separatorIndex > 0 ? singleLine(line.slice(0, separatorIndex)) : "";
      const value =
        separatorIndex > 0 ? singleLine(line.slice(separatorIndex + 1)) : line;
      if (
        isUnsafeMemoryKey(key) ||
        isUnsafeMemoryText(value) ||
        isUnsafeMemoryText(line)
      ) {
        return null;
      }
      return {
        key,
        value,
        line,
        index: startIndex + offset,
        updatedAt: 0,
      };
    })
    .filter((line): line is MemoryLine => Boolean(line));
}

function splitDelimitedMemoryKeyValue(body: string): MentionChatMemoryEntry | null {
  for (const separator of ["=", "：", ":"]) {
    const index = body.indexOf(separator);
    if (index <= 0) continue;
    return {
      key: body.slice(0, index),
      value: body.slice(index + separator.length),
    };
  }

  return null;
}

function splitMemoryKeyValue(body: string): MentionChatMemoryEntry | null {
  const delimited = splitDelimitedMemoryKeyValue(body);
  if (delimited) return delimited;

  const match = body.match(/^(.+?)は(.+)$/u);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

export function extractMentionChatMemoryEntry(
  promptText: string,
  { maxKeyChars, maxValueChars, sourceUser }: ExtractMentionChatMemoryEntryOptions
): MentionChatMemoryEntry | null {
  const result = analyzeMentionChatMemoryRequest(promptText, {
    maxKeyChars,
    maxValueChars,
    sourceUser,
  });
  return result.reason === "valid" ? result.entry ?? null : null;
}

export function analyzeMentionChatMemoryRequest(
  promptText: string,
  { maxKeyChars, maxValueChars, sourceUser }: ExtractMentionChatMemoryEntryOptions
): AnalyzeMentionChatMemoryRequestResult {
  if (maxKeyChars <= 0 || maxValueChars <= 0) {
    return { isMemoryRequest: false, reason: "not_memory_request" };
  }

  const prompt = singleLine(promptText);
  const requestMatch = prompt.match(MEMORY_REQUEST_PATTERN);
  const suffixRequestMatch = requestMatch
    ? null
    : prompt.match(SUFFIX_MEMORY_REQUEST_PATTERN);
  const requestBody = requestMatch?.[1] ?? suffixRequestMatch?.[1];
  if (!requestBody) {
    return MEMORY_KEYWORD_PATTERN.test(prompt)
      ? { isMemoryRequest: true, reason: "invalid_format" }
      : { isMemoryRequest: false, reason: "not_memory_request" };
  }

  const rawRequestBody = singleLine(requestBody);
  const normalizedRequestBody = stripTrailingMemoryRequestNoise(rawRequestBody);
  const parsed =
    splitDelimitedMemoryKeyValue(rawRequestBody) ??
    extractImplicitMentionChatMemoryEntry(normalizedRequestBody, {
      maxKeyChars,
      maxValueChars,
      sourceUser,
    }) ?? splitMemoryKeyValue(normalizedRequestBody);
  if (!parsed) {
    return { isMemoryRequest: true, reason: "invalid_format" };
  }

  const rawKey = stripWrappingQuotes(singleLine(parsed.key));
  const rawValue = stripWrappingQuotes(singleLine(parsed.value));
  const value = stripTrailingSentenceNoise(rawValue);
  const subject = normalizeMemorySubjectKey(rawKey, sourceUser);
  const key = subject.key;
  const normalizedKey = key.toLowerCase();
  if (!key || !value) {
    return { isMemoryRequest: true, reason: "invalid_format" };
  }
  if (subject.isFirstPerson && isSensitiveFirstPersonMemoryValue(value)) {
    return { isMemoryRequest: true, reason: "unsafe" };
  }
  if (key.length > maxKeyChars || rawValue.length > maxValueChars) {
    return { isMemoryRequest: true, reason: "too_long" };
  }
  if (RESERVED_MEMORY_KEYS.has(normalizedKey)) {
    return { isMemoryRequest: true, reason: "reserved_key" };
  }
  if (isUnsafeMemoryKey(key) || isUnsafeMemoryText(value)) {
    return { isMemoryRequest: true, reason: "unsafe" };
  }

  return { isMemoryRequest: true, reason: "valid", entry: { key, value } };
}

export function extractImplicitMentionChatMemoryEntry(
  promptText: string,
  options: ExtractImplicitMentionChatMemoryEntryOptions
): MentionChatMemoryEntry | null {
  if (options.maxKeyChars <= 0 || options.maxValueChars <= 0) return null;

  const prompt = singleLine(promptText);
  if (!prompt || prompt.length > IMPLICIT_MEMORY_MAX_PROMPT_CHARS) return null;
  if (MEMORY_KEYWORD_PATTERN.test(prompt)) return null;
  if (IMPLICIT_QUESTION_OR_REQUEST_PATTERN.test(prompt)) return null;
  if (isUnsafeMemoryText(prompt)) return null;
  if (
    IMPLICIT_TRANSIENT_CONVERSATION_PATTERN.test(prompt) ||
    IMPLICIT_RIDDLE_PATTERN.test(prompt) ||
    TWITCH_EMOTE_TOKEN_PATTERN.test(prompt)
  ) {
    return null;
  }

  const favoriteMatch = prompt.match(/^(.+?)は(.+?)が好き(?:です|だ|だよ|だね)?[。.!！\s]*$/u);
  if (favoriteMatch) {
    const sourceUser = normalizeImplicitSourceUser(options.sourceUser);
    const subject = stripWrappingQuotes(singleLine(favoriteMatch[1]));
    if (!FIRST_PERSON_PATTERN.test(subject) && !/るっか/u.test(subject)) {
      return null;
    }
    const keySubject = FIRST_PERSON_PATTERN.test(subject)
      ? sourceUser || "unknown"
      : subject;
    return cleanImplicitMemoryEntry(
      {
        key: `${keySubject}の好きなもの`,
        value: favoriteMatch[2],
      },
      options
    );
  }

  const parsed = splitMemoryKeyValue(prompt);
  if (!parsed) return null;
  return cleanImplicitMemoryEntry(parsed, options);
}

export function extractStreamCommentMemoryEntries(
  commentText: string,
  options: ExtractStreamCommentMemoryEntriesOptions
): MentionChatMemoryEntry[] {
  const maxEntries = Math.max(0, Math.floor(options.maxEntries));
  if (maxEntries <= 0) return [];

  const entries: MentionChatMemoryEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of splitStreamCommentMemoryCandidates(commentText)) {
    if (entries.length >= maxEntries) break;
    const entry =
      extractImplicitMentionChatMemoryEntry(candidate, options) ??
      extractSubjectlessFavoriteStreamCommentMemoryEntry(candidate, options);
    if (!entry) continue;
    if (!isAllowedStreamCommentMemoryEntry(entry, options)) continue;

    const dedupKey = `${entry.key}\n${entry.value}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    entries.push(entry);
  }
  return entries;
}

function loadWritableMemoryRecord(filePath: string): MemoryRecord | null {
  if (!fs.existsSync(filePath)) return {};

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function capMemoryRecord(record: MemoryRecord, maxItems: number, keepKey: string): void {
  if (maxItems <= 0) return;
  const meta = metadataRecord(record);

  let keys = Object.keys(record).filter(
    (key) => !RESERVED_MEMORY_KEYS.has(key)
  );
  while (keys.length > maxItems) {
    const deleteKey = keys.find((key) => key !== keepKey) ?? keys[0];
    delete record[deleteKey];
    delete meta[deleteKey];
    keys = Object.keys(record).filter((key) => !RESERVED_MEMORY_KEYS.has(key));
  }
  if (Object.keys(meta).length > 0) {
    record[MEMORY_META_KEY] = meta;
  } else {
    delete record[MEMORY_META_KEY];
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

function normalizeMemoryKind(value: string | undefined): "semantic" | "implicit" {
  return value === "implicit" ? "implicit" : "semantic";
}

function normalizeMemoryStatus(
  value: string | undefined
): MentionChatMemoryEntryStatus {
  if (value === "inactive") return "inactive";
  if (value === "candidate") return "candidate";
  return "active";
}

function normalizeListStatus(
  value: MentionChatMemoryListStatus | undefined
): MentionChatMemoryListStatus {
  return value === "inactive" || value === "candidate" || value === "all"
    ? value
    : "active";
}

function normalizeListLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_ADMIN_MEMORY_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), MAX_ADMIN_MEMORY_LIST_LIMIT);
}

function normalizeAdminEntryKind(
  value: MentionChatMemoryEntryKind | undefined
): MentionChatMemoryEntryKind {
  return value === "implicit" ? "implicit" : "semantic";
}

function normalizeAdminEntryStatus(
  value: MentionChatMemoryEntryStatus | undefined
): MentionChatMemoryEntryStatus {
  if (value === "candidate") return "candidate";
  return value === "inactive" ? "inactive" : "active";
}

function rowToAdminEntry(row: SqliteMemoryRow): MentionChatMemoryAdminEntry {
  const status = normalizeMemoryStatus(row.status);
  const observedCount = Math.max(1, Number(row.observed_count ?? 1));
  const confidence =
    Number.isFinite(row.confidence) && row.confidence !== undefined
      ? Number(row.confidence)
      : status === "candidate"
        ? 50
        : 100;
  const entry: MentionChatMemoryAdminEntry = {
    key: row.key,
    value: row.value,
    kind: normalizeMemoryKind(row.kind),
    status,
    sourceUser: singleLine(row.source_user) || "unknown",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (status === "candidate" || observedCount > 1) {
    entry.observedCount = observedCount;
    entry.confidence = confidence;
  }
  if (row.promoted_at) entry.promotedAt = row.promoted_at;
  if (row.last_observed_at && (status === "candidate" || observedCount > 1)) {
    entry.lastObservedAt = row.last_observed_at;
  }
  return entry;
}

function adminEntryMatchesQuery(
  entry: MentionChatMemoryAdminEntry,
  queryText: string | undefined
): boolean {
  const query = normalizedSearchText(queryText ?? "");
  if (!query) return true;
  return [
    entry.key,
    entry.value,
    entry.kind,
    entry.status,
    entry.sourceUser,
  ].some((value) => normalizedSearchText(value).includes(query));
}

function compareAdminEntries(
  a: MentionChatMemoryAdminEntry,
  b: MentionChatMemoryAdminEntry
): number {
  const timeDiff = parseTime(b.updatedAt) - parseTime(a.updatedAt);
  if (timeDiff !== 0) return timeDiff;
  return a.key.localeCompare(b.key);
}

function cleanAdminMemoryEntry({
  key,
  value,
  maxKeyChars,
  maxValueChars,
}: {
  key: string;
  value: string;
  maxKeyChars?: number;
  maxValueChars?: number;
}): { entry: MentionChatMemoryEntry } | { reason: SaveMentionChatAutoLearnMemoryFailureReason } {
  const cleanKey = stripTrailingSentenceNoise(stripWrappingQuotes(singleLine(key)));
  const cleanValue = stripTrailingSentenceNoise(stripWrappingQuotes(singleLine(value)));
  const keyLimit = maxKeyChars ?? DEFAULT_ADMIN_MEMORY_MAX_KEY_CHARS;
  const valueLimit = maxValueChars ?? DEFAULT_ADMIN_MEMORY_MAX_VALUE_CHARS;

  if (!cleanKey || !cleanValue) return { reason: "invalid_format" };
  if (RESERVED_MEMORY_KEYS.has(cleanKey)) return { reason: "reserved_key" };
  if (cleanKey.length > keyLimit || cleanValue.length > valueLimit) {
    return { reason: "too_long" };
  }
  if (isUnsafeMemoryKey(cleanKey) || isUnsafeMemoryText(cleanValue)) {
    return { reason: "unsafe" };
  }

  return { entry: { key: cleanKey, value: cleanValue } };
}

function openMemoryDatabase(sqlitePath: string): DatabaseSync | null {
  if (!sqlitePath.trim()) return null;
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  migrateMemoryDatabase(db);
  return db;
}

function migrateMemoryDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mention_chat_memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'semantic',
      status TEXT NOT NULL DEFAULT 'active',
      source_user TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 100,
      observed_count INTEGER NOT NULL DEFAULT 1,
      promoted_at TEXT NOT NULL DEFAULT '',
      last_observed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_mention_chat_memory_status_updated
      ON mention_chat_memory (status, updated_at DESC);
  `);

  addSqliteColumnIfMissing(
    db,
    "mention_chat_memory",
    "confidence",
    "INTEGER NOT NULL DEFAULT 100"
  );
  addSqliteColumnIfMissing(
    db,
    "mention_chat_memory",
    "observed_count",
    "INTEGER NOT NULL DEFAULT 1"
  );
  addSqliteColumnIfMissing(
    db,
    "mention_chat_memory",
    "promoted_at",
    "TEXT NOT NULL DEFAULT ''"
  );
  addSqliteColumnIfMissing(
    db,
    "mention_chat_memory",
    "last_observed_at",
    "TEXT NOT NULL DEFAULT ''"
  );
}

function addSqliteColumnIfMissing(
  db: DatabaseSync,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as unknown as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function countSqliteMemoryRows(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM mention_chat_memory")
    .get() as unknown as CountRow;
  return row.count;
}

function insertSqliteMemoryRow(
  db: DatabaseSync,
  row: {
    key: string;
    value: string;
    kind: MentionChatMemoryEntryKind;
    status: MentionChatMemoryEntryStatus;
    sourceUser: string;
    createdAt: string;
    updatedAt: string;
    confidence?: number;
    observedCount?: number;
    promotedAt?: string;
    lastObservedAt?: string;
  }
): void {
  const observedCount = Math.max(1, Math.floor(row.observedCount ?? 1));
  const confidence = Math.max(
    0,
    Math.min(
      100,
      Math.floor(row.confidence ?? (row.status === "candidate" ? 50 : 100))
    )
  );
  const promotedAt =
    row.promotedAt ?? (row.status === "active" ? row.updatedAt : "");
  const lastObservedAt = row.lastObservedAt ?? row.updatedAt;

  db
    .prepare(
      `
      INSERT INTO mention_chat_memory (
        key,
        value,
        kind,
        status,
        source_user,
        created_at,
        updated_at,
        confidence,
        observed_count,
        promoted_at,
        last_observed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        kind = excluded.kind,
        status = excluded.status,
        source_user = excluded.source_user,
        updated_at = excluded.updated_at,
        confidence = excluded.confidence,
        observed_count = excluded.observed_count,
        promoted_at = excluded.promoted_at,
        last_observed_at = excluded.last_observed_at
    `
    )
    .run(
      row.key,
      row.value,
      row.kind,
      row.status,
      row.sourceUser,
      row.createdAt,
      row.updatedAt,
      confidence,
      observedCount,
      promotedAt,
      lastObservedAt
    );
}

function importJsonMemoryIntoSqliteIfEmpty(
  db: DatabaseSync,
  jsonPath: string,
  now: () => string
): void {
  if (countSqliteMemoryRows(db) > 0 || !jsonPath.trim() || !fs.existsSync(jsonPath)) {
    return;
  }

  const record = loadWritableMemoryRecord(jsonPath);
  if (!record) return;

  const timestamp = now();
  const meta = metadataRecord(record);
  const rows: Array<Parameters<typeof insertSqliteMemoryRow>[1]> = [];

  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = singleLine(key);
    if (!normalizedKey || RESERVED_MEMORY_KEYS.has(normalizedKey)) continue;

    const text = dictionaryValueToText(value);
    if (!text || isUnsafeMemoryKey(normalizedKey) || isUnsafeMemoryText(text)) {
      continue;
    }

    const entryMeta = meta[normalizedKey];
    rows.push({
      key: normalizedKey,
      value: text,
      kind: normalizeMemoryKind(entryMeta?.kind),
      status: normalizeMemoryStatus(entryMeta?.status),
      sourceUser: singleLine(entryMeta?.sourceUser ?? "") || "json-backup",
      createdAt: entryMeta?.createdAt || timestamp,
      updatedAt: entryMeta?.updatedAt || entryMeta?.createdAt || timestamp,
    });
  }

  const legacyRows = legacyGlobalItemsToMemoryLines(
    asArray(record["global"]),
    rows.length
  );
  legacyRows.forEach((line, index) => {
    rows.push({
      key: line.key || `legacy-${index + 1}`,
      value: line.value,
      kind: "semantic",
      status: "active",
      sourceUser: "json-backup",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  if (rows.length === 0) return;

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      insertSqliteMemoryRow(db, row);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function sqliteRowsToMemoryLines(rows: SqliteMemoryRow[]): MemoryLine[] {
  return rows
    .map((row, index): MemoryLine | null => {
      const key = singleLine(row.key);
      const value = singleLine(row.value);
      if (!key || !value || RESERVED_MEMORY_KEYS.has(key)) return null;
      if (row.status !== "active") return null;
      if (isUnsafeMemoryKey(key) || isUnsafeMemoryText(value)) return null;

      return {
        key,
        value,
        line: `${key}: ${value}`,
        index,
        updatedAt: parseTime(row.updated_at),
      };
    })
    .filter((line): line is MemoryLine => Boolean(line));
}

function loadMentionChatMemorySqlite({
  enabled,
  sqlitePath,
  jsonPath,
  maxItems,
  maxChars,
  queryText,
}: Omit<LoadMentionChatMemoryStoreOptions, "store">): MentionChatMemoryResult {
  if (!enabled || !sqlitePath.trim() || maxItems <= 0 || maxChars <= 0) {
    return { ...EMPTY_MEMORY };
  }

  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return { ...EMPTY_MEMORY };

    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, () =>
      new Date().toISOString()
    );
    const rows = db
      .prepare(
        `
        SELECT key, value, kind, status, source_user, created_at, updated_at,
               confidence, observed_count, promoted_at, last_observed_at
        FROM mention_chat_memory
        WHERE status = 'active'
        ORDER BY rowid ASC
      `
      )
      .all() as unknown as SqliteMemoryRow[];
    const ranked = rankMemoryLines(sqliteRowsToMemoryLines(rows), queryText);
    const capped = capLines(
      ranked.map((line) => line.line),
      maxItems,
      maxChars
    );
    const text = capped.join("\n");

    return {
      text: text || null,
      itemCount: capped.length,
      charCount: text.length,
    };
  } catch {
    return { ...EMPTY_MEMORY };
  } finally {
    db?.close();
  }
}

function capSqliteMemoryRows(
  db: DatabaseSync,
  maxItems: number,
  keepKey: string
): void {
  if (maxItems <= 0) return;

  let keys = db
    .prepare(
      `
      SELECT key
      FROM mention_chat_memory
      ORDER BY updated_at ASC, key ASC
    `
    )
    .all()
    .map((row) => (row as { key: string }).key);

  const deleteStatement = db.prepare(
    "DELETE FROM mention_chat_memory WHERE key = ?"
  );
  while (keys.length > maxItems) {
    const deleteKey = keys.find((key) => key !== keepKey) ?? keys[0];
    deleteStatement.run(deleteKey);
    keys = keys.filter((key) => key !== deleteKey);
  }
}

function saveMemoryEntrySqlite({
  sqlitePath,
  jsonPath,
  entry,
  maxItems,
  sourceUser,
  kind,
  now,
}: {
  sqlitePath: string;
  jsonPath: string;
  entry: MentionChatMemoryEntry;
  maxItems: number;
  sourceUser?: string;
  kind: "semantic" | "implicit";
  now: () => string;
}): SaveMentionChatAutoLearnMemoryResult {
  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return { saved: false, reason: "invalid_file" };

    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, now);
    const timestamp = now();
    const existing = db
      .prepare(
        "SELECT created_at FROM mention_chat_memory WHERE key = ? LIMIT 1"
      )
      .get(entry.key) as { created_at: string } | undefined;
    db.exec("BEGIN");
    try {
      insertSqliteMemoryRow(db, {
        key: entry.key,
        value: entry.value,
        kind,
        status: "active",
        sourceUser: singleLine(sourceUser ?? "") || "unknown",
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      });
      capSqliteMemoryRows(db, maxItems, entry.key);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { saved: true, reason: "saved", key: entry.key };
  } catch {
    return { saved: false, reason: "write_failed" };
  } finally {
    db?.close();
  }
}

function saveMemoryEntry({
  filePath,
  entry,
  maxItems,
  sourceUser,
  kind,
  now,
}: {
  filePath: string;
  entry: MentionChatMemoryEntry;
  maxItems: number;
  sourceUser?: string;
  kind: "semantic" | "implicit";
  now: () => string;
}): SaveMentionChatAutoLearnMemoryResult {
  const record = loadWritableMemoryRecord(filePath);
  if (!record) return { saved: false, reason: "invalid_file" };

  const timestamp = now();
  const meta = metadataRecord(record);
  const existingMeta = meta[entry.key];
  record[entry.key] = entry.value;
  meta[entry.key] = {
    kind,
    status: "active",
    sourceUser: singleLine(sourceUser ?? "") || "unknown",
    createdAt: existingMeta?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  record[MEMORY_META_KEY] = meta;
  capMemoryRecord(record, maxItems, entry.key);
  writeMemoryRecordAtomically(filePath, record);
  return { saved: true, reason: "saved", key: entry.key };
}

export function saveMentionChatAutoLearnMemory({
  enabled,
  filePath,
  promptText,
  maxKeyChars,
  maxValueChars,
  maxItems,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatAutoLearnMemoryOptions): SaveMentionChatAutoLearnMemoryResult {
  if (!enabled || !filePath.trim()) return { saved: false, reason: "disabled" };

  const analysis = analyzeMentionChatMemoryRequest(promptText, {
    maxKeyChars,
    maxValueChars,
    sourceUser,
  });
  if (analysis.reason !== "valid" || !analysis.entry) {
    const reason: SaveMentionChatAutoLearnMemoryFailureReason =
      analysis.reason === "valid" ? "invalid_format" : analysis.reason;
    return { saved: false, reason };
  }

  try {
    return saveMemoryEntry({
      filePath,
      entry: analysis.entry,
      maxItems,
      sourceUser,
      kind: "semantic",
      now,
    });
  } catch {
    return { saved: false, reason: "write_failed" };
  }
}

export function saveMentionChatAutoLearnMemoryStore({
  store,
  jsonPath,
  sqlitePath,
  enabled,
  promptText,
  maxKeyChars,
  maxValueChars,
  maxItems,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatAutoLearnMemoryStoreOptions): SaveMentionChatAutoLearnMemoryResult {
  if (store === "json") {
    return saveMentionChatAutoLearnMemory({
      enabled,
      filePath: jsonPath,
      promptText,
      maxKeyChars,
      maxValueChars,
      maxItems,
      sourceUser,
      now,
    });
  }
  if (!enabled || !sqlitePath.trim()) return { saved: false, reason: "disabled" };

  const analysis = analyzeMentionChatMemoryRequest(promptText, {
    maxKeyChars,
    maxValueChars,
    sourceUser,
  });
  if (analysis.reason !== "valid" || !analysis.entry) {
    const reason: SaveMentionChatAutoLearnMemoryFailureReason =
      analysis.reason === "valid" ? "invalid_format" : analysis.reason;
    return { saved: false, reason };
  }

  return saveMemoryEntrySqlite({
    sqlitePath,
    jsonPath,
    entry: analysis.entry,
    maxItems,
    sourceUser,
    kind: "semantic",
    now,
  });
}

export function saveMentionChatImplicitMemory({
  enabled,
  filePath,
  promptText,
  maxKeyChars,
  maxValueChars,
  maxItems,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatImplicitMemoryOptions): SaveMentionChatAutoLearnMemoryResult {
  if (!enabled || !filePath.trim()) return { saved: false, reason: "disabled" };

  const entry = extractImplicitMentionChatMemoryEntry(promptText, {
    maxKeyChars,
    maxValueChars,
    sourceUser,
  });
  if (!entry) return { saved: false, reason: "not_memory_request" };

  try {
    return saveMemoryEntry({
      filePath,
      entry,
      maxItems,
      sourceUser,
      kind: "implicit",
      now,
    });
  } catch {
    return { saved: false, reason: "write_failed" };
  }
}

export function saveMentionChatImplicitMemoryStore({
  store,
  jsonPath,
  sqlitePath,
  enabled,
  promptText,
  maxKeyChars,
  maxValueChars,
  maxItems,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatImplicitMemoryStoreOptions): SaveMentionChatAutoLearnMemoryResult {
  if (store === "json") {
    return saveMentionChatImplicitMemory({
      enabled,
      filePath: jsonPath,
      promptText,
      maxKeyChars,
      maxValueChars,
      maxItems,
      sourceUser,
      now,
    });
  }
  if (!enabled || !sqlitePath.trim()) return { saved: false, reason: "disabled" };

  const entry = extractImplicitMentionChatMemoryEntry(promptText, {
    maxKeyChars,
    maxValueChars,
    sourceUser,
  });
  if (!entry) return { saved: false, reason: "not_memory_request" };

  return saveMemoryEntrySqlite({
    sqlitePath,
    jsonPath,
    entry,
    maxItems,
    sourceUser,
    kind: "implicit",
    now,
  });
}

export function saveMentionChatMemoryEntryStore({
  enabled,
  store,
  jsonPath,
  sqlitePath,
  entry,
  kind,
  maxItems,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatMemoryEntryStoreOptions): SaveMentionChatAutoLearnMemoryResult {
  if (!enabled) return { saved: false, reason: "disabled" };

  const cleaned = cleanAdminMemoryEntry({
    key: entry.key,
    value: entry.value,
  });
  if ("reason" in cleaned) {
    return { saved: false, reason: cleaned.reason };
  }

  if (store === "json") {
    if (!jsonPath.trim()) return { saved: false, reason: "disabled" };
    try {
      return saveMemoryEntry({
        filePath: jsonPath,
        entry: cleaned.entry,
        maxItems,
        sourceUser,
        kind,
        now,
      });
    } catch {
      return { saved: false, reason: "write_failed" };
    }
  }

  if (!sqlitePath.trim()) return { saved: false, reason: "disabled" };
  return saveMemoryEntrySqlite({
    sqlitePath,
    jsonPath,
    entry: cleaned.entry,
    maxItems,
    sourceUser,
    kind,
    now,
  });
}

function normalizePromotionMinObservations(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function observationConfidence(
  observedCount: number,
  promotionMinObservations: number
): number {
  if (observedCount >= promotionMinObservations) return 100;
  return Math.min(90, 40 + observedCount * 20);
}

function observationResult({
  saved,
  reason,
  key,
  status,
  observedCount,
}: {
  saved: boolean;
  reason: SaveMentionChatMemoryObservationStoreResult["reason"];
  key?: string;
  status?: MentionChatMemoryEntryStatus;
  observedCount?: number;
}): SaveMentionChatMemoryObservationStoreResult {
  return {
    saved,
    reason,
    key,
    status,
    observedCount,
    promoted: reason === "promoted",
  };
}

function saveJsonMemoryObservation({
  jsonPath,
  entry,
  kind,
  maxItems,
  promotionMinObservations,
  sourceUser,
  now,
}: {
  jsonPath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  maxItems: number;
  promotionMinObservations: number;
  sourceUser?: string;
  now: () => string;
}): SaveMentionChatMemoryObservationStoreResult {
  try {
    const record = loadWritableMemoryRecord(jsonPath);
    if (!record) return observationResult({ saved: false, reason: "invalid_file" });

    const timestamp = now();
    const meta = metadataRecord(record);
    const existingValue = dictionaryValueToText(record[entry.key]);
    const existingMeta = meta[entry.key];
    const existingStatus = normalizeMemoryStatus(existingMeta?.status);
    const existingObservedCount = Math.max(
      1,
      Math.floor(existingMeta?.observedCount ?? 1)
    );

    if (existingStatus === "active" && existingValue) {
      if (existingValue !== entry.value) {
        return observationResult({
          saved: false,
          reason: "conflict",
          key: entry.key,
          status: "active",
          observedCount: existingObservedCount,
        });
      }

      const observedCount = existingObservedCount + 1;
      meta[entry.key] = {
        ...existingMeta,
        kind,
        status: "active",
        sourceUser: singleLine(sourceUser ?? "") || existingMeta?.sourceUser || "unknown",
        createdAt: existingMeta?.createdAt || timestamp,
        updatedAt: timestamp,
        confidence: 100,
        observedCount,
        promotedAt: existingMeta?.promotedAt || existingMeta?.createdAt || timestamp,
        lastObservedAt: timestamp,
      };
      record[MEMORY_META_KEY] = meta;
      writeMemoryRecordAtomically(jsonPath, record);
      return observationResult({
        saved: true,
        reason: "already_active",
        key: entry.key,
        status: "active",
        observedCount,
      });
    }

    const sameCandidate =
      existingStatus === "candidate" && existingValue === entry.value;
    const observedCount = sameCandidate ? existingObservedCount + 1 : 1;
    const promoted = observedCount >= promotionMinObservations;
    const status: MentionChatMemoryEntryStatus = promoted ? "active" : "candidate";
    record[entry.key] = entry.value;
    meta[entry.key] = {
      kind,
      status,
      sourceUser: singleLine(sourceUser ?? "") || "unknown",
      createdAt: existingMeta?.createdAt || timestamp,
      updatedAt: timestamp,
      confidence: observationConfidence(observedCount, promotionMinObservations),
      observedCount,
      promotedAt: promoted ? timestamp : "",
      lastObservedAt: timestamp,
    };
    record[MEMORY_META_KEY] = meta;
    capMemoryRecord(record, maxItems, entry.key);
    writeMemoryRecordAtomically(jsonPath, record);
    return observationResult({
      saved: true,
      reason: promoted ? "promoted" : "observed",
      key: entry.key,
      status,
      observedCount,
    });
  } catch {
    return observationResult({ saved: false, reason: "write_failed" });
  }
}

function loadSqliteMemoryRow(
  db: DatabaseSync,
  key: string
): SqliteMemoryRow | undefined {
  return db
    .prepare(
      `
      SELECT key, value, kind, status, source_user, created_at, updated_at,
             confidence, observed_count, promoted_at, last_observed_at
      FROM mention_chat_memory
      WHERE key = ?
      LIMIT 1
    `
    )
    .get(key) as unknown as SqliteMemoryRow | undefined;
}

function saveSqliteMemoryObservation({
  sqlitePath,
  jsonPath,
  entry,
  kind,
  maxItems,
  promotionMinObservations,
  sourceUser,
  now,
}: {
  sqlitePath: string;
  jsonPath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  maxItems: number;
  promotionMinObservations: number;
  sourceUser?: string;
  now: () => string;
}): SaveMentionChatMemoryObservationStoreResult {
  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return observationResult({ saved: false, reason: "invalid_file" });

    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, now);
    const timestamp = now();
    const existing = loadSqliteMemoryRow(db, entry.key);
    const existingStatus = normalizeMemoryStatus(existing?.status);
    const existingObservedCount = Math.max(
      1,
      Math.floor(existing?.observed_count ?? 1)
    );

    if (existingStatus === "active" && existing?.value) {
      if (existing.value !== entry.value) {
        return observationResult({
          saved: false,
          reason: "conflict",
          key: entry.key,
          status: "active",
          observedCount: existingObservedCount,
        });
      }

      const observedCount = existingObservedCount + 1;
      insertSqliteMemoryRow(db, {
        key: entry.key,
        value: entry.value,
        kind,
        status: "active",
        sourceUser: singleLine(sourceUser ?? "") || existing.source_user || "unknown",
        createdAt: existing.created_at || timestamp,
        updatedAt: timestamp,
        confidence: 100,
        observedCount,
        promotedAt: existing.promoted_at || existing.created_at || timestamp,
        lastObservedAt: timestamp,
      });
      return observationResult({
        saved: true,
        reason: "already_active",
        key: entry.key,
        status: "active",
        observedCount,
      });
    }

    const sameCandidate =
      existingStatus === "candidate" && existing?.value === entry.value;
    const observedCount = sameCandidate ? existingObservedCount + 1 : 1;
    const promoted = observedCount >= promotionMinObservations;
    const status: MentionChatMemoryEntryStatus = promoted ? "active" : "candidate";
    db.exec("BEGIN");
    try {
      insertSqliteMemoryRow(db, {
        key: entry.key,
        value: entry.value,
        kind,
        status,
        sourceUser: singleLine(sourceUser ?? "") || "unknown",
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
        confidence: observationConfidence(observedCount, promotionMinObservations),
        observedCount,
        promotedAt: promoted ? timestamp : "",
        lastObservedAt: timestamp,
      });
      capSqliteMemoryRows(db, maxItems, entry.key);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return observationResult({
      saved: true,
      reason: promoted ? "promoted" : "observed",
      key: entry.key,
      status,
      observedCount,
    });
  } catch {
    return observationResult({ saved: false, reason: "write_failed" });
  } finally {
    db?.close();
  }
}

export function saveMentionChatMemoryObservationStore({
  enabled,
  store,
  jsonPath,
  sqlitePath,
  entry,
  kind,
  maxItems,
  promotionMinObservations,
  sourceUser,
  now = () => new Date().toISOString(),
}: SaveMentionChatMemoryObservationStoreOptions): SaveMentionChatMemoryObservationStoreResult {
  if (!enabled) return observationResult({ saved: false, reason: "disabled" });

  const cleaned = cleanAdminMemoryEntry({
    key: entry.key,
    value: entry.value,
  });
  if ("reason" in cleaned) {
    return observationResult({ saved: false, reason: cleaned.reason });
  }

  const minObservations = normalizePromotionMinObservations(
    promotionMinObservations
  );
  if (store === "json") {
    if (!jsonPath.trim()) {
      return observationResult({ saved: false, reason: "disabled" });
    }
    return saveJsonMemoryObservation({
      jsonPath,
      entry: cleaned.entry,
      kind,
      maxItems,
      promotionMinObservations: minObservations,
      sourceUser,
      now,
    });
  }

  if (!sqlitePath.trim()) {
    return observationResult({ saved: false, reason: "disabled" });
  }
  return saveSqliteMemoryObservation({
    sqlitePath,
    jsonPath,
    entry: cleaned.entry,
    kind,
    maxItems,
    promotionMinObservations: minObservations,
    sourceUser,
    now,
  });
}

function listJsonMemoryAdminEntries(
  jsonPath: string
): MentionChatMemoryAdminEntry[] {
  const record = loadWritableMemoryRecord(jsonPath);
  if (!record) return [];

  const meta = metadataRecord(record);
  const entries: MentionChatMemoryAdminEntry[] = [];
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = singleLine(rawKey);
    if (!key || RESERVED_MEMORY_KEYS.has(key)) continue;
    const value = dictionaryValueToText(rawValue);
    if (!value || isUnsafeMemoryKey(key) || isUnsafeMemoryText(value)) continue;
    const entryMeta = meta[key];
    const status = normalizeMemoryStatus(entryMeta?.status);
    const observedCount = Math.max(1, Math.floor(entryMeta?.observedCount ?? 1));
    const entry: MentionChatMemoryAdminEntry = {
      key,
      value,
      kind: normalizeMemoryKind(entryMeta?.kind),
      status,
      sourceUser: singleLine(entryMeta?.sourceUser ?? "") || "unknown",
      createdAt: entryMeta?.createdAt ?? "",
      updatedAt: entryMeta?.updatedAt ?? "",
    };
    if (status === "candidate" || observedCount > 1) {
      entry.observedCount = observedCount;
      entry.confidence = Math.max(
        0,
        Math.min(100, Math.floor(entryMeta?.confidence ?? 50))
      );
      entry.lastObservedAt = entryMeta?.lastObservedAt ?? "";
    }
    if (entryMeta?.promotedAt) entry.promotedAt = entryMeta.promotedAt;
    entries.push(entry);
  }
  return entries.sort(compareAdminEntries);
}

function listSqliteMemoryAdminEntries({
  sqlitePath,
  jsonPath,
}: {
  sqlitePath: string;
  jsonPath: string;
}): MentionChatMemoryAdminEntry[] {
  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return [];
    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, () =>
      new Date().toISOString()
    );
    const rows = db
      .prepare(
        `
        SELECT key, value, kind, status, source_user, created_at, updated_at,
               confidence, observed_count, promoted_at, last_observed_at
        FROM mention_chat_memory
      `
      )
      .all() as unknown as SqliteMemoryRow[];
    return rows
      .map(rowToAdminEntry)
      .filter(
        (entry) =>
          !RESERVED_MEMORY_KEYS.has(entry.key) &&
          !isUnsafeMemoryKey(entry.key) &&
          !isUnsafeMemoryText(entry.value)
      )
      .sort(compareAdminEntries);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export function listMentionChatMemoryEntriesStore({
  store,
  jsonPath,
  sqlitePath,
  status,
  queryText,
  limit,
}: ListMentionChatMemoryEntriesStoreOptions): ListMentionChatMemoryEntriesResult {
  const listStatus = normalizeListStatus(status);
  const cappedLimit = normalizeListLimit(limit);
  const allEntries =
    store === "json"
      ? listJsonMemoryAdminEntries(jsonPath)
      : listSqliteMemoryAdminEntries({ sqlitePath, jsonPath });
  const entries = allEntries
    .filter((entry) => listStatus === "all" || entry.status === listStatus)
    .filter((entry) => adminEntryMatchesQuery(entry, queryText))
    .slice(0, cappedLimit);

  return {
    entries,
    totalCount: allEntries.length,
    activeCount: allEntries.filter((entry) => entry.status === "active").length,
  };
}

function upsertJsonMemoryAdminEntry({
  jsonPath,
  entry,
  kind,
  status,
  sourceUser,
  maxItems,
  now,
}: {
  jsonPath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  status: MentionChatMemoryEntryStatus;
  sourceUser?: string;
  maxItems: number;
  now: () => string;
}): SaveMentionChatAutoLearnMemoryResult {
  try {
    const record = loadWritableMemoryRecord(jsonPath);
    if (!record) return { saved: false, reason: "invalid_file" };
    const timestamp = now();
    const meta = metadataRecord(record);
    const existingMeta = meta[entry.key];
    record[entry.key] = entry.value;
    meta[entry.key] = {
      kind,
      status,
      sourceUser: singleLine(sourceUser ?? "") || "admin",
      createdAt: existingMeta?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    record[MEMORY_META_KEY] = meta;
    capMemoryRecord(record, maxItems, entry.key);
    writeMemoryRecordAtomically(jsonPath, record);
    return { saved: true, reason: "saved", key: entry.key };
  } catch {
    return { saved: false, reason: "write_failed" };
  }
}

function upsertSqliteMemoryAdminEntry({
  sqlitePath,
  jsonPath,
  entry,
  kind,
  status,
  sourceUser,
  maxItems,
  now,
}: {
  sqlitePath: string;
  jsonPath: string;
  entry: MentionChatMemoryEntry;
  kind: MentionChatMemoryEntryKind;
  status: MentionChatMemoryEntryStatus;
  sourceUser?: string;
  maxItems: number;
  now: () => string;
}): SaveMentionChatAutoLearnMemoryResult {
  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return { saved: false, reason: "invalid_file" };

    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, now);
    const timestamp = now();
    const existing = db
      .prepare(
        "SELECT created_at FROM mention_chat_memory WHERE key = ? LIMIT 1"
      )
      .get(entry.key) as { created_at: string } | undefined;
    db.exec("BEGIN");
    try {
      insertSqliteMemoryRow(db, {
        key: entry.key,
        value: entry.value,
        kind,
        status,
        sourceUser: singleLine(sourceUser ?? "") || "admin",
        createdAt: existing?.created_at || timestamp,
        updatedAt: timestamp,
      });
      capSqliteMemoryRows(db, maxItems, entry.key);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { saved: true, reason: "saved", key: entry.key };
  } catch {
    return { saved: false, reason: "write_failed" };
  } finally {
    db?.close();
  }
}

export function upsertMentionChatMemoryEntryStore({
  store,
  jsonPath,
  sqlitePath,
  key,
  value,
  kind,
  status,
  sourceUser,
  maxItems,
  maxKeyChars,
  maxValueChars,
  now = () => new Date().toISOString(),
}: UpsertMentionChatMemoryEntryStoreOptions): SaveMentionChatAutoLearnMemoryResult {
  const cleaned = cleanAdminMemoryEntry({
    key,
    value,
    maxKeyChars,
    maxValueChars,
  });
  if ("reason" in cleaned) return { saved: false, reason: cleaned.reason };

  const normalizedKind = normalizeAdminEntryKind(kind);
  const normalizedStatus = normalizeAdminEntryStatus(status);
  if (store === "json") {
    return upsertJsonMemoryAdminEntry({
      jsonPath,
      entry: cleaned.entry,
      kind: normalizedKind,
      status: normalizedStatus,
      sourceUser,
      maxItems,
      now,
    });
  }

  return upsertSqliteMemoryAdminEntry({
    sqlitePath,
    jsonPath,
    entry: cleaned.entry,
    kind: normalizedKind,
    status: normalizedStatus,
    sourceUser,
    maxItems,
    now,
  });
}

function deleteJsonMemoryAdminEntry({
  jsonPath,
  key,
}: {
  jsonPath: string;
  key: string;
}): DeleteMentionChatMemoryEntryResult {
  try {
    const record = loadWritableMemoryRecord(jsonPath);
    if (!record) return { deleted: false, reason: "invalid_file" };
    const cleanKey = singleLine(key);
    if (!cleanKey || !Object.prototype.hasOwnProperty.call(record, cleanKey)) {
      return { deleted: false, reason: "not_found" };
    }
    const meta = metadataRecord(record);
    delete record[cleanKey];
    delete meta[cleanKey];
    if (Object.keys(meta).length > 0) {
      record[MEMORY_META_KEY] = meta;
    } else {
      delete record[MEMORY_META_KEY];
    }
    writeMemoryRecordAtomically(jsonPath, record);
    return { deleted: true, reason: "deleted", key: cleanKey };
  } catch {
    return { deleted: false, reason: "write_failed" };
  }
}

function deleteSqliteMemoryAdminEntry({
  sqlitePath,
  jsonPath,
  key,
}: {
  sqlitePath: string;
  jsonPath: string;
  key: string;
}): DeleteMentionChatMemoryEntryResult {
  let db: DatabaseSync | null = null;
  try {
    db = openMemoryDatabase(sqlitePath);
    if (!db) return { deleted: false, reason: "invalid_file" };
    importJsonMemoryIntoSqliteIfEmpty(db, jsonPath, () =>
      new Date().toISOString()
    );
    const cleanKey = singleLine(key);
    if (!cleanKey) return { deleted: false, reason: "not_found" };
    const result = db
      .prepare("DELETE FROM mention_chat_memory WHERE key = ?")
      .run(cleanKey) as unknown as { changes: number };
    if (result.changes <= 0) return { deleted: false, reason: "not_found" };
    return { deleted: true, reason: "deleted", key: cleanKey };
  } catch {
    return { deleted: false, reason: "write_failed" };
  } finally {
    db?.close();
  }
}

export function deleteMentionChatMemoryEntryStore({
  store,
  jsonPath,
  sqlitePath,
  key,
}: DeleteMentionChatMemoryEntryStoreOptions): DeleteMentionChatMemoryEntryResult {
  if (store === "json") {
    return deleteJsonMemoryAdminEntry({ jsonPath, key });
  }
  return deleteSqliteMemoryAdminEntry({ sqlitePath, jsonPath, key });
}

export function loadMentionChatMemory({
  enabled,
  filePath,
  maxItems,
  maxChars,
  queryText,
}: LoadMentionChatMemoryOptions): MentionChatMemoryResult {
  if (!enabled || !filePath.trim() || maxItems <= 0 || maxChars <= 0) {
    return { ...EMPTY_MEMORY };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { ...EMPTY_MEMORY };

    const dictionaryLines = dictionaryEntriesToMemoryLines(parsed);
    const lines = [
      ...dictionaryLines,
      ...legacyGlobalItemsToMemoryLines(
        asArray(parsed["global"]),
        dictionaryLines.length
      ),
    ];
    const ranked = rankMemoryLines(lines, queryText);
    const capped = capLines(
      ranked.map((line) => line.line),
      maxItems,
      maxChars
    );
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

export function loadMentionChatMemoryStore({
  store,
  jsonPath,
  sqlitePath,
  enabled,
  maxItems,
  maxChars,
  queryText,
}: LoadMentionChatMemoryStoreOptions): MentionChatMemoryResult {
  if (store === "json") {
    return loadMentionChatMemory({
      enabled,
      filePath: jsonPath,
      maxItems,
      maxChars,
      queryText,
    });
  }

  return loadMentionChatMemorySqlite({
    enabled,
    jsonPath,
    sqlitePath,
    maxItems,
    maxChars,
    queryText,
  });
}

function normalizedSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function asciiTerms(value: string): string[] {
  return normalizedSearchText(value).match(/[a-z0-9_+-]{2,}/gu) ?? [];
}

function queryMemoryTopics(queryText: string): Set<MemoryTopic> {
  const query = normalizedSearchText(queryText);
  const topics = new Set<MemoryTopic>();

  if (/(?:何歳|何才|年齢|いくつ|歳|才)/u.test(query)) {
    topics.add("age");
  }
  if (/(?:誕生日|生年月日|生まれ|何年生まれ|いつ生まれ)/u.test(query)) {
    topics.add("birthdate");
  }
  if (
    /(?:どこ|何県|どちら).{0,12}(?:住|すん|居住|在住|出身)|(?:住んで|すんで|住まい|居住|在住|住所|所在地|出身)/u.test(
      query
    )
  ) {
    topics.add("residence");
  }

  return topics;
}

function memoryLineTopics(line: MemoryLine): Set<MemoryTopic> {
  const text = normalizedSearchText(`${line.key} ${line.value}`);
  const topics = new Set<MemoryTopic>();

  if (/(?:\d+|[0-9０-９]+)\s*(?:歳|才)/u.test(text)) {
    topics.add("age");
  }
  if (
    /(?:誕生日|生年月日|生まれ|平成|昭和|令和|西暦|\d{4}年|[0-9０-９]+月[0-9０-９]+日)/u.test(
      text
    )
  ) {
    topics.add("birthdate");
  }
  if (
    /(?:住んで|すんで|住まい|居住|在住|住所|所在地|出身|都|道|府|県|市|区|町|村)/u.test(
      text
    )
  ) {
    topics.add("residence");
  }

  return topics;
}

function memoryLineMatchesQueryTopics(line: MemoryLine, queryText: string): boolean {
  const queryTopics = queryMemoryTopics(queryText);
  if (queryTopics.size === 0) return true;

  const lineTopics = memoryLineTopics(line);
  if (queryTopics.has("age") && (lineTopics.has("age") || lineTopics.has("birthdate"))) {
    return true;
  }
  if (queryTopics.has("birthdate") && lineTopics.has("birthdate")) {
    return true;
  }
  if (queryTopics.has("residence") && lineTopics.has("residence")) {
    return true;
  }

  return false;
}

function relevanceScore(line: MemoryLine, queryText: string): number {
  const query = normalizedSearchText(queryText);
  const key = normalizedSearchText(line.key);
  const value = normalizedSearchText(line.value);
  const queryTopics = queryMemoryTopics(queryText);
  const lineTopics = memoryLineTopics(line);
  let score = 0;

  if (key && query.includes(key)) score += 100;
  if (value && query.includes(value)) score += 30;

  for (const term of asciiTerms(query)) {
    if (key.includes(term)) score += 20;
    if (value.includes(term)) score += 8;
  }

  if (queryTopics.has("age") && (lineTopics.has("age") || lineTopics.has("birthdate"))) {
    score += 20;
  }
  if (queryTopics.has("birthdate") && lineTopics.has("birthdate")) score += 20;
  if (queryTopics.has("residence") && lineTopics.has("residence")) score += 20;

  return score;
}

function rankMemoryLines(lines: MemoryLine[], queryText: string | undefined): MemoryLine[] {
  const query = queryText?.trim();
  if (!query) return lines;

  const candidates = lines.filter((line) =>
    memoryLineMatchesQueryTopics(line, query)
  );

  return [...candidates].sort((a, b) => {
    const scoreDiff = relevanceScore(b, query) - relevanceScore(a, query);
    if (scoreDiff !== 0) return scoreDiff;
    const timeDiff = b.updatedAt - a.updatedAt;
    if (timeDiff !== 0) return timeDiff;
    return a.index - b.index;
  });
}
