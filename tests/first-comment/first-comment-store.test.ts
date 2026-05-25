import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FirstCommentStore,
  type UserFirstCommentRecord,
} from "../../src/first-comment/first-comment-store";

const tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-comment-store-"));
  tempDirs.push(dir);
  return path.join(dir, "first-comments.sqlite");
}

function userRecord(
  overrides: Partial<UserFirstCommentRecord> = {}
): UserFirstCommentRecord {
  return {
    authorName: "viewer",
    authorDisplayName: "Viewer",
    firstCommentedAt: "2026-05-25T10:00:12.500Z",
    messageText: "初コメです",
    source: "archive",
    videoId: "123",
    streamId: "stream-1",
    streamTitle: "テスト配信",
    streamStartedAt: "2026-05-25T10:00:00.000Z",
    commentOffsetSeconds: 12.5,
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("FirstCommentStore", () => {
  it("clears legacy stream-first comments on initialization", () => {
    const dbPath = makeDbPath();
    const oldStore = new FirstCommentStore(dbPath);

    oldStore.saveFirstComment({
      streamKey: "video:legacy",
      streamId: "stream-legacy",
      videoId: "legacy",
      streamTitle: "旧データ",
      streamStartedAt: "2026-05-25T10:00:00.000Z",
      commentOffsetSeconds: 1,
      commentedAt: "2026-05-25T10:00:01.000Z",
      authorName: "legacy",
      authorDisplayName: "Legacy",
      messageText: "配信先頭コメント",
      source: "archive",
    });
    expect(oldStore.getByStreamKey("video:legacy")).not.toBeNull();
    oldStore.close();

    const store = new FirstCommentStore(dbPath);

    expect(store.getByStreamKey("video:legacy")).toBeNull();

    store.close();
  });

  it("tracks processed archive videos without a first comment", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(store.isArchiveVideoProcessed("no-comment-video")).toBe(false);

    store.markArchiveVideoProcessed({
      videoId: "no-comment-video",
      streamId: "stream-empty",
      status: "no_comments",
    });

    expect(store.isArchiveVideoProcessed("no-comment-video")).toBe(true);
    expect(store.getArchiveVideoStatus("no-comment-video")).toMatchObject({
      videoId: "no-comment-video",
      streamId: "stream-empty",
      status: "no_comments",
    });

    store.close();
  });

  it("stores a user's first comment by login name", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(store.saveUserFirstComment(userRecord())).toBe(true);

    expect(store.getUserFirstComment("Viewer")).toMatchObject({
      authorName: "viewer",
      authorDisplayName: "Viewer",
      messageText: "初コメです",
    });

    store.close();
  });

  it("keeps the oldest user first comment when archives are processed out of order", () => {
    const store = new FirstCommentStore(makeDbPath());

    expect(
      store.saveUserFirstComment(
        userRecord({
          firstCommentedAt: "2026-05-25T10:00:00.000Z",
          messageText: "新しい",
        })
      )
    ).toBe(true);
    expect(
      store.saveUserFirstComment(
        userRecord({
          firstCommentedAt: "2026-05-20T10:00:00.000Z",
          messageText: "古い",
        })
      )
    ).toBe(true);
    expect(
      store.saveUserFirstComment(
        userRecord({
          firstCommentedAt: "2026-05-26T10:00:00.000Z",
          messageText: "さらに新しい",
        })
      )
    ).toBe(false);

    expect(store.getUserFirstComment("viewer")?.messageText).toBe("古い");

    store.close();
  });
});
