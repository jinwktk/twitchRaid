import {
  buildBoomSummary,
  type BoomApiClient,
  type FetchLike,
  type HelixFetchLike,
} from "./boom";

export interface StreamedGameCandidateOptions {
  broadcasterId: string;
  gqlClientId: string;
  fetchFn?: FetchLike;
  helixClientId?: string;
  helixAccessToken?: string;
  helixFetchFn?: HelixFetchLike;
  lookbackDays?: number;
  maxVideos?: number;
  maxGames?: number;
  maxConcurrentVideos?: number;
  now?: () => Date;
}

const DEFAULT_LOOKBACK_DAYS = 3650;
const DEFAULT_MAX_VIDEOS = 100;
const DEFAULT_MAX_GAMES = 500;

function uniqueGameNames(gameNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const gameName of gameNames) {
    const trimmed = gameName.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export async function buildStreamedGameCandidates(
  apiClient: BoomApiClient,
  options: StreamedGameCandidateOptions
): Promise<string[]> {
  const summary = await buildBoomSummary(apiClient, {
    broadcasterId: options.broadcasterId,
    gqlClientId: options.gqlClientId,
    fetchFn: options.fetchFn,
    helixClientId: options.helixClientId,
    helixAccessToken: options.helixAccessToken,
    helixFetchFn: options.helixFetchFn,
    lookbackDays: options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    maxVideos: options.maxVideos ?? DEFAULT_MAX_VIDEOS,
    minGameSeconds: 1,
    maxGames: options.maxGames ?? DEFAULT_MAX_GAMES,
    maxConcurrentVideos: options.maxConcurrentVideos,
    now: options.now,
  });

  return uniqueGameNames(summary.games.map((game) => game.gameName));
}

export function selectRandomStreamedGame(
  candidates: readonly string[],
  random: () => number = Math.random
): string | null {
  const games = uniqueGameNames(candidates);
  if (games.length === 0) return null;

  const index = Math.min(
    games.length - 1,
    Math.floor(Math.max(0, random()) * games.length)
  );
  return games[index];
}

export function formatGameSuggestion(gameName: string): string {
  return `ゲーム候補：${gameName.trim()}`;
}

export class StreamedGameCandidateCache {
  private candidates: string[] | null = null;
  private expiresAt = 0;

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async getOrLoad(loader: () => Promise<string[]>): Promise<string[]> {
    const currentTime = this.now();
    if (this.candidates && currentTime < this.expiresAt) {
      return this.candidates;
    }

    const candidates = await loader();
    this.candidates = candidates;
    this.expiresAt = currentTime + this.ttlMs;
    return candidates;
  }
}
