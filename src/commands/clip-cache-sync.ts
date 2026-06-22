import type { HelixClip } from "@twurple/api";
import logger from "../utils/logger";
import { type CachedClip, ClipCacheStore } from "./clip-cache-store";

interface ClipSyncApiClient {
  clips: {
    getClipsForBroadcasterPaginated(
      broadcasterId: string,
      filter?: { startDate?: string; endDate?: string; isFeatured?: boolean }
    ): AsyncIterable<HelixClip>;
    getClipsByIds?(ids: string[]): Promise<HelixClip[]>;
  };
  games?: ClipSyncGameApi;
}

interface ClipSyncGameApi {
  getGamesByIds(ids: string[]): Promise<Array<{ id: string; name: string }>>;
}

export interface ClipDateWindow {
  start: Date;
  end: Date;
}

interface ClipCacheSyncOptions {
  apiClient: ClipSyncApiClient;
  broadcasterId: string;
  store: ClipCacheStore;
  helixClientId?: string;
  helixAccessToken?: string;
  helixAccessTokenProvider?: () => string;
  helixFetchFn?: ClipSyncHelixFetchLike;
  helixPageSize?: number;
  oldestClipDate?: Date;
  fullWindowDays?: number;
  fullTailWindowDays?: number;
  fullWindowRetryAttempts?: number;
  fullWindowRetryDelayMs?: number;
  splitThreshold?: number;
  recentWindowMinutes?: number;
  recentUnavailableGraceMinutes?: number;
  recentSyncIntervalMs?: number;
  staleRecentSyncMs?: number;
  dailyReconcileIntervalMs?: number;
  dailyReconcileCheckIntervalMs?: number;
  isStreamLive?: () => boolean;
  onRecentSyncComplete?: (result: {
    syncedAt: string;
    saved: number;
    unavailable: number;
  }) => Promise<void> | void;
}

interface SyncWindowOptions {
  reconcileMissing?: boolean;
}

interface FullBackfillOptions {
  reconcileMissing?: boolean;
}

interface ClipSyncHelixResponse {
  ok: boolean;
  status?: number;
  text(): Promise<string>;
}

type ClipSyncHelixFetchLike = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<ClipSyncHelixResponse>;

interface HelixClipSyncPage {
  data: HelixClip[];
  cursor: string | null;
}

interface HelixGameSyncItem {
  id: string;
  name: string;
}

const DEFAULT_OLDEST_CLIP_DATE = new Date("2016-05-01T00:00:00.000Z");
const DEFAULT_FULL_WINDOW_DAYS = 30;
const DEFAULT_FULL_TAIL_WINDOW_DAYS = 3;
const DEFAULT_FULL_WINDOW_RETRY_ATTEMPTS = 2;
const DEFAULT_FULL_WINDOW_RETRY_DELAY_MS = 1000;
const DEFAULT_SPLIT_THRESHOLD = 950;
const DEFAULT_HELIX_PAGE_SIZE = 100;
const DEFAULT_RECENT_WINDOW_MINUTES = 6 * 60;
const DEFAULT_RECENT_UNAVAILABLE_GRACE_MINUTES = 2 * 60;
const DEFAULT_RECENT_SYNC_INTERVAL_MS = 60 * 1000;
const DEFAULT_STALE_RECENT_SYNC_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_RECONCILE_INTERVAL_MS = ONE_DAY_MS;
const DEFAULT_DAILY_RECONCILE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RECENT_SYNC_STATE_KEY = "recent_sync_at";
export const DAILY_RECONCILE_STATE_KEY = "daily_reconcile_at";
const DAILY_RECONCILE_ATTEMPT_STATE_KEY = "daily_reconcile_attempt_at";

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canSplitWindow(window: ClipDateWindow): boolean {
  return window.end.getTime() - window.start.getTime() > ONE_DAY_MS;
}

function splitWindow(window: ClipDateWindow): [ClipDateWindow, ClipDateWindow] {
  const middle = new Date(
    Math.floor((window.start.getTime() + window.end.getTime()) / 2)
  );
  return [
    { start: window.start, end: middle },
    { start: middle, end: window.end },
  ];
}

export function buildClipDateWindows(
  oldest: Date,
  now: Date,
  windowDays = DEFAULT_FULL_WINDOW_DAYS,
  tailWindowDays = windowDays
): ClipDateWindow[] {
  const windows: ClipDateWindow[] = [];
  const normalizedWindowDays = Math.max(1, windowDays);
  const normalizedTailWindowDays = Math.max(
    1,
    Math.min(normalizedWindowDays, tailWindowDays)
  );
  const windowMs = normalizedWindowDays * ONE_DAY_MS;
  const tailWindowMs = normalizedTailWindowDays * ONE_DAY_MS;
  let startMs = oldest.getTime();
  const nowMs = now.getTime();

  while (startMs < nowMs) {
    const endMs = Math.min(startMs + windowMs, nowMs);
    if (endMs === nowMs && tailWindowMs < windowMs) {
      while (startMs < nowMs) {
        const tailEndMs = Math.min(startMs + tailWindowMs, nowMs);
        windows.push({
          start: new Date(startMs),
          end: new Date(tailEndMs),
        });
        startMs = tailEndMs;
      }
      break;
    }

    windows.push({ start: new Date(startMs), end: new Date(endMs) });
    startMs = endMs;
  }

  return windows;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseHelixClipSyncPage(raw: unknown): HelixClipSyncPage {
  const root = asRecord(raw);
  const rawData = Array.isArray(root?.["data"]) ? root["data"] : [];
  const clips: HelixClip[] = [];

  for (const item of rawData) {
    const clip = asRecord(item);
    if (!clip) continue;

    const id = readString(clip, "id");
    const url = readString(clip, "url");
    const title = readString(clip, "title");
    const creatorId = readString(clip, "creator_id");
    const creatorDisplayName = readString(clip, "creator_name");
    if (!id || !url || !title || !creatorId || !creatorDisplayName) continue;

    const createdAt = readString(clip, "created_at");
    const creationDate = createdAt ? new Date(createdAt) : undefined;
    const normalizedCreationDate =
      creationDate && !Number.isNaN(creationDate.getTime())
        ? creationDate
        : undefined;

    clips.push({
      id,
      url,
      title,
      creatorId,
      creatorDisplayName,
      gameId: readString(clip, "game_id"),
      creationDate: normalizedCreationDate,
      views: readNumber(clip, "view_count"),
      thumbnailUrl: readString(clip, "thumbnail_url"),
    } as HelixClip);
  }

  const pagination = asRecord(root?.["pagination"]);
  const cursor = pagination ? readString(pagination, "cursor") : "";
  return {
    data: clips,
    cursor: cursor || null,
  };
}

function parseHelixGameSyncItems(raw: unknown): HelixGameSyncItem[] {
  const root = asRecord(raw);
  const rawData = Array.isArray(root?.["data"]) ? root["data"] : [];
  const games: HelixGameSyncItem[] = [];

  for (const item of rawData) {
    const game = asRecord(item);
    if (!game) continue;

    const id = readString(game, "id");
    const name = readString(game, "name");
    if (id && name) {
      games.push({ id, name });
    }
  }

  return games;
}

export function clipToCachedClip(clip: HelixClip): CachedClip {
  return {
    id: clip.id,
    url: clip.url,
    title: clip.title,
    creatorId: clip.creatorId,
    creatorDisplayName: clip.creatorDisplayName,
    gameId: clip.gameId || null,
    gameName: null,
    thumbnailUrl: clip.thumbnailUrl || null,
    createdAt: clip.creationDate?.toISOString() ?? null,
    views: clip.views ?? null,
  };
}

export async function clipsToCachedClips(
  clips: HelixClip[],
  gameApi?: ClipSyncGameApi
): Promise<CachedClip[]> {
  const cachedClips = clips.map(clipToCachedClip);
  if (!gameApi || cachedClips.length === 0) return cachedClips;

  const gameIds = [
    ...new Set(
      cachedClips
        .map((clip) => clip.gameId)
        .filter((gameId): gameId is string => Boolean(gameId))
    ),
  ];
  if (gameIds.length === 0) return cachedClips;

  try {
    const games = (
      await Promise.all(
        chunkArray(gameIds, 100).map((ids) => gameApi.getGamesByIds(ids))
      )
    ).flat();
    const gameNamesById = new Map(games.map((game) => [game.id, game.name]));
    return cachedClips.map((clip) => ({
      ...clip,
      gameName: clip.gameId ? gameNamesById.get(clip.gameId) ?? null : null,
    }));
  } catch (e) {
    logger.warn(`⚠️ Clipゲーム名取得失敗: ${e}`);
    return cachedClips;
  }
}

export class ClipCacheSynchronizer {
  private readonly oldestClipDate: Date;
  private readonly fullWindowDays: number;
  private readonly fullTailWindowDays: number;
  private readonly fullWindowRetryAttempts: number;
  private readonly fullWindowRetryDelayMs: number;
  private readonly splitThreshold: number;
  private readonly recentWindowMinutes: number;
  private readonly recentUnavailableGraceMinutes: number;
  private readonly recentSyncIntervalMs: number;
  private readonly staleRecentSyncMs: number;
  private readonly dailyReconcileIntervalMs: number;
  private readonly dailyReconcileCheckIntervalMs: number;
  private readonly helixClientId: string;
  private readonly helixAccessTokenProvider: () => string;
  private readonly helixFetchFn: ClipSyncHelixFetchLike;
  private readonly helixPageSize: number;
  private recentSyncTimer: ReturnType<typeof setInterval> | null = null;
  private dailyReconcileTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private fullScanRunning = false;
  private recentSyncRunning = false;
  private dailyReconcileRunning = false;
  private fullBackfillPromise: Promise<boolean> | null = null;
  private recentSyncPromise: Promise<number> | null = null;
  private dailyReconcilePromise: Promise<void> | null = null;

  constructor(private readonly options: ClipCacheSyncOptions) {
    this.oldestClipDate = options.oldestClipDate ?? DEFAULT_OLDEST_CLIP_DATE;
    this.fullWindowDays = options.fullWindowDays ?? DEFAULT_FULL_WINDOW_DAYS;
    this.fullTailWindowDays = Math.max(
      1,
      options.fullTailWindowDays ??
        Math.min(DEFAULT_FULL_TAIL_WINDOW_DAYS, this.fullWindowDays)
    );
    this.fullWindowRetryAttempts = Math.max(
      0,
      Math.floor(
        options.fullWindowRetryAttempts ?? DEFAULT_FULL_WINDOW_RETRY_ATTEMPTS
      )
    );
    this.fullWindowRetryDelayMs = Math.max(
      0,
      options.fullWindowRetryDelayMs ?? DEFAULT_FULL_WINDOW_RETRY_DELAY_MS
    );
    this.splitThreshold = options.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD;
    this.recentWindowMinutes =
      options.recentWindowMinutes ?? DEFAULT_RECENT_WINDOW_MINUTES;
    this.recentUnavailableGraceMinutes =
      options.recentUnavailableGraceMinutes ??
      DEFAULT_RECENT_UNAVAILABLE_GRACE_MINUTES;
    this.recentSyncIntervalMs =
      options.recentSyncIntervalMs ?? DEFAULT_RECENT_SYNC_INTERVAL_MS;
    this.staleRecentSyncMs =
      options.staleRecentSyncMs ?? DEFAULT_STALE_RECENT_SYNC_MS;
    this.dailyReconcileIntervalMs =
      options.dailyReconcileIntervalMs ?? DEFAULT_DAILY_RECONCILE_INTERVAL_MS;
    this.dailyReconcileCheckIntervalMs =
      options.dailyReconcileCheckIntervalMs ??
      DEFAULT_DAILY_RECONCILE_CHECK_INTERVAL_MS;
    this.helixClientId = options.helixClientId?.trim() ?? "";
    const staticHelixAccessToken = options.helixAccessToken?.trim() ?? "";
    this.helixAccessTokenProvider =
      options.helixAccessTokenProvider ?? (() => staticHelixAccessToken);
    this.helixFetchFn =
      options.helixFetchFn ?? ((url, init) => fetch(url, init));
    this.helixPageSize = Math.max(
      1,
      Math.min(
        DEFAULT_HELIX_PAGE_SIZE,
        Math.floor(options.helixPageSize ?? DEFAULT_HELIX_PAGE_SIZE)
      )
    );
  }

  start(): void {
    this.recentSyncPromise = this.syncRecentClips();
    this.fullBackfillPromise = this.runFullBackfill();
    this.recentSyncTimer = setInterval(() => {
      this.recentSyncPromise = this.syncRecentClips();
    }, this.recentSyncIntervalMs);
    this.dailyReconcileTimer = setInterval(() => {
      this.dailyReconcilePromise = this.runDailyReconcileIfDue();
    }, this.dailyReconcileCheckIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.recentSyncTimer) {
      clearInterval(this.recentSyncTimer);
      this.recentSyncTimer = null;
    }
    if (this.dailyReconcileTimer) {
      clearInterval(this.dailyReconcileTimer);
      this.dailyReconcileTimer = null;
    }

    const pending: Promise<unknown>[] = [];
    if (this.recentSyncPromise) pending.push(this.recentSyncPromise);
    if (this.fullBackfillPromise) pending.push(this.fullBackfillPromise);
    if (this.dailyReconcilePromise) pending.push(this.dailyReconcilePromise);
    await Promise.allSettled(pending);
  }

  syncRecentIfStale(): void {
    const lastSynced = this.options.store.getSyncState(RECENT_SYNC_STATE_KEY);
    const lastSyncedMs = lastSynced ? Date.parse(lastSynced) : 0;
    if (Date.now() - lastSyncedMs >= this.staleRecentSyncMs) {
      this.recentSyncPromise = this.syncRecentClips();
    }
  }

  async syncRecentClips(now = new Date()): Promise<number> {
    if (this.recentSyncRunning) return 0;
    this.recentSyncRunning = true;

    try {
      const start = new Date(
        now.getTime() - this.recentWindowMinutes * 60 * 1000
      );
      const clips = await this.fetchWindow({ start, end: now });
      const cachedClips = await clipsToCachedClips(
        clips,
        this.gameApiForCache()
      );
      let saved = this.options.store.saveClips(cachedClips);
      saved += this.restoreUnavailableClipsInRecentGrace(now);
      const unavailable = await this.markUnavailableRecentMissingClips(
        start,
        now,
        clips
      );
      this.options.store.setSyncState(
        RECENT_SYNC_STATE_KEY,
        now.toISOString()
      );
      logger.info(
        `🎬 直近clip同期完了: fetched=${clips.length}, saved=${saved}, unavailable=${unavailable}, windowMinutes=${this.recentWindowMinutes}`
      );
      try {
        await this.options.onRecentSyncComplete?.({
          syncedAt: now.toISOString(),
          saved,
          unavailable,
        });
      } catch (callbackError) {
        logger.warn(`⚠️ 直近clip同期後処理失敗: ${callbackError}`);
      }
      return saved;
    } catch (e) {
      logger.warn(`⚠️ 直近clip同期失敗: ${e}`);
      return 0;
    } finally {
      this.recentSyncRunning = false;
    }
  }

  async runFullBackfill(
    now = new Date(),
    options: FullBackfillOptions = {}
  ): Promise<boolean> {
    if (this.fullScanRunning) return false;
    this.fullScanRunning = true;

    try {
      const windows = buildClipDateWindows(
        this.oldestClipDate,
        now,
        this.fullWindowDays,
        this.fullTailWindowDays
      );
      const scanLabel = options.reconcileMissing
        ? "clip全期間再走査"
        : "clip全期間バックフィル";
      logger.info(`🎬 ${scanLabel}開始: windows=${windows.length}`);
      let failedWindows = 0;

      for (const window of windows) {
        if (this.stopped) return false;
        const completed = await this.syncWindowWithRetry(
          window,
          {
            reconcileMissing: options.reconcileMissing,
          },
          scanLabel
        );
        if (!completed) failedWindows += 1;
        if (this.stopped) return false;
      }

      if (failedWindows > 0) {
        logger.warn(
          `⚠️ ${scanLabel}は一部未完了です: failedWindows=${failedWindows}, windows=${windows.length}`
        );
        return false;
      }

      logger.info(
        `🎬 ${scanLabel}完了: total=${this.options.store.clipCount()}`
      );
      return true;
    } catch (e) {
      logger.warn(`⚠️ clip全期間バックフィル失敗: ${e}`);
      return false;
    } finally {
      this.fullScanRunning = false;
    }
  }

  async runDailyReconcileIfDue(now = new Date()): Promise<void> {
    if (this.dailyReconcileRunning) return;
    if (this.options.isStreamLive?.()) {
      logger.info("🎬 配信中のためclip日次再走査をスキップします。");
      return;
    }

    const lastReconciled =
      this.options.store.getSyncState(DAILY_RECONCILE_STATE_KEY);
    const lastReconciledMs = lastReconciled ? Date.parse(lastReconciled) : 0;
    const lastAttempted =
      this.options.store.getSyncState(DAILY_RECONCILE_ATTEMPT_STATE_KEY);
    const lastAttemptedMs = lastAttempted ? Date.parse(lastAttempted) : 0;
    const lastGateMs = Math.max(lastReconciledMs, lastAttemptedMs);
    if (now.getTime() - lastGateMs < this.dailyReconcileIntervalMs) {
      return;
    }
    if (this.fullScanRunning) {
      logger.info(
        "🎬 clip日次再走査は別の全期間同期中または未完了のため延期します。"
      );
      return;
    }

    this.dailyReconcileRunning = true;
    try {
      this.options.store.setSyncState(
        DAILY_RECONCILE_ATTEMPT_STATE_KEY,
        now.toISOString()
      );
      const completed = await this.runFullBackfill(now, {
        reconcileMissing: true,
      });
      if (!completed) {
        logger.info(
          "🎬 clip日次再走査は別の全期間同期中または未完了のため延期します。"
        );
        return;
      }
      this.options.store.setSyncState(
        DAILY_RECONCILE_STATE_KEY,
        now.toISOString()
      );
    } finally {
      this.dailyReconcileRunning = false;
    }
  }

  async syncWindow(
    window: ClipDateWindow,
    options: SyncWindowOptions = {}
  ): Promise<number> {
    const startAt = window.start.toISOString();
    const endAt = window.end.toISOString();

    if (
      !options.reconcileMissing &&
      this.options.store.isWindowCompleted(startAt, endAt)
    ) {
      return 0;
    }

    const clips = await this.fetchWindow(window);
    const canSplit = canSplitWindow(window);

    if (clips.length >= this.splitThreshold && canSplit) {
      const [firstWindow, secondWindow] = splitWindow(window);
      const first = await this.syncWindow(
        firstWindow,
        options
      );
      const second = await this.syncWindow(
        secondWindow,
        options
      );
      return first + second;
    }

    const cachedClips = await clipsToCachedClips(
      clips,
      this.gameApiForCache()
    );
    const saved = this.options.store.saveClips(cachedClips);
    const unavailable = options.reconcileMissing
      ? this.options.store.markMissingClipsUnavailable(
          startAt,
          endAt,
          clips.map((clip) => clip.id)
        )
      : 0;
    this.options.store.markWindowCompleted(startAt, endAt, clips.length);
    logger.info(
      `🎬 clip期間同期完了: ${startAt} - ${endAt}, clips=${clips.length}, unavailable=${unavailable}`
    );
    return saved;
  }

  private async syncWindowWithRetry(
    window: ClipDateWindow,
    options: SyncWindowOptions,
    scanLabel: string
  ): Promise<boolean> {
    const startAt = window.start.toISOString();
    const endAt = window.end.toISOString();
    const maxAttempts = this.fullWindowRetryAttempts + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.syncWindow(window, options);
        return true;
      } catch (e) {
        if (attempt >= maxAttempts) {
          if (canSplitWindow(window)) {
            const splitCompleted = await this.syncSplitWindowAfterFailure(
              window,
              options,
              scanLabel
            );
            if (splitCompleted) {
              return true;
            }
          }
          logger.warn(
            `⚠️ ${scanLabel}期間同期をスキップ: ${startAt} - ${endAt}, attempts=${attempt}, error=${e}`
          );
          return false;
        }

        logger.info(
          `🎬 ${scanLabel}期間同期失敗、再試行します: ${startAt} - ${endAt}, attempt=${attempt}/${maxAttempts}, error=${e}`
        );
        await delay(this.fullWindowRetryDelayMs);
      }
    }

    return false;
  }

  private async syncSplitWindowAfterFailure(
    window: ClipDateWindow,
    options: SyncWindowOptions,
    scanLabel: string
  ): Promise<boolean> {
    const startAt = window.start.toISOString();
    const endAt = window.end.toISOString();
    const [firstWindow, secondWindow] = splitWindow(window);
    logger.info(
      `🎬 ${scanLabel}期間同期失敗のため期間窓を分割します: ${startAt} - ${endAt}`
    );

    const firstCompleted = await this.syncWindowWithRetry(
      firstWindow,
      options,
      scanLabel
    );
    if (this.stopped) return false;
    const secondCompleted = await this.syncWindowWithRetry(
      secondWindow,
      options,
      scanLabel
    );

    if (!firstCompleted || !secondCompleted) {
      return false;
    }

    this.options.store.markWindowCompleted(startAt, endAt, 0);
    logger.info(
      `🎬 ${scanLabel}分割期間同期完了: ${startAt} - ${endAt}`
    );
    return true;
  }

  private async fetchWindow(window: ClipDateWindow): Promise<HelixClip[]> {
    const accessToken = this.helixAccessTokenProvider().trim();
    if (this.helixClientId && accessToken) {
      return this.fetchWindowByHelixIdentity(window, accessToken);
    }

    const paginator =
      this.options.apiClient.clips.getClipsForBroadcasterPaginated(
        this.options.broadcasterId,
        {
          startDate: window.start.toISOString(),
          endDate: window.end.toISOString(),
        }
      );
    const clips: HelixClip[] = [];

    for await (const clip of paginator) {
      clips.push(clip);
    }

    return clips;
  }

  private async fetchWindowByHelixIdentity(
    window: ClipDateWindow,
    accessToken: string
  ): Promise<HelixClip[]> {
    const clips: HelixClip[] = [];
    let after: string | null = null;

    while (true) {
      const page = await this.fetchHelixClipIdentityPage(
        window,
        accessToken,
        after
      );
      clips.push(...page.data);

      if (!page.cursor || page.cursor === after) {
        return clips;
      }
      after = page.cursor;
    }
  }

  private gameApiForCache(): ClipSyncGameApi | undefined {
    if (!this.helixClientId) return this.options.apiClient.games;

    return {
      getGamesByIds: async (ids) => {
        const accessToken = this.helixAccessTokenProvider().trim();
        if (!accessToken) {
          return this.options.apiClient.games?.getGamesByIds(ids) ?? [];
        }
        return this.fetchGamesByHelixIdentity(ids, accessToken);
      },
    };
  }

  private buildHelixHeaders(accessToken: string): Record<string, string> {
    return {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": this.helixClientId,
    };
  }

  private async fetchHelixClipIdentityPage(
    window: ClipDateWindow,
    accessToken: string,
    after: string | null
  ): Promise<HelixClipSyncPage> {
    const url = new URL("https://api.twitch.tv/helix/clips");
    url.searchParams.set("broadcaster_id", this.options.broadcasterId);
    url.searchParams.set("started_at", window.start.toISOString());
    url.searchParams.set("ended_at", window.end.toISOString());
    url.searchParams.set("first", String(this.helixPageSize));
    if (after) {
      url.searchParams.set("after", after);
    }

    const response = await this.helixFetchFn(url.toString(), {
      headers: this.buildHelixHeaders(accessToken),
    });
    if (!response.ok) {
      throw new Error(
        `Twitch Helix clips request failed: status=${response.status ?? "unknown"}`
      );
    }

    return parseHelixClipSyncPage(JSON.parse(await response.text()));
  }

  private async fetchGamesByHelixIdentity(
    ids: string[],
    accessToken: string
  ): Promise<HelixGameSyncItem[]> {
    if (ids.length === 0) return [];

    const url = new URL("https://api.twitch.tv/helix/games");
    for (const id of ids) {
      url.searchParams.append("id", id);
    }

    const response = await this.helixFetchFn(url.toString(), {
      headers: this.buildHelixHeaders(accessToken),
    });
    if (!response.ok) {
      throw new Error(
        `Twitch Helix games request failed: status=${response.status ?? "unknown"}`
      );
    }

    return parseHelixGameSyncItems(JSON.parse(await response.text()));
  }

  private async markUnavailableRecentMissingClips(
    start: Date,
    end: Date,
    fetchedClips: HelixClip[]
  ): Promise<number> {
    const clipApi = this.options.apiClient.clips;
    if (!clipApi.getClipsByIds) return 0;
    const getClipsByIds = clipApi.getClipsByIds.bind(clipApi);

    const fetchedIds = new Set(fetchedClips.map((clip) => clip.id));
    const graceEnd = new Date(
      end.getTime() - this.recentUnavailableGraceMinutes * 60 * 1000
    );
    if (graceEnd.getTime() <= start.getTime()) return 0;
    const cachedIds = this.options.store.listAvailableClipIdsCreatedBetween(
      start.toISOString(),
      graceEnd.toISOString()
    );
    const missingIds = cachedIds.filter((id) => !fetchedIds.has(id));
    if (missingIds.length === 0) return 0;

    try {
      const verifiedClips = (
        await Promise.all(
          chunkArray(missingIds, 100).map((ids) => getClipsByIds(ids))
        )
      )
        .flat();
      const verifiedIds = new Set(verifiedClips.map((clip) => clip.id));
      if (verifiedClips.length > 0) {
        const cachedClips = await clipsToCachedClips(
          verifiedClips,
          this.options.apiClient.games
        );
        this.options.store.saveClips(cachedClips);
      }

      const unavailableIds = missingIds.filter((id) => !verifiedIds.has(id));
      return this.options.store.markClipsUnavailableByIds(
        unavailableIds,
        end.toISOString()
      );
    } catch (e) {
      logger.warn(`⚠️ 直近clip削除確認失敗: ${e}`);
      return 0;
    }
  }

  private restoreUnavailableClipsInRecentGrace(end: Date): number {
    const graceStart = new Date(
      end.getTime() - this.recentUnavailableGraceMinutes * 60 * 1000
    );
    return this.options.store.restoreUnavailableClipsCreatedAfter(
      graceStart.toISOString(),
      end.toISOString()
    );
  }
}
