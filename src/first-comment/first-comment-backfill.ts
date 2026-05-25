import type { ApiClient } from "@twurple/api";
import type { HelixVideo } from "@twurple/api/lib/endpoints/video/HelixVideo";
import type { FirstCommentStore } from "./first-comment-store";
import type {
  TwitchVodCommentsClient,
  VodFirstComment,
} from "./vod-comments-client";

export interface ArchivedVideoSummary {
  id: string;
  streamId: string | null;
  title: string;
  creationDate: Date;
}

export interface FirstCommentBackfillResult {
  processed: number;
  saved: number;
  skipped: number;
  noComments: number;
  failed: number;
}

interface BackfillParams {
  videos: AsyncIterable<ArchivedVideoSummary>;
  store: FirstCommentStore;
  commentsClient: Pick<TwitchVodCommentsClient, "fetchFirstComment">;
}

export async function backfillArchivedFirstComments({
  videos,
  store,
  commentsClient,
}: BackfillParams): Promise<FirstCommentBackfillResult> {
  const result: FirstCommentBackfillResult = {
    processed: 0,
    saved: 0,
    skipped: 0,
    noComments: 0,
    failed: 0,
  };

  for await (const video of videos) {
    result.processed++;

    if (store.getByStreamKey(videoStreamKey(video.id))) {
      result.skipped++;
      continue;
    }

    if (video.streamId && store.getByStreamId(video.streamId)) {
      result.skipped++;
      continue;
    }

    try {
      const firstComment = await commentsClient.fetchFirstComment(video.id, {
        videoCreatedAt: video.creationDate.toISOString(),
      });
      if (!firstComment) {
        result.noComments++;
        continue;
      }

      const saved = store.saveFirstComment(
        archiveRecordFromComment(video, firstComment)
      );
      if (saved) {
        result.saved++;
      } else {
        result.skipped++;
      }
    } catch {
      result.failed++;
    }
  }

  return result;
}

export async function* archivedVideosFromApiClient(
  apiClient: ApiClient,
  broadcasterId: string
): AsyncIterable<ArchivedVideoSummary> {
  const paginator = apiClient.videos.getVideosByUserPaginated(broadcasterId, {
    type: "archive",
  });

  for await (const video of paginator) {
    yield videoSummary(video);
  }
}

function archiveRecordFromComment(
  video: ArchivedVideoSummary,
  firstComment: VodFirstComment
) {
  return {
    streamKey: videoStreamKey(video.id),
    streamId: video.streamId,
    videoId: video.id,
    streamTitle: video.title,
    streamStartedAt: video.creationDate.toISOString(),
    commentOffsetSeconds: firstComment.offsetSeconds,
    commentedAt: firstComment.commentedAt,
    authorName: firstComment.authorName,
    authorDisplayName: firstComment.authorDisplayName,
    messageText: firstComment.messageText,
    source: "archive" as const,
  };
}

function videoSummary(video: HelixVideo): ArchivedVideoSummary {
  return {
    id: video.id,
    streamId: video.streamId,
    title: video.title,
    creationDate: video.creationDate,
  };
}

export function videoStreamKey(videoId: string): string {
  return `video:${videoId}`;
}
