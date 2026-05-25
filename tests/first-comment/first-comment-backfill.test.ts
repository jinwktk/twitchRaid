import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  backfillArchivedFirstComments,
  type ArchivedVideoSummary,
} from "../../src/first-comment/first-comment-backfill";
import { FirstCommentStore } from "../../src/first-comment/first-comment-store";

const tempDirs: string[] = [];

function makeStore(): FirstCommentStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-comment-backfill-"));
  tempDirs.push(dir);
  return new FirstCommentStore(path.join(dir, "first-comments.sqlite"));
}

async function* videos(): AsyncIterable<ArchivedVideoSummary> {
  yield {
    id: "111",
    streamId: "stream-111",
    title: "コメントあり",
    creationDate: new Date("2026-05-25T10:00:00.000Z"),
  };
  yield {
    id: "222",
    streamId: "stream-222",
    title: "コメントなし",
    creationDate: new Date("2026-05-24T10:00:00.000Z"),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("backfillArchivedFirstComments", () => {
  it("saves first comments for archived videos and reports counts", async () => {
    const store = makeStore();

    const result = await backfillArchivedFirstComments({
      videos: videos(),
      store,
      commentsClient: {
        async fetchComments(videoId) {
          if (videoId === "222") return [];
          return [
            {
              offsetSeconds: 3,
              commentedAt: "2026-05-25T10:00:03.000Z",
              authorName: "viewer",
              authorDisplayName: "Viewer",
              messageText: "アーカイブ初コメ",
            },
          ];
        },
      },
    });

    expect(result).toEqual({
      processed: 2,
      saved: 1,
      skipped: 0,
      noComments: 1,
      failed: 0,
      commentsScanned: 1,
    });
    expect(store.getUserFirstComment("viewer")?.messageText).toBe(
      "アーカイブ初コメ"
    );

    store.close();
  });

  it("does not fetch archive videos that were already processed", async () => {
    const store = makeStore();
    store.markArchiveVideoProcessed({
      videoId: "111",
      streamId: "stream-111",
      status: "no_comments",
    });
    const fetched: string[] = [];

    const result = await backfillArchivedFirstComments({
      videos: videos(),
      store,
      commentsClient: {
        async fetchComments(videoId) {
          fetched.push(videoId);
          return [];
        },
      },
    });

    expect(fetched).toEqual(["222"]);
    expect(result).toEqual({
      processed: 2,
      saved: 0,
      skipped: 1,
      noComments: 1,
      failed: 0,
      commentsScanned: 0,
    });

    store.close();
  });

  it("fetches archive comments concurrently", async () => {
    const store = makeStore();
    let activeFetches = 0;
    let maxActiveFetches = 0;

    async function* manyVideos(): AsyncIterable<ArchivedVideoSummary> {
      for (let index = 1; index <= 4; index++) {
        yield {
          id: String(index),
          streamId: `stream-${index}`,
          title: `配信${index}`,
          creationDate: new Date("2026-05-25T10:00:00.000Z"),
        };
      }
    }

    const result = await backfillArchivedFirstComments({
      videos: manyVideos(),
      store,
      concurrency: 2,
      commentsClient: {
        async fetchComments(videoId) {
          activeFetches++;
          maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeFetches--;
          return [
            {
              offsetSeconds: Number(videoId),
              commentedAt: "2026-05-25T10:00:03.000Z",
              authorName: `viewer${videoId}`,
              authorDisplayName: `Viewer${videoId}`,
              messageText: `初コメ${videoId}`,
            },
          ];
        },
      },
    });

    expect(maxActiveFetches).toBe(2);
    expect(result.saved).toBe(4);

    store.close();
  });
});
