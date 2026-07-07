import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export type BotRequestNoteStatus =
  | "pending"
  | "planned"
  | "done"
  | "rejected"
  | "duplicate";

export type BotRequestNoteListStatus = BotRequestNoteStatus | "open" | "all";

export type BotRequestNoteCategory =
  | "feature"
  | "bug"
  | "command"
  | "reply_quality";

export interface BotRequestNoteEntry {
  category: BotRequestNoteCategory;
  summary: string;
  evidence: string;
  sourceUser: string;
}

export interface ExtractBotRequestNoteOptions {
  sourceUser?: string;
  maxSummaryChars?: number;
  maxEvidenceChars?: number;
}

export interface BotRequestNote {
  id: number;
  status: BotRequestNoteStatus;
  category: BotRequestNoteCategory;
  summary: string;
  evidence: string;
  sourceUser: string;
  observedCount: number;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  resolvedAt: string;
  operatorNote: string;
}

export interface SaveBotRequestNoteObservationStoreOptions {
  enabled: boolean;
  dbPath: string;
  entry: BotRequestNoteEntry;
  now?: () => string;
}

export interface SaveBotRequestNoteObservationStoreResult {
  saved: boolean;
  reason: "disabled" | "invalid_format" | "write_failed" | "saved" | "updated";
  note?: BotRequestNote;
}

export interface ListBotRequestNotesStoreOptions {
  dbPath: string;
  status?: BotRequestNoteListStatus;
  queryText?: string;
  limit?: number;
}

export interface ListBotRequestNotesStoreResult {
  entries: BotRequestNote[];
  totalCount: number;
  openCount: number;
}

export interface UpdateBotRequestNoteStoreOptions {
  dbPath: string;
  id: number;
  status: BotRequestNoteStatus;
  operatorNote?: string;
  now?: () => string;
}

export interface UpdateBotRequestNoteStoreResult {
  updated: boolean;
  reason: "updated" | "not_found" | "invalid_status" | "write_failed";
  note?: BotRequestNote;
}

export interface BuildBotRequestNotesDigestOptions {
  enabled: boolean;
  dbPath: string;
  intervalHours: number;
  maxItems: number;
  now?: () => string;
}

export interface BuildBotRequestNotesDigestResult {
  shouldSend: boolean;
  reason: "disabled" | "empty" | "interval" | "ready" | "invalid_file";
  itemCount: number;
  message?: string;
  entries: BotRequestNote[];
}

export interface MarkBotRequestNotesDigestSentOptions {
  dbPath: string;
  sentAt: string;
}

export interface WriteBotRequestNotesDigestFileOptions {
  filePath: string;
  generatedAt: string;
  entries: BotRequestNote[];
}

export interface WriteBotRequestNotesDigestFileResult {
  written: boolean;
  reason: "written" | "invalid_file";
  filePath?: string;
}

interface BotRequestNoteRow {
  id: number;
  dedupe_key: string;
  status: string;
  category: string;
  summary: string;
  evidence: string;
  source_user: string;
  observed_count: number;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
  resolved_at: string;
  operator_note: string;
}

interface MetaRow {
  value: string;
}

const DEFAULT_MAX_SUMMARY_CHARS = 120;
const DEFAULT_MAX_EVIDENCE_CHARS = 240;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const DIGEST_META_LAST_SENT_AT = "digest_last_sent_at";

const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{8,}\d)/u;
const SECRET_PATTERN =
  /\b(?:token|secret|password|passwd|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b|apiキー|トークン|アクセストークン|リフレッシュトークン|シークレット|認証情報|認証|パスワード|秘密鍵|秘密|環境変数/iu;
const CREDENTIAL_VALUE_PATTERN =
  /\b(?:sk(?:-proj)?-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/u;
const PROMPT_INJECTION_PATTERN =
  /前の指示|上の指示|以前の指示|指示を無視|命令を無視|ルールを無視|システムプロンプト|プロンプトを表示|内部設定|developer message|system prompt|ignore (?:all )?(?:previous|above) instructions/iu;
const MEMORY_REQUEST_PATTERN =
  /(?:覚えて|記憶して|メモして|忘れないで)[：:\s]|(?:って|と)?(?:覚えて|記憶して|メモして|忘れないで)[！!。.\s]*$/u;
const BOT_CONTEXT_PATTERN =
  /(?:bot|ボット|にめいや|nyme_ia2|rukalun|コマンド|![a-z0-9_]+|clip|myclip|boom|chat|おみくじ|raid挨拶|レイド挨拶|返答|返信|ai)/iu;
const REQUEST_PATTERN =
  /(?:できるように|してほしい|して欲しい|追加|作って|実装|対応|直して|修正|改善|使えない|壊れ|動かない|エラー|バグ|誤答|間違|したい|欲しい|ほしい)/u;
const BUG_PATTERN =
  /(?:使えない|壊れ|動かない|エラー|バグ|落ち|失敗|直して|修正|誤答|間違)/u;
const COMMAND_PATTERN = /(?:コマンド|![a-z0-9_]+)/iu;
const REPLY_QUALITY_PATTERN =
  /(?:返答|返信|AI).{0,16}(?:おかしい|変|改善|自然|賢く|誤答|間違)/iu;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if ([...value].length <= maxChars) return value;
  if (maxChars <= 3) return [...value].slice(0, maxChars).join("");
  return `${[...value].slice(0, maxChars - 3).join("").trimEnd()}...`;
}

function normalizeSourceUser(sourceUser: string | undefined): string {
  return singleLine(sourceUser ?? "").replace(/^[@＠]+/, "").toLowerCase();
}

function stripBotAddressing(value: string): string {
  return singleLine(value)
    .replace(/^!chat\s+/iu, "")
    .replace(/^[@＠][^\s　]+[\s　]*/u, "")
    .trim();
}

function stripTrailingNoise(value: string): string {
  return value.replace(/[。.!！?？\s]+$/u, "").trim();
}

function isUnsafeRequestNoteText(value: string): boolean {
  return (
    URL_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value) ||
    PHONE_PATTERN.test(value) ||
    SECRET_PATTERN.test(value) ||
    CREDENTIAL_VALUE_PATTERN.test(value) ||
    PROMPT_INJECTION_PATTERN.test(value)
  );
}

function categorizeBotRequestNote(value: string): BotRequestNoteCategory {
  if (BUG_PATTERN.test(value)) return "bug";
  if (COMMAND_PATTERN.test(value)) return "command";
  if (REPLY_QUALITY_PATTERN.test(value)) return "reply_quality";
  return "feature";
}

function normalizeDedupeKey(entry: BotRequestNoteEntry): string {
  const summary = entry.summary
    .toLowerCase()
    .replace(/[。、.!！?？"'`「」『』（）()[\]\s　]+/gu, "");
  return `${entry.category}:${summary}`;
}

function normalizeStatus(status: string | undefined): BotRequestNoteStatus {
  if (
    status === "planned" ||
    status === "done" ||
    status === "rejected" ||
    status === "duplicate"
  ) {
    return status;
  }
  return "pending";
}

function isOpenStatus(status: BotRequestNoteStatus): boolean {
  return status === "pending" || status === "planned";
}

function normalizeListStatus(
  status: BotRequestNoteListStatus | undefined
): BotRequestNoteListStatus {
  if (
    status === "pending" ||
    status === "planned" ||
    status === "done" ||
    status === "rejected" ||
    status === "duplicate" ||
    status === "open"
  ) {
    return status;
  }
  return "all";
}

function normalizeListLimit(limit: number | undefined): number {
  const parsed = Math.floor(limit ?? DEFAULT_LIST_LIMIT);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

function rowToNote(row: BotRequestNoteRow): BotRequestNote {
  return {
    id: row.id,
    status: normalizeStatus(row.status),
    category: normalizeCategory(row.category),
    summary: row.summary,
    evidence: row.evidence,
    sourceUser: row.source_user,
    observedCount: Math.max(1, Math.floor(row.observed_count ?? 1)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastObservedAt: row.last_observed_at,
    resolvedAt: row.resolved_at,
    operatorNote: row.operator_note,
  };
}

function normalizeCategory(category: string): BotRequestNoteCategory {
  if (
    category === "bug" ||
    category === "command" ||
    category === "reply_quality"
  ) {
    return category;
  }
  return "feature";
}

function compareNotes(a: BotRequestNote, b: BotRequestNote): number {
  const statusRank = (status: BotRequestNoteStatus) =>
    status === "pending" ? 0 : status === "planned" ? 1 : 2;
  const rankDiff = statusRank(a.status) - statusRank(b.status);
  if (rankDiff !== 0) return rankDiff;
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function noteMatchesQuery(note: BotRequestNote, queryText: string | undefined): boolean {
  const query = singleLine(queryText ?? "").toLowerCase();
  if (!query) return true;
  const haystack = [
    note.summary,
    note.evidence,
    note.sourceUser,
    note.category,
    note.operatorNote,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function migrateBotRequestNotesDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_request_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      category TEXT NOT NULL DEFAULT 'feature',
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source_user TEXT NOT NULL DEFAULT 'unknown',
      observed_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      operator_note TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_bot_request_notes_status_updated
      ON bot_request_notes (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS bot_request_note_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function openBotRequestNotesDatabase(dbPath: string): DatabaseSync | null {
  if (!dbPath.trim()) return null;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrateBotRequestNotesDatabase(db);
  return db;
}

function loadNoteById(
  db: DatabaseSync,
  id: number
): BotRequestNote | undefined {
  const row = db
    .prepare(
      `
      SELECT id, dedupe_key, status, category, summary, evidence, source_user,
             observed_count, created_at, updated_at, last_observed_at,
             resolved_at, operator_note
      FROM bot_request_notes
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(id) as unknown as BotRequestNoteRow | undefined;
  return row ? rowToNote(row) : undefined;
}

function loadNoteByDedupeKey(
  db: DatabaseSync,
  dedupeKey: string
): BotRequestNoteRow | undefined {
  return db
    .prepare(
      `
      SELECT id, dedupe_key, status, category, summary, evidence, source_user,
             observed_count, created_at, updated_at, last_observed_at,
             resolved_at, operator_note
      FROM bot_request_notes
      WHERE dedupe_key = ?
      LIMIT 1
    `
    )
    .get(dedupeKey) as unknown as BotRequestNoteRow | undefined;
}

function loadDigestLastSentAt(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT value FROM bot_request_note_meta WHERE key = ? LIMIT 1")
    .get(DIGEST_META_LAST_SENT_AT) as unknown as MetaRow | undefined;
  return row?.value ?? "";
}

export function extractBotRequestNote(
  text: string,
  options: ExtractBotRequestNoteOptions = {}
): BotRequestNoteEntry | null {
  const raw = stripBotAddressing(text);
  const clean = stripTrailingNoise(raw);
  if (!clean) return null;
  if (isUnsafeRequestNoteText(clean)) return null;
  if (MEMORY_REQUEST_PATTERN.test(clean)) return null;
  if (!BOT_CONTEXT_PATTERN.test(clean)) return null;
  if (!REQUEST_PATTERN.test(clean)) return null;

  const maxSummaryChars =
    options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;
  const maxEvidenceChars =
    options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  const summary = truncate(clean, maxSummaryChars);
  const evidence = truncate(clean, maxEvidenceChars);
  if (!summary || !evidence) return null;

  return {
    category: categorizeBotRequestNote(clean),
    summary,
    evidence,
    sourceUser: normalizeSourceUser(options.sourceUser) || "unknown",
  };
}

export function saveBotRequestNoteObservationStore({
  enabled,
  dbPath,
  entry,
  now = () => new Date().toISOString(),
}: SaveBotRequestNoteObservationStoreOptions): SaveBotRequestNoteObservationStoreResult {
  if (!enabled) return { saved: false, reason: "disabled" };
  const summary = singleLine(entry.summary);
  const evidence = singleLine(entry.evidence);
  const sourceUser = normalizeSourceUser(entry.sourceUser) || "unknown";
  if (!summary || !evidence) {
    return { saved: false, reason: "invalid_format" };
  }

  let db: DatabaseSync | null = null;
  try {
    db = openBotRequestNotesDatabase(dbPath);
    if (!db) return { saved: false, reason: "invalid_format" };

    const timestamp = now();
    const cleanEntry: BotRequestNoteEntry = {
      category: normalizeCategory(entry.category),
      summary,
      evidence,
      sourceUser,
    };
    const dedupeKey = normalizeDedupeKey(cleanEntry);
    const existing = loadNoteByDedupeKey(db, dedupeKey);
    if (existing) {
      const observedCount = Math.max(1, existing.observed_count ?? 1) + 1;
      db.prepare(
        `
        UPDATE bot_request_notes
        SET observed_count = ?,
            updated_at = ?,
            last_observed_at = ?
        WHERE id = ?
      `
      ).run(observedCount, timestamp, timestamp, existing.id);
      return {
        saved: true,
        reason: "updated",
        note: loadNoteById(db, existing.id),
      };
    }

    const result = db
      .prepare(
        `
        INSERT INTO bot_request_notes (
          dedupe_key, status, category, summary, evidence, source_user,
          observed_count, created_at, updated_at, last_observed_at,
          resolved_at, operator_note
        )
        VALUES (?, 'pending', ?, ?, ?, ?, 1, ?, ?, ?, '', '')
      `
      )
      .run(
        dedupeKey,
        cleanEntry.category,
        cleanEntry.summary,
        cleanEntry.evidence,
        cleanEntry.sourceUser,
        timestamp,
        timestamp,
        timestamp
      ) as unknown as { lastInsertRowid: number | bigint };
    const id = Number(result.lastInsertRowid);
    return {
      saved: true,
      reason: "saved",
      note: loadNoteById(db, id),
    };
  } catch {
    return { saved: false, reason: "write_failed" };
  } finally {
    db?.close();
  }
}

export function listBotRequestNotesStore({
  dbPath,
  status,
  queryText,
  limit,
}: ListBotRequestNotesStoreOptions): ListBotRequestNotesStoreResult {
  let db: DatabaseSync | null = null;
  try {
    db = openBotRequestNotesDatabase(dbPath);
    if (!db) return { entries: [], totalCount: 0, openCount: 0 };
    const rows = db
      .prepare(
        `
        SELECT id, dedupe_key, status, category, summary, evidence, source_user,
               observed_count, created_at, updated_at, last_observed_at,
               resolved_at, operator_note
        FROM bot_request_notes
      `
      )
      .all() as unknown as BotRequestNoteRow[];
    const allEntries = rows.map(rowToNote).sort(compareNotes);
    const listStatus = normalizeListStatus(status);
    const entries = allEntries
      .filter((entry) => {
        if (listStatus === "all") return true;
        if (listStatus === "open") return isOpenStatus(entry.status);
        return entry.status === listStatus;
      })
      .filter((entry) => noteMatchesQuery(entry, queryText))
      .slice(0, normalizeListLimit(limit));

    return {
      entries,
      totalCount: allEntries.length,
      openCount: allEntries.filter((entry) => isOpenStatus(entry.status)).length,
    };
  } catch {
    return { entries: [], totalCount: 0, openCount: 0 };
  } finally {
    db?.close();
  }
}

export function updateBotRequestNoteStore({
  dbPath,
  id,
  status,
  operatorNote,
  now = () => new Date().toISOString(),
}: UpdateBotRequestNoteStoreOptions): UpdateBotRequestNoteStoreResult {
  if (
    status !== "pending" &&
    status !== "planned" &&
    status !== "done" &&
    status !== "rejected" &&
    status !== "duplicate"
  ) {
    return { updated: false, reason: "invalid_status" };
  }

  let db: DatabaseSync | null = null;
  try {
    db = openBotRequestNotesDatabase(dbPath);
    if (!db) return { updated: false, reason: "write_failed" };
    const existing = loadNoteById(db, id);
    if (!existing) return { updated: false, reason: "not_found" };
    const timestamp = now();
    const resolvedAt = isOpenStatus(status) ? "" : timestamp;
    db.prepare(
      `
      UPDATE bot_request_notes
      SET status = ?,
          operator_note = ?,
          resolved_at = ?,
          updated_at = ?
      WHERE id = ?
    `
    ).run(
      status,
      singleLine(operatorNote ?? existing.operatorNote),
      resolvedAt,
      timestamp,
      id
    );
    return {
      updated: true,
      reason: "updated",
      note: loadNoteById(db, id),
    };
  } catch {
    return { updated: false, reason: "write_failed" };
  } finally {
    db?.close();
  }
}

export function buildBotRequestNotesDigest({
  enabled,
  dbPath,
  intervalHours,
  maxItems,
  now = () => new Date().toISOString(),
}: BuildBotRequestNotesDigestOptions): BuildBotRequestNotesDigestResult {
  if (!enabled) {
    return { shouldSend: false, reason: "disabled", itemCount: 0, entries: [] };
  }

  let db: DatabaseSync | null = null;
  try {
    db = openBotRequestNotesDatabase(dbPath);
    if (!db) {
      return {
        shouldSend: false,
        reason: "invalid_file",
        itemCount: 0,
        entries: [],
      };
    }
    const currentTime = Date.parse(now());
    const lastSentAt = Date.parse(loadDigestLastSentAt(db));
    const intervalMs = Math.max(1, Math.floor(intervalHours)) * 60 * 60 * 1000;
    if (Number.isFinite(lastSentAt) && currentTime - lastSentAt < intervalMs) {
      return {
        shouldSend: false,
        reason: "interval",
        itemCount: 0,
        entries: [],
      };
    }

    const openNotes = listBotRequestNotesStore({
      dbPath,
      status: "open",
      limit: maxItems,
    }).entries;
    if (!openNotes.length) {
      return { shouldSend: false, reason: "empty", itemCount: 0, entries: [] };
    }

    const message = formatBotRequestNotesDigestMessage(openNotes);
    return {
      shouldSend: true,
      reason: "ready",
      itemCount: openNotes.length,
      message,
      entries: openNotes,
    };
  } catch {
    return {
      shouldSend: false,
      reason: "invalid_file",
      itemCount: 0,
      entries: [],
    };
  } finally {
    db?.close();
  }
}

export function markBotRequestNotesDigestSent({
  dbPath,
  sentAt,
}: MarkBotRequestNotesDigestSentOptions): void {
  let db: DatabaseSync | null = null;
  try {
    db = openBotRequestNotesDatabase(dbPath);
    if (!db) return;
    db.prepare(
      `
      INSERT INTO bot_request_note_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
    ).run(DIGEST_META_LAST_SENT_AT, sentAt);
  } finally {
    db?.close();
  }
}

export function writeBotRequestNotesDigestFile({
  filePath,
  generatedAt,
  entries,
}: WriteBotRequestNotesDigestFileOptions): WriteBotRequestNotesDigestFileResult {
  const normalizedPath = singleLine(filePath);
  if (!normalizedPath) return { written: false, reason: "invalid_file" };

  try {
    fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
    fs.writeFileSync(
      normalizedPath,
      formatBotRequestNotesDigestFileContent(entries, generatedAt),
      "utf8"
    );
    return {
      written: true,
      reason: "written",
      filePath: normalizedPath,
    };
  } catch {
    return { written: false, reason: "invalid_file", filePath: normalizedPath };
  }
}

function formatBotRequestNotesDigestMessage(entries: BotRequestNote[]): string {
  const lines = [`📝 Bot要望メモ未対応: ${entries.length}件`];
  entries.forEach((entry, index) => {
    const status = entry.status === "planned" ? "planned" : "pending";
    const observed =
      entry.observedCount > 1 ? ` / observed ${entry.observedCount}` : "";
    lines.push(
      `${index + 1}. #${entry.id} [${status}/${entry.category}] ${entry.summary}${observed} / user=${entry.sourceUser}`
    );
  });
  return truncate(lines.join("\n"), 1900);
}

function escapeMarkdownTableCell(value: string | number): string {
  return singleLine(String(value)).replace(/\|/gu, "\\|");
}

function formatBotRequestNotesDigestFileContent(
  entries: BotRequestNote[],
  generatedAt: string
): string {
  const lines = [
    "# Bot要望メモ未対応",
    "",
    `generatedAt: ${generatedAt}`,
    `openCount: ${entries.length}`,
    "",
    "回収手順: このファイルを読んで対応対象を決め、対応後は Bot Request Notes WebUI またはSQLite更新で status を done / rejected / duplicate などへ変更する。",
    "",
  ];

  if (!entries.length) {
    lines.push("未対応のBot要望メモはありません。", "");
    return lines.join("\n");
  }

  lines.push(
    "| id | status | category | user | observed | updatedAt | summary | evidence |",
    "| --- | --- | --- | --- | ---: | --- | --- | --- |"
  );
  entries.forEach((entry) => {
    lines.push(
      `| ${entry.id} | ${escapeMarkdownTableCell(entry.status)} | ${escapeMarkdownTableCell(entry.category)} | ${escapeMarkdownTableCell(entry.sourceUser)} | ${entry.observedCount} | ${escapeMarkdownTableCell(entry.updatedAt)} | ${escapeMarkdownTableCell(entry.summary)} | ${escapeMarkdownTableCell(entry.evidence)} |`
    );
  });
  lines.push("");
  return lines.join("\n");
}
