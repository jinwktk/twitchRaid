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
        async fetchFirstComment(videoId) {
          if (videoId === "222") return null;
          return {
            offsetSeconds: 3,
            commentedAt: "2026-05-25T10:00:03.000Z",
            authorName: "viewer",
            authorDisplayName: "Viewer",
            messageText: "アーカイブ初コメ",
          };
        },
      },
    });

    expect(result).toEqual({
      processed: 2,
      saved: 1,
      skipped: 0,
      noComments: 1,
      failed: 0,
    });
    expect(store.getByStreamKey("video:111")?.messageText).toBe(
      "アーカイブ初コメ"
    );

    store.close();
  });
});
