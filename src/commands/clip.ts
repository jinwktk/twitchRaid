import { ApiClient } from "@twurple/api";
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
 * ランダムなクリップを選択する
 */
export async function selectClip(
  apiClient: ApiClient,
  broadcasterId: string,
  creatorId?: string,
  creatorName?: string
): Promise<ClipInfo | null> {
  try {
    // creatorNameが指定された場合、ユーザーIDに変換して比較する
    // （Clips APIは表示名のみ返すため、ログイン名との直接比較は不確実）
    let resolvedCreatorId = creatorId;
    if (!resolvedCreatorId && creatorName) {
      resolvedCreatorId = await resolveUserId(apiClient, creatorName) ?? undefined;
      if (!resolvedCreatorId) {
        logger.warn(`⚠️ ユーザー ${creatorName} のID解決に失敗。表示名で検索します。`);
      }
    }

    const clips = await apiClient.clips.getClipsForBroadcaster(broadcasterId, {
      limit: 100,
    });

    let filtered = clips.data;

    if (resolvedCreatorId || creatorName) {
      filtered = filtered.filter((clip) => {
        if (resolvedCreatorId && clip.creatorId === resolvedCreatorId) return true;
        // フォールバック: ID解決できなかった場合のみ表示名で比較
        if (
          !resolvedCreatorId &&
          creatorName &&
          clip.creatorDisplayName.toLowerCase() === creatorName.toLowerCase()
        ) {
          return true;
        }
        return false;
      });
    }

    if (filtered.length === 0) return null;

    const randomIdx = Math.floor(Math.random() * filtered.length);
    const clip = filtered[randomIdx];

    return {
      url: clip.url,
      id: clip.id,
      title: clip.title,
    };
  } catch (e) {
    logger.error(`❌ Failed to fetch clips: ${e}`);
    return null;
  }
}
