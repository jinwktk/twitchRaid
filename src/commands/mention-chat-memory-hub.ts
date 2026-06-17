export interface MentionChatMemoryHubSaveResult {
  saved: boolean;
  reason:
    | "disabled"
    | "saved"
    | "not_memory_request"
    | "not_saved"
    | "http_error"
    | "exception";
  status?: number;
}

export interface MentionChatMemoryHubContext {
  text: string;
  itemCount: number;
  charCount: number;
}

export interface SaveMentionChatMemoryHubOptions {
  enabled: boolean;
  baseUrl: string;
  namespace: string;
  promptText: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchMentionChatMemoryHubContextOptions {
  enabled: boolean;
  baseUrl: string;
  namespace: string;
  queryText: string;
  timeoutMs: number;
  maxItems: number;
  maxChars: number;
  fetchImpl?: typeof fetch;
}

type MemoryHubRecord = Record<string, unknown>;

const HUB_SOURCE = "twitch-mention-chat";

function isRecord(value: unknown): value is MemoryHubRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanContextText(value: string): string {
  return value
    .split(/\r?\n/u)
    .map(singleLine)
    .filter(Boolean)
    .join("\n");
}

function buildHubUrl(baseUrl: string, path: string): string | null {
  try {
    const normalizedBaseUrl = baseUrl.trim();
    if (!normalizedBaseUrl) return null;
    return new URL(path, normalizedBaseUrl.endsWith("/")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/`).toString();
  } catch {
    return null;
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function normalizeSaveReason(value: unknown): MentionChatMemoryHubSaveResult["reason"] {
  if (value === "not_memory_request") return "not_memory_request";
  if (value === "saved") return "saved";
  return "not_saved";
}

export async function saveMentionChatMemoryHub({
  enabled,
  baseUrl,
  namespace,
  promptText,
  timeoutMs,
  fetchImpl = fetch,
}: SaveMentionChatMemoryHubOptions): Promise<MentionChatMemoryHubSaveResult> {
  const trimmedNamespace = namespace.trim();
  const url = buildHubUrl(baseUrl, "/v1/ingest");
  if (!enabled || !url || !trimmedNamespace || timeoutMs <= 0) {
    return { saved: false, reason: "disabled" };
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        namespace: trimmedNamespace,
        text: promptText,
        source: HUB_SOURCE,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return { saved: false, reason: "http_error", status: response.status };
    }

    const body = await response.json() as unknown;
    if (!isRecord(body)) return { saved: false, reason: "not_saved" };
    if (body["saved"] === true) return { saved: true, reason: "saved" };

    return {
      saved: false,
      reason: normalizeSaveReason(body["reason"]),
    };
  } catch {
    return { saved: false, reason: "exception" };
  }
}

export async function fetchMentionChatMemoryHubContext({
  enabled,
  baseUrl,
  namespace,
  queryText,
  timeoutMs,
  maxItems,
  maxChars,
  fetchImpl = fetch,
}: FetchMentionChatMemoryHubContextOptions): Promise<MentionChatMemoryHubContext | null> {
  const trimmedNamespace = namespace.trim();
  const query = singleLine(queryText);
  const url = buildHubUrl(baseUrl, "/v1/context");
  if (
    !enabled ||
    !url ||
    !trimmedNamespace ||
    !query ||
    timeoutMs <= 0 ||
    maxItems <= 0 ||
    maxChars <= 0
  ) {
    return null;
  }

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        namespace: trimmedNamespace,
        query,
        limit: maxItems,
        maxChars,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;

    const body = await response.json() as unknown;
    if (!isRecord(body) || typeof body["contextText"] !== "string") {
      return null;
    }

    const text = truncate(cleanContextText(body["contextText"]), maxChars);
    if (!text) return null;

    return {
      text,
      itemCount: Array.isArray(body["entries"]) ? body["entries"].length : 1,
      charCount: text.length,
    };
  } catch {
    return null;
  }
}
