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

export interface SelectClipOptions {
  recentClipIds?: readonly string[];
  random?: () => number;
  maxFetch?: number;
}

const DEFAULT_MAX_FETCH = 1000;

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

export function selectCachedClip(
  store: ClipCacheStore,
  commandName: ClipCommandName,
  creatorName?: string,
  random: () => number = Math.random
): ClipInfo | null {
  return store.selectRandomClip({
    historyKey: clipHistoryKey(commandName, creatorName),
    creatorName,
    random,
  });
}

async function fetchBroadcasterClips(
  apiClient: ClipApiClient,
  broadcasterId: string,
  options: SelectClipOptions
): Promise<HelixClip[]> {
  const maxFetch = Math.max(1, options.maxFetch ?? DEFAULT_MAX_FETCH);
  const paginator = apiClient.clips.getClipsForBroadcasterPaginated(
    broadcasterId
  );
  const clips: HelixClip[] = [];

  for await (const clip of paginator) {
    clips.push(clip);
    if (clips.length >= maxFetch) {
      break;
    }
  }

  logger.info(`🎬 clip候補取得: fetched=${clips.length}, max=${maxFetch}`);
  return clips;
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
