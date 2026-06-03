import type { HelixClip } from "@twurple/api";
import logger from "../utils/logger";
import { type CachedClip, ClipCacheStore } from "./clip-cache-store";

interface ClipSyncApiClient {
  clips: {
    getClipsForBroadcasterPaginated(
      broadcasterId: string,
      filter?: { startDate?: string; endDate?: string; isFeatured?: boolean }
    ): AsyncIterable<HelixClip>;
  };
}

export interface ClipDateWindow {
  start: Date;
  end: Date;
}

interface ClipCacheSyncOptions {
  apiClient: ClipSyncApiClient;
  broadcasterId: string;
  store: ClipCacheStore;
  oldestClipDate?: Date;
  fullWindowDays?: number;
  splitThreshold?: number;
  recentWindowMinutes?: number;
  recentSyncIntervalMs?: number;
  staleRecentSyncMs?: number;
  onRecentSyncComplete?: (result: {
    syncedAt: string;
    saved: number;
  }) => Promise<void> | void;
}

const DEFAULT_OLDEST_CLIP_DATE = new Date("2016-05-01T00:00:00.000Z");
const DEFAULT_FULL_WINDOW_DAYS = 30;
const DEFAULT_SPLIT_THRESHOLD = 950;
const DEFAULT_RECENT_WINDOW_MINUTES = 60;
const DEFAULT_RECENT_SYNC_INTERVAL_MS = 60 * 1000;
const DEFAULT_STALE_RECENT_SYNC_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_SYNC_STATE_KEY = "recent_sync_at";

export function buildClipDateWindows(
  oldest: Date,
  now: Date,
  windowDays = DEFAULT_FULL_WINDOW_DAYS
): ClipDateWindow[] {
  const windows: ClipDateWindow[] = [];
  const windowMs = Math.max(1, windowDays) * ONE_DAY_MS;
  let startMs = oldest.getTime();
  const nowMs = now.getTime();

  while (startMs < nowMs) {
    const endMs = Math.min(startMs + windowMs, nowMs);
    windows.push({ start: new Date(startMs), end: new Date(endMs) });
    startMs = endMs;
  }

  return windows;
}

export function clipToCachedClip(clip: HelixClip): CachedClip {
  return {
    id: clip.id,
    url: clip.url,
    title: clip.title,
    creatorId: clip.creatorId,
    creatorDisplayName: clip.creatorDisplayName,
    createdAt: clip.creationDate?.toISOString() ?? null,
    views: clip.views ?? null,
  };
}

export class ClipCacheSynchronizer {
  private readonly oldestClipDate: Date;
  private readonly fullWindowDays: number;
  private readonly splitThreshold: number;
  private readonly recentWindowMinutes: number;
  private readonly recentSyncIntervalMs: number;
  private readonly staleRecentSyncMs: number;
  private recentSyncTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private fullScanRunning = false;
  private recentSyncRunning = false;
  private fullBackfillPromise: Promise<void> | null = null;
  private recentSyncPromise: Promise<number> | null = null;

  constructor(private readonly options: ClipCacheSyncOptions) {
    this.oldestClipDate = options.oldestClipDate ?? DEFAULT_OLDEST_CLIP_DATE;
    this.fullWindowDays = options.fullWindowDays ?? DEFAULT_FULL_WINDOW_DAYS;
    this.splitThreshold = options.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD;
    this.recentWindowMinutes =
      options.recentWindowMinutes ?? DEFAULT_RECENT_WINDOW_MINUTES;
    this.recentSyncIntervalMs =
      options.recentSyncIntervalMs ?? DEFAULT_RECENT_SYNC_INTERVAL_MS;
    this.staleRecentSyncMs =
      options.staleRecentSyncMs ?? DEFAULT_STALE_RECENT_SYNC_MS;
  }

  start(): void {
    this.recentSyncPromise = this.syncRecentClips();
    this.fullBackfillPromise = this.runFullBackfill();
    this.recentSyncTimer = setInterval(() => {
      this.recentSyncPromise = this.syncRecentClips();
    }, this.recentSyncIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.recentSyncTimer) {
      clearInterval(this.recentSyncTimer);
      this.recentSyncTimer = null;
    }

    const pending: Promise<unknown>[] = [];
    if (this.recentSyncPromise) pending.push(this.recentSyncPromise);
    if (this.fullBackfillPromise) pending.push(this.fullBackfillPromise);
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
      const saved = this.options.store.saveClips(clips.map(clipToCachedClip));
      this.options.store.setSyncState(
        RECENT_SYNC_STATE_KEY,
        now.toISOString()
      );
      logger.info(`🎬 直近clip同期完了: saved=${saved}`);
      try {
        await this.options.onRecentSyncComplete?.({
          syncedAt: now.toISOString(),
          saved,
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

  async runFullBackfill(now = new Date()): Promise<void> {
    if (this.fullScanRunning) return;
    this.fullScanRunning = true;

    try {
      const windows = buildClipDateWindows(
        this.oldestClipDate,
        now,
        this.fullWindowDays
      );
      logger.info(`🎬 clip全期間バックフィル開始: windows=${windows.length}`);

      for (const window of windows) {
        if (this.stopped) return;
        await this.syncWindow(window);
      }

      logger.info(
        `🎬 clip全期間バックフィル完了: total=${this.options.store.clipCount()}`
      );
    } catch (e) {
      logger.warn(`⚠️ clip全期間バックフィル失敗: ${e}`);
    } finally {
      this.fullScanRunning = false;
    }
  }

  async syncWindow(window: ClipDateWindow): Promise<number> {
    const startAt = window.start.toISOString();
    const endAt = window.end.toISOString();

    if (this.options.store.isWindowCompleted(startAt, endAt)) {
      return 0;
    }

    const clips = await this.fetchWindow(window);
    const canSplit = window.end.getTime() - window.start.getTime() > ONE_DAY_MS;

    if (clips.length >= this.splitThreshold && canSplit) {
      const middle = new Date(
        Math.floor((window.start.getTime() + window.end.getTime()) / 2)
      );
      const first = await this.syncWindow({ start: window.start, end: middle });
      const second = await this.syncWindow({ start: middle, end: window.end });
      return first + second;
    }

    const saved = this.options.store.saveClips(clips.map(clipToCachedClip));
    this.options.store.markWindowCompleted(startAt, endAt, clips.length);
    logger.info(
      `🎬 clip期間同期完了: ${startAt} - ${endAt}, clips=${clips.length}`
    );
    return saved;
  }

  private async fetchWindow(window: ClipDateWindow): Promise<HelixClip[]> {
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
}
