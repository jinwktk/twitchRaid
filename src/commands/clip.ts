import type { HelixClip } from "@twurple/api";
import logger from "../utils/logger";
import type { ClipCacheStore } from "./clip-cache-store";

export interface ClipInfo {
  url: string;
  id: string;
  title: string;
}

export type ClipCommandName = "clip" | "myclip";

interface ClipApiClient {
  clips: {
    getClipsForBroadcasterPaginated(
      broadcasterId: string,
      filter?: { startDate?: string; endDate?: string; isFeatured?: boolean }
    ): AsyncIterable<HelixClip>;
  };
  users: {
    getUserByName?(loginName: string): Promise<{ id: string } | null>;
  };
}

type ClipCandidate = Pick<
  HelixClip,
  "id" | "url" | "title" | "creatorId" | "creatorDisplayName"
>;

interface HelixClipPage {
  data: ClipCandidate[];
  cursor?: string;
}

export type HelixClipFetchLike = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<{ ok: boolean; status?: number; text(): Promise<string> }>;

export interface SelectClipOptions {
  recentClipIds?: readonly string[];
  random?: () => number;
  maxFetch?: number;
  helixClientId?: string;
  helixAccessToken?: string;
  helixFetchFn?: HelixClipFetchLike;
  clipPageSize?: number;
  clipRetryAttempts?: number;
  clipRetryDelayMs?: number;
}

const DEFAULT_MAX_FETCH = 1000;
const DEFAULT_CLIP_PAGE_SIZE = 100;
const DEFAULT_CLIP_RETRY_ATTEMPTS = 2;
const DEFAULT_CLIP_RETRY_DELAY_MS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? ` ${String(error.cause)}`
        : "";
    return `${error.name} ${error.message}${cause}`;
  }

  return String(error);
}

function isTransientClipFetchError(error: unknown): boolean {
  return /premature close|econnreset|etimedout|socket hang up|fetch failed|body terminated|aborted|terminated|unexpected end of json input/i.test(
    errorText(error)
  );
}

function parseHelixClipPage(response: unknown): HelixClipPage {
  if (!isRecord(response)) return { data: [] };
  const data = response["data"];
  const pagination = response["pagination"];

  return {
    data: Array.isArray(data)
      ? data.flatMap((item) => {
          if (!isRecord(item)) return [];

          const id = stringValue(item["id"]);
          const url = stringValue(item["url"]);
          const title = stringValue(item["title"]);
          const creatorId = stringValue(item["creator_id"]);
          const creatorDisplayName = stringValue(item["creator_name"]);
          if (!id || !url || !title || !creatorId || !creatorDisplayName) {
            return [];
          }

          return [
            {
              id,
              url,
              title,
              creatorId,
              creatorDisplayName,
            },
          ];
        })
      : [],
    cursor: isRecord(pagination)
      ? stringValue(pagination["cursor"]) ?? undefined
      : undefined,
  };
}

/**
 * ログイン名からユーザーIDを解決する
 */
export async function resolveClipCreatorId(
  apiClient: ClipApiClient,
  loginName: string
): Promise<string | null> {
  if (!apiClient.users.getUserByName) {
    return null;
  }

  try {
    const user = await apiClient.users.getUserByName(loginName);
    return user?.id ?? null;
  } catch (e) {
    logger.error(`❌ ユーザーID解決失敗 (${loginName}): ${e}`);
    return null;
  }
}

/**
 * 直近に表示済みではないクリップを優先してランダム選択する
 */
export function pickClipAvoidingRecent(
  clips: ClipCandidate[],
  recentClipIds: readonly string[] = [],
  random: () => number = Math.random
): ClipInfo | null {
  if (clips.length === 0) return null;
  const recentSet = new Set(recentClipIds);
  const freshClips = clips.filter((clip) => !recentSet.has(clip.id));
  const pool = freshClips.length > 0 ? freshClips : clips;
  const index = Math.min(Math.floor(random() * pool.length), pool.length - 1);
  const clip = pool[index];
  return { url: clip.url, id: clip.id, title: clip.title };
}

export function clipHistoryKey(
  commandName: ClipCommandName,
  creatorName?: string
): string {
  if (commandName === "myclip") {
    return `myclip:${(creatorName ?? "").trim().toLowerCase()}`;
  }
  return "clip";
}

export function normalizeClipSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

export function clipSearchHistoryKey(query: string): string {
  return `clipsearch:${normalizeClipSearchQuery(query).toLowerCase()}`;
}

export function selectCachedClip(
  store: ClipCacheStore,
  commandName: ClipCommandName,
  creatorName?: string,
  creatorId?: string,
  random: () => number = Math.random
): ClipInfo | null {
  return store.selectRandomClip({
    historyKey: clipHistoryKey(commandName, creatorName),
    creatorName,
    creatorId,
    random,
  });
}

export function selectCachedClipSearch(
  store: ClipCacheStore,
  query: string,
  random: () => number = Math.random
): ClipInfo | null {
  const normalizedQuery = normalizeClipSearchQuery(query);
  if (!normalizedQuery) return null;

  return store.searchRandomClip({
    historyKey: clipSearchHistoryKey(normalizedQuery),
    query: normalizedQuery,
    random,
  });
}

async function fetchBroadcasterClips(
  apiClient: ClipApiClient,
  broadcasterId: string,
  options: SelectClipOptions
): Promise<ClipCandidate[]> {
  const maxFetch = Math.max(1, options.maxFetch ?? DEFAULT_MAX_FETCH);

  if (options.helixClientId && options.helixAccessToken) {
    const pageSize = Math.min(
      100,
      maxFetch,
      Math.max(1, options.clipPageSize ?? DEFAULT_CLIP_PAGE_SIZE)
    );
    return fetchBroadcasterClipsByHelixIdentity(
      broadcasterId,
      {
        maxFetch,
        pageSize,
        retryAttempts: Math.max(
          0,
          Math.floor(options.clipRetryAttempts ?? DEFAULT_CLIP_RETRY_ATTEMPTS)
        ),
        retryDelayMs: Math.max(
          0,
          options.clipRetryDelayMs ?? DEFAULT_CLIP_RETRY_DELAY_MS
        ),
      },
      {
        clientId: options.helixClientId,
        accessToken: options.helixAccessToken,
        fetchFn: options.helixFetchFn ?? fetch,
      }
    );
  }

  const paginator = apiClient.clips.getClipsForBroadcasterPaginated(
    broadcasterId
  );
  const clips: ClipCandidate[] = [];

  for await (const clip of paginator) {
    clips.push(clip);
    if (clips.length >= maxFetch) {
      break;
    }
  }

  logger.info(`🎬 clip候補取得: fetched=${clips.length}, max=${maxFetch}`);
  return clips;
}

async function fetchBroadcasterClipsByHelixIdentity(
  broadcasterId: string,
  options: {
    maxFetch: number;
    pageSize: number;
    retryAttempts: number;
    retryDelayMs: number;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixClipFetchLike;
  }
): Promise<ClipCandidate[]> {
  const clips: ClipCandidate[] = [];
  let after: string | undefined;

  while (clips.length < options.maxFetch) {
    const page = await fetchClipIdentityPageWithRetry(
      broadcasterId,
      {
        pageSize: Math.min(options.pageSize, options.maxFetch - clips.length),
        after,
      },
      helix,
      {
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
      }
    );

    if (!page.data.length) return clips;
    clips.push(...page.data.slice(0, options.maxFetch - clips.length));

    if (!page.cursor || page.cursor === after) return clips;
    after = page.cursor;
  }

  logger.info(
    `🎬 clip候補取得: fetched=${clips.length}, max=${options.maxFetch}, source=helix_identity`
  );
  return clips;
}

async function fetchClipIdentityPageWithRetry(
  broadcasterId: string,
  pageOptions: {
    pageSize: number;
    after?: string;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixClipFetchLike;
  },
  retry: {
    retryAttempts: number;
    retryDelayMs: number;
  }
): Promise<HelixClipPage> {
  const maxAttempts = Math.max(1, retry.retryAttempts + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchClipIdentityPage(broadcasterId, pageOptions, helix);
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientClipFetchError(e)) {
        throw e;
      }

      logger.info(
        `🎬 clip候補取得を再試行: attempt=${attempt}/${maxAttempts}, reason=${errorText(e)}`
      );
      await delay(retry.retryDelayMs);
    }
  }

  throw new Error("Twitch clip identity page fetch did not complete");
}

async function fetchClipIdentityPage(
  broadcasterId: string,
  pageOptions: {
    pageSize: number;
    after?: string;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixClipFetchLike;
  }
): Promise<HelixClipPage> {
  const url = new URL("https://api.twitch.tv/helix/clips");
  url.searchParams.set("broadcaster_id", broadcasterId);
  url.searchParams.set("first", String(pageOptions.pageSize));
  if (pageOptions.after) {
    url.searchParams.set("after", pageOptions.after);
  }

  const response = await helix.fetchFn(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      Authorization: `Bearer ${helix.accessToken}`,
      "Client-ID": helix.clientId,
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Twitch Helix clips request failed: status=${response.status ?? "unknown"}`
    );
  }

  return parseHelixClipPage(JSON.parse(body));
}

/**
 * ランダムなクリップを選択する
 * コマンド応答を優先し、ページング取得は最大1000件で打ち切る
 */
export async function selectClip(
  apiClient: ClipApiClient,
  broadcasterId: string,
  creatorId?: string,
  creatorName?: string,
  options: SelectClipOptions = {}
): Promise<ClipInfo | null> {
  try {
    const needsCreatorFilter = !!(creatorId || creatorName);

    // creatorNameからユーザーIDを解決
    let resolvedCreatorId = creatorId;
    if (!resolvedCreatorId && creatorName) {
      resolvedCreatorId = await resolveClipCreatorId(apiClient, creatorName) ?? undefined;
      if (!resolvedCreatorId) {
        logger.warn(`⚠️ ユーザー ${creatorName} のID解決に失敗。表示名で検索します。`);
      }
    }

    const clips = await fetchBroadcasterClips(apiClient, broadcasterId, options);

    if (!needsCreatorFilter) {
      return pickClipAvoidingRecent(
        clips,
        options.recentClipIds,
        options.random
      );
    }

    const matched: ClipCandidate[] = [];
    for (const clip of clips) {
      if (resolvedCreatorId) {
        if (clip.creatorId === resolvedCreatorId) {
          matched.push(clip);
        }
      } else if (
        creatorName &&
        clip.creatorDisplayName.toLowerCase() === creatorName.toLowerCase()
      ) {
        matched.push(clip);
      }
    }

    logger.info(
      `🎬 myclip検索: ${clips.length}件中 ${matched.length}件がマッチ (user=${creatorName ?? creatorId})`
    );

    return pickClipAvoidingRecent(
      matched,
      options.recentClipIds,
      options.random
    );
  } catch (e) {
    logger.error(`❌ Failed to fetch clips: ${e}`);
    return null;
  }
}
