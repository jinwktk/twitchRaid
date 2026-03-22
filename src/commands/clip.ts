import { ApiClient, type HelixClip } from "@twurple/api";
import logger from "../utils/logger";

interface ClipInfo {
  url: string;
  id: string;
  title: string;
}

/**
 * ログイン名からユーザーIDを解決する
 */
async function resolveUserId(
  apiClient: ApiClient,
  loginName: string
): Promise<string | null> {
  try {
    const user = await apiClient.users.getUserByName(loginName);
    return user?.id ?? null;
  } catch (e) {
    logger.error(`❌ ユーザーID解決失敗 (${loginName}): ${e}`);
    return null;
  }
}

/**
 * クリップ配列からランダムに1つ選択してClipInfoを返す
 */
function pickRandom(clips: HelixClip[]): ClipInfo | null {
  if (clips.length === 0) return null;
  const clip = clips[Math.floor(Math.random() * clips.length)];
  return { url: clip.url, id: clip.id, title: clip.title };
}

/**
 * ランダムなクリップを選択する
 * creatorName指定時はページネーションで最大500件まで検索する
 */
export async function selectClip(
  apiClient: ApiClient,
  broadcasterId: string,
  creatorId?: string,
  creatorName?: string
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

    // クリエイターフィルタなし: トップ100件からランダム
    if (!needsCreatorFilter) {
      const clips = await apiClient.clips.getClipsForBroadcaster(broadcasterId, {
        limit: 100,
      });
      return pickRandom(clips.data);
    }

    // クリエイターフィルタあり: ページネーションで最大500件を検索
    const matched: HelixClip[] = [];
    const paginator = apiClient.clips.getClipsForBroadcasterPaginated(broadcasterId);
    let fetched = 0;
    const maxFetch = 500;

    for await (const clip of paginator) {
      fetched++;
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
      if (fetched >= maxFetch) break;
    }

    logger.info(
      `🎬 myclip検索: ${fetched}件中 ${matched.length}件がマッチ (user=${creatorName ?? creatorId})`
    );

    return pickRandom(matched);
  } catch (e) {
    logger.error(`❌ Failed to fetch clips: ${e}`);
    return null;
  }
}
