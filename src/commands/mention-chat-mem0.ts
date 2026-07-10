import {
  resolveMentionChatMemorySubject,
  type MentionChatMemoryEntryKind,
} from "./mention-chat-memory";

interface Mem0Message {
  role: "user" | "assistant";
  content: string;
}

export interface MentionChatMem0ScopeOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
  appId?: string;
}

interface Mem0HttpOptions {
  endpoint?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface LoadMentionChatMem0MemoryOptions
  extends MentionChatMem0ScopeOptions,
    Mem0HttpOptions {
  enabled: boolean;
  queryText: string;
  timeoutMs: number;
  maxItems: number;
  maxChars: number;
  minScore?: number;
  allowMissingScore?: boolean;
  subjectAliases?: readonly string[];
}

export interface MentionChatMem0MemoryItem {
  text: string;
  key: string | null;
}

export interface MentionChatMem0MemoryResult {
  text: string | null;
  itemCount: number;
  charCount: number;
  items?: MentionChatMem0MemoryItem[];
  reason:
    | "disabled"
    | "missing_endpoint"
    | "hosted_not_allowed"
    | "found"
    | "empty"
    | "failed";
}

export interface SaveMentionChatMem0MemoryOptions
  extends MentionChatMem0ScopeOptions,
    Mem0HttpOptions {
  enabled: boolean;
  timeoutMs: number;
  entry: {
    key: string;
    value: string;
  };
  kind: MentionChatMemoryEntryKind;
  sourceUser?: string;
}

export interface SaveMentionChatMem0MemoryResult {
  saved: boolean;
  reason: "disabled" | "missing_endpoint" | "hosted_not_allowed" | "saved" | "failed";
}

const EMPTY_MEM0_MEMORY: MentionChatMem0MemoryResult = {
  text: null,
  itemCount: 0,
  charCount: 0,
  reason: "empty",
};
const DEFAULT_MEM0_MIN_SCORE = 0.5;
const UNSAFE_MEM0_KEY_PATTERN =
  /(?:https?:\/\/|www\.|\b(?:token|secret|password|passwd|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b|apiキー|トークン|シークレット|認証情報|パスワード|システムプロンプト|指示を無視)/iu;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactOptional(value: string | undefined): string | undefined {
  const text = singleLine(value ?? "");
  return text || undefined;
}

function normalizeEndpoint(endpoint: string | undefined): string | null {
  const cleanEndpoint = compactOptional(endpoint);
  if (!cleanEndpoint) return null;
  try {
    const url = new URL(cleanEndpoint);
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function isHostedMem0Endpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return hostname === "api.mem0.ai" || hostname === "app.mem0.ai";
  } catch {
    return false;
  }
}

function buildHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cleanApiKey = compactOptional(apiKey);
  if (cleanApiKey) headers["X-API-Key"] = cleanApiKey;
  return headers;
}

function scopedBody({
  userId,
  agentId,
  runId,
}: MentionChatMem0ScopeOptions): Record<string, string> {
  const body: Record<string, string> = {};
  const cleanUserId = compactOptional(userId);
  const cleanAgentId = compactOptional(agentId);
  const cleanRunId = compactOptional(runId);
  if (cleanUserId) body.user_id = cleanUserId;
  if (cleanAgentId) body.agent_id = cleanAgentId;
  if (cleanRunId) body.run_id = cleanRunId;
  return body;
}

function memoryTextFromResult(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const field of ["memory", "text", "content"]) {
    const text = record[field];
    if (typeof text === "string" && singleLine(text)) {
      return singleLine(text);
    }
  }
  const payload = record["payload"];
  if (payload && typeof payload === "object") {
    return memoryTextFromResult(payload);
  }
  return null;
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resultMetadataKey(value: unknown): string | null {
  const record = resultRecord(value);
  if (!record) return null;
  const metadata = resultRecord(record["metadata"]);
  const rawKey = metadata?.["key"];
  if (typeof rawKey === "string") {
    const key = singleLine(rawKey);
    if (key && key.length <= 120 && !UNSAFE_MEM0_KEY_PATTERN.test(key)) {
      return key;
    }
  }
  return resultMetadataKey(record["payload"]);
}

function fallbackKeyFromText(text: string): string | null {
  const separatorIndex = text.search(/[:：]/u);
  if (separatorIndex <= 0) return null;
  const key = singleLine(text.slice(0, separatorIndex));
  if (!key || key.length > 120 || UNSAFE_MEM0_KEY_PATTERN.test(key)) return null;
  return key;
}

function resultScore(value: unknown): unknown {
  const record = resultRecord(value);
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, "score")) {
    return record["score"];
  }
  return resultScore(record["payload"]);
}

function normalizeMinScore(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MEM0_MIN_SCORE;
  if (!Number.isFinite(value)) return DEFAULT_MEM0_MIN_SCORE;
  return Math.min(1, Math.max(0, value));
}

function validResultScore(
  score: unknown,
  minScore: number,
  allowMissingScore: boolean
): boolean {
  if (score === undefined) return allowMissingScore;
  return (
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 1 &&
    score >= minScore
  );
}

function resultArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const field of ["results", "memories", "data"]) {
    const nested = record[field];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function memorySubject(item: MentionChatMem0MemoryItem): string | null {
  const key = singleLine(item.key ?? "");
  if (!key) return null;
  return resolveMentionChatMemorySubject(key, item.text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryIncludesSubject(query: string, subject: string): boolean {
  if (/^[a-z0-9_+-]+$/u.test(subject)) {
    return new RegExp(`(?:^|[^a-z0-9_+-])${escapeRegExp(subject)}(?:$|[^a-z0-9_+-])`, "u").test(
      query
    );
  }
  return query.includes(subject);
}

function isolateMemorySubjects(
  items: MentionChatMem0MemoryItem[],
  queryText: string,
  subjectAliases: readonly string[] = []
): MentionChatMem0MemoryItem[] {
  const query = singleLine(queryText).toLowerCase();
  const subjects = new Set(
    items.map(memorySubject).filter((subject): subject is string => Boolean(subject))
  );
  const mentionedSubjects = new Set(
    [...subjects].filter((subject) => queryIncludesSubject(query, subject))
  );
  if (/(?:私|わたし|僕|ぼく|俺|おれ|うち|自分)(?:は|って|の|について|だ)/u.test(query)) {
    for (const alias of subjectAliases) {
      const normalizedAlias = singleLine(alias).toLowerCase();
      if (normalizedAlias) mentionedSubjects.add(normalizedAlias);
    }
  }

  return items.filter((item) => {
    const subject = memorySubject(item);
    if (!subject) return true;
    if (mentionedSubjects.size === 0) return false;
    return mentionedSubjects.has(subject);
  });
}

function capMemoryItems(
  items: MentionChatMem0MemoryItem[],
  maxItems: number,
  maxChars: number
): MentionChatMem0MemoryResult {
  const selected: MentionChatMem0MemoryItem[] = [];
  const seen = new Set<string>();
  let usedChars = 0;
  for (const item of items) {
    if (selected.length >= maxItems || seen.has(item.text)) continue;
    const separatorChars = selected.length > 0 ? 1 : 0;
    if (usedChars + separatorChars + item.text.length > maxChars) break;
    selected.push(item);
    seen.add(item.text);
    usedChars += separatorChars + item.text.length;
  }
  const text = selected.map((item) => item.text).join("\n");

  const result: MentionChatMem0MemoryResult = {
    text: text || null,
    itemCount: selected.length,
    charCount: text.length,
    ...(text ? { items: selected } : {}),
    reason: text ? "found" : "empty",
  };
  return result;
}

export function shouldRecallMentionChatMem0Memory(
  queryText: string,
  recallGateEnabled = true
): boolean {
  if (!recallGateEnabled) return true;
  const text = singleLine(queryText);
  if (!text) return false;
  const compact = text.replace(/[\s。.!！?？、,~〜]+/gu, "");
  if (/^(?:おはよう(?:ございます)?|こんにちは|こんばんは|やっほー?)$/u.test(compact)) {
    return false;
  }
  if (
    /^(?:(?:助かった|助かりました))?(?:ありがとう(?:ございます)?|ありがと|感謝)$/u.test(
      compact
    )
  ) {
    return false;
  }
  if (/^(?:なるほど|そうなんだ|そうなの|わーい|草|w+|rukkakusa)$/iu.test(compact)) {
    return false;
  }
  return true;
}

async function postJson({
  endpoint,
  path,
  apiKey,
  timeoutMs,
  body,
  fetchImpl = fetch,
}: {
  endpoint: string;
  path: "/memories" | "/search";
  apiKey?: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const response = await fetchImpl(`${endpoint}${path}`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (!response.ok) throw new Error(`mem0 http ${response.status}`);
  return response.json();
}

export async function loadMentionChatMem0Memory({
  enabled,
  endpoint,
  apiKey,
  queryText,
  userId,
  agentId,
  runId,
  timeoutMs,
  maxItems,
  maxChars,
  minScore,
  allowMissingScore = false,
  subjectAliases,
  fetchImpl,
}: LoadMentionChatMem0MemoryOptions): Promise<MentionChatMem0MemoryResult> {
  if (!enabled) return { ...EMPTY_MEM0_MEMORY, reason: "disabled" };
  const cleanEndpoint = normalizeEndpoint(endpoint);
  const cleanQuery = singleLine(queryText);
  if (!cleanEndpoint) {
    return { ...EMPTY_MEM0_MEMORY, reason: "missing_endpoint" };
  }
  if (isHostedMem0Endpoint(cleanEndpoint)) {
    return { ...EMPTY_MEM0_MEMORY, reason: "hosted_not_allowed" };
  }
  if (!cleanQuery || maxItems <= 0 || maxChars <= 0) return EMPTY_MEM0_MEMORY;
  const threshold = normalizeMinScore(minScore);

  try {
    const raw = await postJson({
      endpoint: cleanEndpoint,
      path: "/search",
      apiKey,
      timeoutMs,
      fetchImpl,
      body: {
        query: cleanQuery,
        filters: scopedBody({ userId, agentId, runId }),
        top_k: maxItems,
        threshold,
      },
    });
    const items = resultArray(raw)
      .map((value): MentionChatMem0MemoryItem | null => {
        if (!validResultScore(resultScore(value), threshold, allowMissingScore)) {
          return null;
        }
        const text = memoryTextFromResult(value);
        if (!text) return null;
        const metadataKey = resultMetadataKey(value);
        return {
          text,
          key: metadataKey ?? fallbackKeyFromText(text),
        };
      })
      .filter((item): item is MentionChatMem0MemoryItem => Boolean(item));
    return capMemoryItems(
      isolateMemorySubjects(items, cleanQuery, subjectAliases),
      maxItems,
      maxChars
    );
  } catch {
    return { ...EMPTY_MEM0_MEMORY, reason: "failed" };
  }
}

export async function saveMentionChatMem0Memory({
  enabled,
  endpoint,
  apiKey,
  userId,
  agentId,
  appId,
  runId,
  timeoutMs,
  entry,
  kind,
  sourceUser,
  fetchImpl,
}: SaveMentionChatMem0MemoryOptions): Promise<SaveMentionChatMem0MemoryResult> {
  if (!enabled) return { saved: false, reason: "disabled" };
  const cleanEndpoint = normalizeEndpoint(endpoint);
  const key = singleLine(entry.key);
  const value = singleLine(entry.value);
  if (!cleanEndpoint) return { saved: false, reason: "missing_endpoint" };
  if (isHostedMem0Endpoint(cleanEndpoint)) {
    return { saved: false, reason: "hosted_not_allowed" };
  }
  if (!key || !value) return { saved: false, reason: "failed" };

  try {
    const messages: Mem0Message[] = [
      { role: "user", content: `${key}: ${value}` },
    ];
    await postJson({
      endpoint: cleanEndpoint,
      path: "/memories",
      apiKey,
      timeoutMs,
      fetchImpl,
      body: {
        messages,
        infer: false,
        ...scopedBody({ userId, agentId, runId }),
        metadata: {
          key,
          kind,
          sourceUser: singleLine(sourceUser ?? "") || "unknown",
          source: "twitchRaid",
          app_id: compactOptional(appId),
        },
      },
    });
    return { saved: true, reason: "saved" };
  } catch {
    return { saved: false, reason: "failed" };
  }
}
