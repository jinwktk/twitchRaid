import { ApiClient } from "@twurple/api";
import logger from "../utils/logger";

interface ClipInfo {
  url: string;
  id: string;
  title: string;
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
    const clips = await apiClient.clips.getClipsForBroadcaster(broadcasterId, {
      limit: 100,
    });

    let filtered = clips.data;

    if (creatorId || creatorName) {
      filtered = filtered.filter((clip) => {
        if (creatorId && clip.creatorId === creatorId) return true;
        if (
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
