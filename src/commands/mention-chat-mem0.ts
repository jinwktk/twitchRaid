import type { MentionChatMemoryEntryKind } from "./mention-chat-memory";

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
}

export interface MentionChatMem0MemoryResult {
  text: string | null;
  itemCount: number;
  charCount: number;
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

function capMemoryLines(
  lines: string[],
  maxItems: number,
  maxChars: number
): { text: string | null; itemCount: number; charCount: number } {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (selected.length >= maxItems) break;
    if (seen.has(line)) continue;
    const candidate = [...selected, line].join("\n");
    if (candidate.length > maxChars) break;
    selected.push(line);
    seen.add(line);
  }
  const text = selected.join("\n").trim();
  return {
    text: text || null,
    itemCount: selected.length,
    charCount: text.length,
  };
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
      },
    });
    const lines = resultArray(raw)
      .map(memoryTextFromResult)
      .filter((line): line is string => Boolean(line));
    const capped = capMemoryLines(lines, maxItems, maxChars);
    return {
      ...capped,
      reason: capped.text ? "found" : "empty",
    };
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
