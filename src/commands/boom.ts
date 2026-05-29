interface BoomVideo {
  id: string;
  durationInSeconds: number;
}

interface BoomApiClient {
  videos: {
    getVideosByUserPaginated(
      broadcasterId: string,
      filter?: { type?: "archive" | "highlight" | "upload" | "all" }
    ): AsyncIterable<BoomVideo>;
  };
}

type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

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
  games: BoomGameSummary[];
}

interface BuildBoomSummaryOptions {
  broadcasterId: string;
  gqlClientId: string;
  fetchFn?: FetchLike;
  maxVideos?: number;
  minGameSeconds?: number;
  maxGames?: number;
  maxConcurrentVideos?: number;
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
const DEFAULT_MAX_VIDEOS = 20;
const DEFAULT_MIN_GAME_SECONDS = 60 * 60;
const DEFAULT_MAX_GAMES = 6;
const DEFAULT_MAX_CONCURRENT_VIDEOS = 4;
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
  maxVideos: number
): Promise<BoomVideo[]> {
  const paginator = apiClient.videos.getVideosByUserPaginated(broadcasterId, {
    type: "archive",
  });
  const videos: BoomVideo[] = [];

  for await (const video of paginator) {
    videos.push(video);
    if (videos.length >= maxVideos) break;
  }

  return videos;
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
  private summary: BoomSummary | null = null;
  private expiresAt = 0;

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async getOrLoad(loader: () => Promise<BoomSummary>): Promise<BoomSummary> {
    const currentTime = this.now();
    if (this.summary && currentTime < this.expiresAt) {
      return this.summary;
    }

    const summary = await loader();
    this.summary = summary;
    this.expiresAt = currentTime + this.ttlMs;
    return summary;
  }
}

export async function buildBoomSummary(
  apiClient: BoomApiClient,
  options: BuildBoomSummaryOptions
): Promise<BoomSummary> {
  const maxVideos = Math.max(1, options.maxVideos ?? DEFAULT_MAX_VIDEOS);
  const minGameSeconds = Math.max(
    0,
    options.minGameSeconds ?? DEFAULT_MIN_GAME_SECONDS
  );
  const maxGames = Math.max(1, options.maxGames ?? DEFAULT_MAX_GAMES);
  const maxConcurrentVideos = Math.max(
    1,
    options.maxConcurrentVideos ?? DEFAULT_MAX_CONCURRENT_VIDEOS
  );
  const fetchFn = options.fetchFn ?? fetch;
  const totals = new Map<string, number>();
  const videos = await fetchRecentArchiveVideos(
    apiClient,
    options.broadcasterId,
    maxVideos
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

  return { analyzedVideos: videos.length, games };
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
  if (summary.games.length === 0) {
    return `最近${summary.analyzedVideos}配信で1時間以上のゲームは見つかりませんでした。`;
  }

  const games = summary.games
    .map((game) => `${game.gameName} ${formatDuration(game.totalSeconds)}`)
    .join(" / ");
  return `最近${summary.analyzedVideos}配信のゲーム時間(1時間以上): ${games}`;
}
