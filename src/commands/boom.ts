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
const DEFAULT_MAX_VIDEOS = 20;
const DEFAULT_MIN_GAME_SECONDS = 60 * 60;
const DEFAULT_MAX_GAMES = 6;

const VIDEO_CHAPTER_QUERY = `
query VideoPlayer_ChapterSelectButtonVideo($videoID: ID!) {
  video(id: $videoID) {
    moments(first: 100, types: [GAME_CHANGE]) {
      edges {
        node {
          positionMilliseconds
          durationMilliseconds
          details {
            ... on GameChangeMoment {
              game {
                displayName
                name
              }
            }
          }
        }
      }
    }
  }
}
`;

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
  const response = await fetchFn(TWITCH_GQL_URL, {
    method: "POST",
    headers: {
      "Client-ID": gqlClientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName: "VideoPlayer_ChapterSelectButtonVideo",
      query: VIDEO_CHAPTER_QUERY,
      variables: { videoID: videoId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Twitch GraphQL request failed: ${response.status ?? "unknown"}`);
  }

  return response.json();
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
  const fetchFn = options.fetchFn ?? fetch;
  const totals = new Map<string, number>();
  const videos = await fetchRecentArchiveVideos(
    apiClient,
    options.broadcasterId,
    maxVideos
  );

  for (const video of videos) {
    const response = await fetchVideoChapters(
      fetchFn,
      options.gqlClientId,
      video.id
    );
    for (const chapter of parseGameChapters(
      response,
      video.durationInSeconds
    )) {
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
