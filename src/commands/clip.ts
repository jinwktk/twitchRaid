import type { HelixClip } from "@twurple/api";
import logger from "../utils/logger";

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
    getUserById?(userId: string): Promise<{ creationDate: Date } | null>;
  };
}

export interface SelectClipOptions {
  recentClipIds?: readonly string[];
  random?: () => number;
  oldestClipDate?: Date;
  now?: Date;
  windowDays?: number;
  splitThreshold?: number;
}

interface ClipDateWindow {
  start: Date;
  end: Date;
}

const DEFAULT_OLDEST_CLIP_DATE = new Date("2016-05-01T00:00:00.000Z");
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_SPLIT_THRESHOLD = 950;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ログイン名からユーザーIDを解決する
 */
async function resolveUserId(
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
  clips: HelixClip[],
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

export function buildClipDateWindows(
  oldest: Date,
  now: Date,
  windowDays = DEFAULT_WINDOW_DAYS
): ClipDateWindow[] {
  const windows: ClipDateWindow[] = [];
  const windowMs = Math.max(1, windowDays) * ONE_DAY_MS;
  let startMs = oldest.getTime();
  const nowMs = now.getTime();

  while (startMs < nowMs) {
    const endMs = Math.min(startMs + windowMs, nowMs);
    windows.push({
      start: new Date(startMs),
      end: new Date(endMs),
    });
    startMs = endMs;
  }

  return windows;
}

async function resolveOldestClipDate(
  apiClient: ClipApiClient,
  broadcasterId: string,
  explicitOldest?: Date
): Promise<Date> {
  if (explicitOldest) {
    return explicitOldest;
  }

  try {
    const broadcaster = await apiClient.users.getUserById?.(broadcasterId);
    return broadcaster?.creationDate ?? DEFAULT_OLDEST_CLIP_DATE;
  } catch (e) {
    logger.warn(`⚠️ broadcaster作成日時の取得に失敗しました: ${e}`);
    return DEFAULT_OLDEST_CLIP_DATE;
  }
}

async function fetchWindowClips(
  apiClient: ClipApiClient,
  broadcasterId: string,
  window: ClipDateWindow
): Promise<HelixClip[]> {
  const paginator = apiClient.clips.getClipsForBroadcasterPaginated(
    broadcasterId,
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

async function fetchWindowClipsWithSplit(
  apiClient: ClipApiClient,
  broadcasterId: string,
  window: ClipDateWindow,
  splitThreshold: number
): Promise<HelixClip[]> {
  const clips = await fetchWindowClips(apiClient, broadcasterId, window);
  const canSplit = window.end.getTime() - window.start.getTime() > ONE_DAY_MS;

  if (clips.length < splitThreshold || !canSplit) {
    return clips;
  }

  const middle = new Date(
    Math.floor((window.start.getTime() + window.end.getTime()) / 2)
  );
  const firstHalf = await fetchWindowClipsWithSplit(
    apiClient,
    broadcasterId,
    { start: window.start, end: middle },
    splitThreshold
  );
  const secondHalf = await fetchWindowClipsWithSplit(
    apiClient,
    broadcasterId,
    { start: middle, end: window.end },
    splitThreshold
  );

  return [...firstHalf, ...secondHalf];
}

async function fetchBroadcasterClips(
  apiClient: ClipApiClient,
  broadcasterId: string,
  options: SelectClipOptions
): Promise<HelixClip[]> {
  const oldest = await resolveOldestClipDate(
    apiClient,
    broadcasterId,
    options.oldestClipDate
  );
  const now = options.now ?? new Date();
  const windows = buildClipDateWindows(oldest, now, options.windowDays);
  const byId = new Map<string, HelixClip>();

  for (const window of windows) {
    const clips = await fetchWindowClipsWithSplit(
      apiClient,
      broadcasterId,
      window,
      options.splitThreshold ?? DEFAULT_SPLIT_THRESHOLD
    );
    for (const clip of clips) {
      byId.set(clip.id, clip);
    }
  }

  logger.info(
    `🎬 clip候補取得: windows=${windows.length} unique=${byId.size}`
  );
  return [...byId.values()];
}

/**
 * ランダムなクリップを選択する
 * Twitch APIの単純ページング上限を避けるため、日付窓ごとにページングする
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
      resolvedCreatorId = await resolveUserId(apiClient, creatorName) ?? undefined;
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

    const matched: HelixClip[] = [];
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
