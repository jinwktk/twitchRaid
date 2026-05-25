import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FirstCommentStore,
  type FirstCommentRecord,
} from "../../src/first-comment/first-comment-store";

const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-comment-store-"));
  tempDirs.push(dir);
  return path.join(dir, "first-comments.sqlite");
}

function record(overrides: Partial<FirstCommentRecord> = {}): FirstCommentRecord {
  return {
    streamKey: "video:123",
    streamId: "stream-1",
    videoId: "123",
    streamTitle: "テスト配信",
    streamStartedAt: "2026-05-25T10:00:00.000Z",
    commentOffsetSeconds: 12.5,
    commentedAt: "2026-05-25T10:00:12.500Z",
    authorName: "viewer",
    authorDisplayName: "Viewer",
    messageText: "初コメです",
    source: "archive",
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("FirstCommentStore", () => {
  it("stores and reads a first comment", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(store.saveFirstComment(record())).toBe(true);
    expect(store.getByStreamKey("video:123")).toMatchObject({
      streamKey: "video:123",
      authorName: "viewer",
      messageText: "初コメです",
      source: "archive",
    });

    store.close();
  });

  it("keeps the first saved comment for the same stream", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(store.saveFirstComment(record({ messageText: "最初" }))).toBe(true);
    expect(store.saveFirstComment(record({ messageText: "二番目" }))).toBe(false);

    expect(store.getByStreamKey("video:123")?.messageText).toBe("最初");

    store.close();
  });

  it("deduplicates live and archive records by Twitch stream id", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(
      store.saveFirstComment(
        record({ streamKey: "live:stream-1", videoId: null, source: "live" })
      )
    ).toBe(true);
    expect(store.saveFirstComment(record({ streamKey: "video:123" }))).toBe(
      false
    );

    expect(store.getByStreamId("stream-1")?.streamKey).toBe("live:stream-1");

    store.close();
  });
});
