interface BoomVideo {
  id: string;
  creationDate: Date;
  durationInSeconds: number;
}

interface BoomVideoPage {
  data: BoomVideo[];
  cursor?: string;
}

interface BoomVideoFilter {
  type?: "archive" | "highlight" | "upload" | "all";
  limit?: number;
  after?: string;
}

export interface BoomApiClient {
  videos: {
    getVideosByUser?(
      broadcasterId: string,
      filter?: BoomVideoFilter
    ): Promise<BoomVideoPage>;
    getVideosByUserPaginated(
      broadcasterId: string,
      filter?: { type?: "archive" | "highlight" | "upload" | "all" }
    ): AsyncIterable<BoomVideo>;
  };
}

export type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export type HelixFetchLike = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<{ ok: boolean; status?: number; text(): Promise<string> }>;

export interface GameChapter {
  gameName: string;
  durationSeconds: number;
}

export interface BoomGameSummary {
  gameName: string;
  totalSeconds: number;
}

export interface BoomSummary {
  analyzedVideos: number;
  lookbackDays: number;
  totalStreamSeconds: number;
  games: BoomGameSummary[];
}

interface BuildBoomSummaryOptions {
  broadcasterId: string;
  gqlClientId: string;
  fetchFn?: FetchLike;
  helixClientId?: string;
  helixAccessToken?: string;
  helixFetchFn?: HelixFetchLike;
  lookbackDays?: number;
  maxVideos?: number;
  minGameSeconds?: number;
  maxGames?: number;
  maxConcurrentVideos?: number;
  archiveVideoPageSize?: number;
  archiveVideoRetryAttempts?: number;
  archiveVideoRetryDelayMs?: number;
  now?: () => Date;
}

interface MomentNode {
  positionMilliseconds?: unknown;
  durationMilliseconds?: unknown;
  details?: {
    game?: {
      displayName?: unknown;
      name?: unknown;
    };
  };
}

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
export const DEFAULT_TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
export const DEFAULT_BOOM_LOOKBACK_DAYS = 30;
export const MAX_BOOM_COMMAND_LOOKBACK_DAYS = 60;
export const BOOM_COMMAND_USAGE = `⚠️ 使い方: !boom [日数]（1〜${MAX_BOOM_COMMAND_LOOKBACK_DAYS}の整数）`;
const DEFAULT_MIN_GAME_SECONDS = 60 * 60;
const DEFAULT_MAX_GAMES = 6;
const DEFAULT_MAX_CONCURRENT_VIDEOS = 4;
const DEFAULT_ARCHIVE_VIDEO_PAGE_SIZE = 20;
const DEFAULT_ARCHIVE_VIDEO_RETRY_ATTEMPTS = 2;
const DEFAULT_ARCHIVE_VIDEO_RETRY_DELAY_MS = 500;
const VIDEO_METADATA_HASH =
  "45111672eea2e507f8ba44d101a61862f9c56b11dee09a15634cb75cb9b9084d";
const VIDEO_CHAPTER_HASH =
  "71835d5ef425e154bf282453a926d99b328cdc5e32f36d3a209d0f4778b41203";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function isTransientArchiveVideoError(error: unknown): boolean {
  return /premature close|econnreset|etimedout|socket hang up|fetch failed|body terminated|aborted|terminated/i.test(
    errorText(error)
  );
}

function parseTwitchVideoDurationSeconds(duration: string): number | null {
  const match = duration.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match || match[0] === "") return null;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalSeconds = hours * 60 * 60 + minutes * 60 + seconds;
  return Number.isFinite(totalSeconds) ? totalSeconds : null;
}

function parseHelixVideoPage(response: unknown): BoomVideoPage {
  if (!isRecord(response)) return { data: [] };
  const data = response["data"];
  const pagination = response["pagination"];

  return {
    data: Array.isArray(data)
      ? data.flatMap((item) => {
          if (!isRecord(item)) return [];

          const id = stringValue(item["id"]);
          const createdAt = stringValue(item["created_at"]);
          const duration = stringValue(item["duration"]);
          if (!id || !createdAt || !duration) return [];

          const creationDate = new Date(createdAt);
          const durationInSeconds =
            parseTwitchVideoDurationSeconds(duration) ?? null;
          if (
            Number.isNaN(creationDate.getTime()) ||
            durationInSeconds === null
          ) {
            return [];
          }

          return [{ id, creationDate, durationInSeconds }];
        })
      : [],
    cursor: isRecord(pagination)
      ? stringValue(pagination["cursor"]) ?? undefined
      : undefined,
  };
}

export function parseBoomCommandLookbackDays(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BOOM_LOOKBACK_DAYS;
  if (!/^\d+$/.test(trimmed)) return null;

  const days = Number(trimmed);
  if (
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > MAX_BOOM_COMMAND_LOOKBACK_DAYS
  ) {
    return null;
  }

  return days;
}

function extractMomentNodes(response: unknown): MomentNode[] {
  if (!isRecord(response)) return [];
  const data = response["data"];
  if (!isRecord(data)) return [];
  const video = data["video"];
  if (!isRecord(video)) return [];
  const moments = video["moments"];
  if (!isRecord(moments)) return [];
  const edges = moments["edges"];
  if (!Array.isArray(edges)) return [];

  return edges
    .map((edge) => {
      if (!isRecord(edge)) return null;
      const node = edge["node"];
      return isRecord(node) ? (node as MomentNode) : null;
    })
    .filter((node): node is MomentNode => node !== null);
}

function gameNameFromMoment(node: MomentNode): string | null {
  const game = node.details?.game;
  return stringValue(game?.displayName) ?? stringValue(game?.name);
}

function graphQlClientIds(primary: string): string[] {
  return [...new Set([primary, DEFAULT_TWITCH_GQL_CLIENT_ID].filter(Boolean))];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    })
  );

  return results;
}

export function parseGameChapters(
  response: unknown,
  videoDurationSeconds: number
): GameChapter[] {
  const nodes = extractMomentNodes(response)
    .map((node) => ({
      node,
      positionMs: numberValue(node.positionMilliseconds) ?? 0,
    }))
    .sort((a, b) => a.positionMs - b.positionMs);

  return nodes.flatMap(({ node, positionMs }, index) => {
    const gameName = gameNameFromMoment(node);
    if (!gameName) return [];

    const explicitDurationMs = numberValue(node.durationMilliseconds);
    const nextPositionMs = nodes[index + 1]?.positionMs;
    const fallbackDurationMs =
      nextPositionMs !== undefined
        ? nextPositionMs - positionMs
        : videoDurationSeconds * 1000 - positionMs;
    const durationMs =
      explicitDurationMs && explicitDurationMs > 0
        ? explicitDurationMs
        : fallbackDurationMs;

    if (durationMs <= 0) return [];
    return [{ gameName, durationSeconds: Math.floor(durationMs / 1000) }];
  });
}

async function fetchRecentArchiveVideos(
  apiClient: BoomApiClient,
  broadcasterId: string,
  options: {
    lookbackDays: number;
    maxVideos: number | null;
    now: Date;
    pageSize: number;
    helixClientId?: string;
    helixAccessToken?: string;
    helixFetchFn: HelixFetchLike;
    retryAttempts: number;
    retryDelayMs: number;
  }
): Promise<BoomVideo[]> {
  const cutoffTime =
    options.now.getTime() - options.lookbackDays * 24 * 60 * 60 * 1000;

  if (options.helixClientId && options.helixAccessToken) {
    return fetchRecentArchiveVideosByHelixIdentity(
      broadcasterId,
      {
        cutoffTime,
        maxVideos: options.maxVideos,
        pageSize: options.pageSize,
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
      },
      {
        clientId: options.helixClientId,
        accessToken: options.helixAccessToken,
        fetchFn: options.helixFetchFn,
      }
    );
  }

  if (typeof apiClient.videos.getVideosByUser === "function") {
    return fetchRecentArchiveVideosByPage(apiClient, broadcasterId, {
      cutoffTime,
      maxVideos: options.maxVideos,
      pageSize: options.pageSize,
      retryAttempts: options.retryAttempts,
      retryDelayMs: options.retryDelayMs,
    });
  }

  const maxAttempts = Math.max(1, options.retryAttempts + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const paginator = apiClient.videos.getVideosByUserPaginated(broadcasterId, {
      type: "archive",
    });
    const videos: BoomVideo[] = [];

    try {
      for await (const video of paginator) {
        if (video.creationDate.getTime() < cutoffTime) break;

        videos.push(video);
        if (options.maxVideos !== null && videos.length >= options.maxVideos) {
          break;
        }
      }

      return videos;
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientArchiveVideoError(e)) {
        throw e;
      }

      await delay(options.retryDelayMs);
    }
  }

  throw new Error("Twitch archive video pagination did not complete");
}

async function fetchRecentArchiveVideosByHelixIdentity(
  broadcasterId: string,
  options: {
    cutoffTime: number;
    maxVideos: number | null;
    pageSize: number;
    retryAttempts: number;
    retryDelayMs: number;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixFetchLike;
  }
): Promise<BoomVideo[]> {
  const videos: BoomVideo[] = [];
  let after: string | undefined;

  while (true) {
    const page = await fetchArchiveVideoIdentityPageWithRetry(
      broadcasterId,
      {
        pageSize: options.pageSize,
        after,
      },
      helix,
      {
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
      }
    );

    if (!page.data.length) return videos;

    for (const video of page.data) {
      if (video.creationDate.getTime() < options.cutoffTime) return videos;

      videos.push(video);
      if (options.maxVideos !== null && videos.length >= options.maxVideos) {
        return videos;
      }
    }

    if (!page.cursor || page.cursor === after) return videos;
    after = page.cursor;
  }
}

async function fetchArchiveVideoIdentityPageWithRetry(
  broadcasterId: string,
  pageOptions: {
    pageSize: number;
    after?: string;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixFetchLike;
  },
  retry: {
    retryAttempts: number;
    retryDelayMs: number;
  }
): Promise<BoomVideoPage> {
  const maxAttempts = Math.max(1, retry.retryAttempts + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchArchiveVideoIdentityPage(
        broadcasterId,
        pageOptions,
        helix
      );
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientArchiveVideoError(e)) {
        throw e;
      }

      await delay(retry.retryDelayMs);
    }
  }

  throw new Error("Twitch archive video identity page fetch did not complete");
}

async function fetchArchiveVideoIdentityPage(
  broadcasterId: string,
  pageOptions: {
    pageSize: number;
    after?: string;
  },
  helix: {
    clientId: string;
    accessToken: string;
    fetchFn: HelixFetchLike;
  }
): Promise<BoomVideoPage> {
  const url = new URL("https://api.twitch.tv/helix/videos");
  url.searchParams.set("user_id", broadcasterId);
  url.searchParams.set("type", "archive");
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
      `Twitch Helix videos request failed: status=${response.status ?? "unknown"}`
    );
  }

  return parseHelixVideoPage(JSON.parse(body));
}

async function fetchRecentArchiveVideosByPage(
  apiClient: BoomApiClient,
  broadcasterId: string,
  options: {
    cutoffTime: number;
    maxVideos: number | null;
    pageSize: number;
    retryAttempts: number;
    retryDelayMs: number;
  }
): Promise<BoomVideo[]> {
  const videos: BoomVideo[] = [];
  let after: string | undefined;

  while (true) {
    const page = await fetchArchiveVideoPageWithRetry(
      apiClient,
      broadcasterId,
      {
        type: "archive",
        limit: options.pageSize,
        ...(after ? { after } : {}),
      },
      {
        retryAttempts: options.retryAttempts,
        retryDelayMs: options.retryDelayMs,
      }
    );

    if (!page.data.length) return videos;

    for (const video of page.data) {
      if (video.creationDate.getTime() < options.cutoffTime) return videos;

      videos.push(video);
      if (options.maxVideos !== null && videos.length >= options.maxVideos) {
        return videos;
      }
    }

    if (!page.cursor || page.cursor === after) return videos;
    after = page.cursor;
  }
}

async function fetchArchiveVideoPageWithRetry(
  apiClient: BoomApiClient,
  broadcasterId: string,
  filter: BoomVideoFilter,
  options: {
    retryAttempts: number;
    retryDelayMs: number;
  }
): Promise<BoomVideoPage> {
  const maxAttempts = Math.max(1, options.retryAttempts + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await apiClient.videos.getVideosByUser!(broadcasterId, filter);
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientArchiveVideoError(e)) {
        throw e;
      }

      await delay(options.retryDelayMs);
    }
  }

  throw new Error("Twitch archive video page fetch did not complete");
}

async function fetchVideoChapters(
  fetchFn: FetchLike,
  gqlClientId: string,
  videoId: string
): Promise<unknown> {
  return fetchPersistedGraphQl(fetchFn, gqlClientId, {
    operationName: "VideoPlayer_ChapterSelectButtonVideo",
    variables: { includePrivate: false, videoID: videoId },
    sha256Hash: VIDEO_CHAPTER_HASH,
  });
}

async function fetchVideoMetadata(
  fetchFn: FetchLike,
  gqlClientId: string,
  videoId: string
): Promise<unknown> {
  return fetchPersistedGraphQl(fetchFn, gqlClientId, {
    operationName: "VideoMetadata",
    variables: { channelLogin: "", videoID: videoId },
    sha256Hash: VIDEO_METADATA_HASH,
  });
}

async function fetchPersistedGraphQl(
  fetchFn: FetchLike,
  gqlClientId: string,
  request: {
    operationName: string;
    variables: Record<string, unknown>;
    sha256Hash: string;
  }
): Promise<unknown> {
  let lastStatus: number | undefined;

  for (const clientId of graphQlClientIds(gqlClientId)) {
    const response = await fetchFn(TWITCH_GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationName: request.operationName,
        variables: request.variables,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: request.sha256Hash,
          },
        },
      }),
    });

    lastStatus = response.status;
    if (response.ok) return response.json();
  }

  throw new Error(
    `Twitch GraphQL request failed: ${lastStatus ?? "unknown"}`
  );
}

function parseMetadataGame(
  response: unknown,
  fallbackDurationSeconds: number
): GameChapter | null {
  if (!isRecord(response)) return null;
  const data = response["data"];
  if (!isRecord(data)) return null;
  const video = data["video"];
  if (!isRecord(video)) return null;
  const game = video["game"];
  if (!isRecord(game)) return null;

  const gameName =
    stringValue(game["displayName"]) ?? stringValue(game["name"]);
  if (!gameName) return null;

  return {
    gameName,
    durationSeconds:
      numberValue(video["lengthSeconds"]) ?? fallbackDurationSeconds,
  };
}

async function fetchVideoGameDurations(
  video: BoomVideo,
  fetchFn: FetchLike,
  gqlClientId: string
): Promise<GameChapter[]> {
  const [metadataResponse, chaptersResponse] = await Promise.all([
    fetchVideoMetadata(fetchFn, gqlClientId, video.id),
    fetchVideoChapters(fetchFn, gqlClientId, video.id),
  ]);
  const metadataGame = parseMetadataGame(
    metadataResponse,
    video.durationInSeconds
  );
  const chapters = parseGameChapters(
    chaptersResponse,
    video.durationInSeconds
  );

  if (chapters.length > 0) return chapters;
  return metadataGame ? [metadataGame] : [];
}

export class BoomSummaryCache {
  private readonly entries = new Map<
    string,
    { summary: BoomSummary; expiresAt: number }
  >();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async getOrLoad(loader: () => Promise<BoomSummary>): Promise<BoomSummary>;
  async getOrLoad(
    key: string | number,
    loader: () => Promise<BoomSummary>
  ): Promise<BoomSummary>;
  async getOrLoad(
    keyOrLoader: string | number | (() => Promise<BoomSummary>),
    maybeLoader?: () => Promise<BoomSummary>
  ): Promise<BoomSummary> {
    const key =
      typeof keyOrLoader === "function" ? "default" : String(keyOrLoader);
    const loader =
      typeof keyOrLoader === "function" ? keyOrLoader : maybeLoader;
    if (!loader) {
      throw new TypeError("BoomSummaryCache loader is required");
    }

    const currentTime = this.now();
    const cached = this.entries.get(key);
    if (cached && currentTime < cached.expiresAt) {
      return cached.summary;
    }

    const summary = await loader();
    this.entries.set(key, {
      summary,
      expiresAt: currentTime + this.ttlMs,
    });
    return summary;
  }
}

export async function buildBoomSummary(
  apiClient: BoomApiClient,
  options: BuildBoomSummaryOptions
): Promise<BoomSummary> {
  const lookbackDays = Math.max(
    1,
    options.lookbackDays ?? DEFAULT_BOOM_LOOKBACK_DAYS
  );
  const maxVideos =
    options.maxVideos === undefined ? null : Math.max(1, options.maxVideos);
  const minGameSeconds = Math.max(
    0,
    options.minGameSeconds ?? DEFAULT_MIN_GAME_SECONDS
  );
  const maxGames = Math.max(1, options.maxGames ?? DEFAULT_MAX_GAMES);
  const maxConcurrentVideos = Math.max(
    1,
    options.maxConcurrentVideos ?? DEFAULT_MAX_CONCURRENT_VIDEOS
  );
  const archiveVideoPageSize = Math.min(
    100,
    Math.max(1, options.archiveVideoPageSize ?? DEFAULT_ARCHIVE_VIDEO_PAGE_SIZE)
  );
  const archiveVideoRetryAttempts = Math.max(
    0,
    Math.floor(
      options.archiveVideoRetryAttempts ?? DEFAULT_ARCHIVE_VIDEO_RETRY_ATTEMPTS
    )
  );
  const archiveVideoRetryDelayMs = Math.max(
    0,
    options.archiveVideoRetryDelayMs ?? DEFAULT_ARCHIVE_VIDEO_RETRY_DELAY_MS
  );
  const now = options.now?.() ?? new Date();
  const fetchFn = options.fetchFn ?? fetch;
  const helixFetchFn = options.helixFetchFn ?? fetch;
  const totals = new Map<string, number>();
  const videos = await fetchRecentArchiveVideos(
    apiClient,
    options.broadcasterId,
    {
      lookbackDays,
      maxVideos,
      now,
      pageSize: archiveVideoPageSize,
      helixClientId: options.helixClientId,
      helixAccessToken: options.helixAccessToken,
      helixFetchFn,
      retryAttempts: archiveVideoRetryAttempts,
      retryDelayMs: archiveVideoRetryDelayMs,
    }
  );
  const totalStreamSeconds = videos.reduce(
    (sum, video) => sum + video.durationInSeconds,
    0
  );

  const gameDurationsByVideo = await mapWithConcurrency(
    videos,
    maxConcurrentVideos,
    (video) => fetchVideoGameDurations(video, fetchFn, options.gqlClientId)
  );

  for (const gameDurations of gameDurationsByVideo) {
    for (const chapter of gameDurations) {
      totals.set(
        chapter.gameName,
        (totals.get(chapter.gameName) ?? 0) + chapter.durationSeconds
      );
    }
  }

  const games = [...totals.entries()]
    .map(([gameName, totalSeconds]) => ({ gameName, totalSeconds }))
    .filter((game) => game.totalSeconds >= minGameSeconds)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, maxGames);

  return {
    analyzedVideos: videos.length,
    lookbackDays,
    totalStreamSeconds,
    games,
  };
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) return `${Math.max(0, remainingMinutes)}分`;
  if (remainingMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remainingMinutes}分`;
}

export function formatBoomSummary(summary: BoomSummary): string {
  const prefix = `!過去${summary.lookbackDays}日間の総配信時間 ${formatDuration(summary.totalStreamSeconds)}`;

  if (summary.games.length === 0) {
    return `${prefix} / 1時間以上のゲームは見つかりませんでした。`;
  }

  const games = summary.games
    .map((game) => `${game.gameName} ${formatDuration(game.totalSeconds)}`)
    .join(" / ");
  return `${prefix} / ゲーム時間(1時間以上): ${games}`;
}
