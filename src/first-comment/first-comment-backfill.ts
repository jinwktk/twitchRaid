import type { ApiClient } from "@twurple/api";
import type { HelixVideo } from "@twurple/api/lib/endpoints/video/HelixVideo";
import type { FirstCommentStore } from "./first-comment-store";
import type {
  TwitchVodCommentsClient,
  VodComment,
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
  commentsScanned: number;
}

interface BackfillParams {
  videos: AsyncIterable<ArchivedVideoSummary>;
  store: FirstCommentStore;
  commentsClient: Pick<TwitchVodCommentsClient, "fetchComments">;
  concurrency?: number;
}

export async function backfillArchivedFirstComments({
  videos,
  store,
  commentsClient,
  concurrency = 8,
}: BackfillParams): Promise<FirstCommentBackfillResult> {
  const result: FirstCommentBackfillResult = {
    processed: 0,
    saved: 0,
    skipped: 0,
    noComments: 0,
    failed: 0,
    commentsScanned: 0,
  };
  const iterator = videos[Symbol.asyncIterator]();
  const workerCount = Math.max(1, Math.floor(concurrency));

  async function nextVideo(): Promise<ArchivedVideoSummary | null> {
    const next = await iterator.next();
    return next.done ? null : next.value;
  }

  async function processVideo(video: ArchivedVideoSummary): Promise<void> {
    result.processed++;

    if (store.isArchiveVideoProcessed(video.id)) {
      result.skipped++;
      return;
    }

    try {
      const comments = await commentsClient.fetchComments(video.id, {
        videoCreatedAt: video.creationDate.toISOString(),
      });
      result.commentsScanned += comments.length;

      if (comments.length === 0) {
        store.markArchiveVideoProcessed({
          videoId: video.id,
          streamId: video.streamId,
          status: "no_comments",
        });
        result.noComments++;
        return;
      }

      for (const comment of comments) {
        if (store.saveUserFirstComment(userRecordFromComment(video, comment))) {
          result.saved++;
        }
      }

      store.markArchiveVideoProcessed({
        videoId: video.id,
        streamId: video.streamId,
        status: "completed",
        commentsScanned: comments.length,
      });
    } catch (error) {
      store.markArchiveVideoProcessed({
        videoId: video.id,
        streamId: video.streamId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
    }
  }

  async function runWorker(): Promise<void> {
    while (true) {
      const video = await nextVideo();
      if (!video) return;
      await processVideo(video);
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await runWorker();
    })
  );

  return result;
}

export async function runStartupFirstCommentBackfill(params: {
  apiClient: ApiClient;
  broadcasterId: string;
  store: FirstCommentStore;
  commentsClient: Pick<TwitchVodCommentsClient, "fetchComments">;
  concurrency?: number;
}): Promise<FirstCommentBackfillResult> {
  return backfillArchivedFirstComments({
    videos: archivedVideosFromApiClient(params.apiClient, params.broadcasterId),
    store: params.store,
    commentsClient: params.commentsClient,
    concurrency: params.concurrency,
  });
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

function userRecordFromComment(video: ArchivedVideoSummary, comment: VodComment) {
  return {
    authorName: comment.authorName,
    authorDisplayName: comment.authorDisplayName,
    firstCommentedAt: comment.commentedAt,
    messageText: comment.messageText,
    source: "archive" as const,
    videoId: video.id,
    streamId: video.streamId,
    streamTitle: video.title,
    streamStartedAt: video.creationDate.toISOString(),
    commentOffsetSeconds: comment.offsetSeconds,
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
