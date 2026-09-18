const TWITCH_USER_EMOTES_URL = "https://api.twitch.tv/helix/chat/emotes/user";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_FAILURE_BACKOFF_MS = 15_000;
const DEFAULT_MAX_PAGES = 20;

export interface TwitchAvailableEmote {
  id: string;
  name: string;
  emoteType: string;
  tier?: string;
  emoteSetId?: string;
  ownerId?: string;
  format?: readonly string[];
  scale?: readonly string[];
  themeMode?: readonly string[];
}

type ValueProvider = () => string | Promise<string>;

export interface TwitchAvailableEmotesClientOptions {
  getAccessToken: ValueProvider;
  getClientId: ValueProvider;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureBackoffMs?: number;
  maxPages?: number;
}

interface CacheEntry {
  emotes: readonly TwitchAvailableEmote[];
  expiresAt: number;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("invalid_response");
  }
  return [...value];
}

function parseEmote(value: unknown): TwitchAvailableEmote {
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.emote_type !== "string" ||
    record.id.length === 0 ||
    record.name.length === 0 ||
    record.emote_type.length === 0
  ) {
    throw new Error("invalid_response");
  }

  const parsed: TwitchAvailableEmote = {
    id: record.id,
    name: record.name,
    emoteType: record.emote_type,
  };
  const tier = optionalString(record.tier);
  const emoteSetId = optionalString(record.emote_set_id);
  const ownerId = optionalString(record.owner_id);
  const format = optionalStringArray(record.format);
  const scale = optionalStringArray(record.scale);
  const themeMode = optionalStringArray(record.theme_mode);
  if (tier !== undefined) parsed.tier = tier;
  if (emoteSetId !== undefined) parsed.emoteSetId = emoteSetId;
  if (ownerId !== undefined) parsed.ownerId = ownerId;
  if (format !== undefined) parsed.format = format;
  if (scale !== undefined) parsed.scale = scale;
  if (themeMode !== undefined) parsed.themeMode = themeMode;
  return parsed;
}

function parsePage(value: unknown): {
  emotes: TwitchAvailableEmote[];
  cursor: string | null;
} {
  if (!value || typeof value !== "object") throw new Error("invalid_response");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.data)) throw new Error("invalid_response");
  if (
    record.pagination !== undefined &&
    (!record.pagination || typeof record.pagination !== "object")
  ) {
    throw new Error("invalid_response");
  }
  const pagination = (record.pagination ?? {}) as Record<string, unknown>;
  if (pagination.cursor !== undefined && typeof pagination.cursor !== "string") {
    throw new Error("invalid_response");
  }
  return {
    emotes: record.data.map(parseEmote),
    cursor:
      typeof pagination.cursor === "string" && pagination.cursor.length > 0
        ? pagination.cursor
        : null,
  };
}

export class TwitchAvailableEmotesClient {
  private readonly getAccessToken: ValueProvider;
  private readonly getClientId: ValueProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly failureBackoffMs: number;
  private readonly maxPages: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<
    string,
    Promise<readonly TwitchAvailableEmote[]>
  >();

  constructor(options: TwitchAvailableEmotesClientOptions) {
    this.getAccessToken = options.getAccessToken;
    this.getClientId = options.getClientId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.cacheTtlMs = positiveInteger(
      options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS
    );
    this.failureBackoffMs = positiveInteger(
      options.failureBackoffMs ?? DEFAULT_FAILURE_BACKOFF_MS,
      DEFAULT_FAILURE_BACKOFF_MS
    );
    this.maxPages = positiveInteger(options.maxPages ?? DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES);
  }

  getAvailableEmotes(
    userId: string,
    broadcasterId: string
  ): Promise<readonly TwitchAvailableEmote[]> {
    const key = `${userId}:${broadcasterId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.emotes);
    }

    const activeRequest = this.inFlight.get(key);
    if (activeRequest) return activeRequest;

    const request = this.fetchAvailableEmotes(userId, broadcasterId)
      .then((emotes) => {
        this.cache.set(key, {
          emotes,
          expiresAt: this.now() + this.cacheTtlMs,
        });
        return emotes;
      })
      .catch(() => {
        const emotes: readonly TwitchAvailableEmote[] = [];
        this.cache.set(key, {
          emotes,
          expiresAt: this.now() + this.failureBackoffMs,
        });
        return emotes;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  private async fetchAvailableEmotes(
    userId: string,
    broadcasterId: string
  ): Promise<readonly TwitchAvailableEmote[]> {
    if (!userId || !broadcasterId) throw new Error("invalid_identity");
    const abortController = new AbortController();
    let rejectDeadline: ((reason: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timeout = setTimeout(() => {
      abortController.abort();
      rejectDeadline?.(new Error("deadline_exceeded"));
    }, this.timeoutMs);
    timeout.unref?.();
    try {
      return await Promise.race([
        this.fetchPages(userId, broadcasterId, abortController.signal),
        deadline,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchPages(
    userId: string,
    broadcasterId: string,
    signal: AbortSignal
  ): Promise<readonly TwitchAvailableEmote[]> {
    const [accessToken, clientId] = await Promise.all([
      this.getAccessToken(),
      this.getClientId(),
    ]);
    if (!accessToken || !clientId) throw new Error("missing_credentials");

    const emotes: TwitchAvailableEmote[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < this.maxPages; page += 1) {
      const url = new URL(TWITCH_USER_EMOTES_URL);
      url.searchParams.set("user_id", userId);
      url.searchParams.set("broadcaster_id", broadcasterId);
      if (cursor) url.searchParams.set("after", cursor);

      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": clientId,
        },
        signal,
      });
      if (!response.ok) throw new Error("request_failed");
      const parsed = parsePage(await response.json());
      emotes.push(...parsed.emotes);
      if (!parsed.cursor) return emotes;
      if (seenCursors.has(parsed.cursor)) throw new Error("cursor_loop");
      seenCursors.add(parsed.cursor);
      cursor = parsed.cursor;
    }
    throw new Error("page_limit");
  }
}
