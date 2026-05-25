import { describe, expect, it } from "vitest";
import {
  formatFirstComment,
  formatFirstCommentBackfillResult,
} from "../../src/first-comment/first-comment-format";

describe("first comment formatting", () => {
  it("formats a saved first comment for chat output", () => {
    expect(
      formatFirstComment({
        streamKey: "video:123",
        streamId: "stream-123",
        videoId: "123",
        streamTitle: "テスト配信",
        streamStartedAt: "2026-05-25T10:00:00.000Z",
        commentOffsetSeconds: 2,
        commentedAt: "2026-05-25T10:00:02.000Z",
        authorName: "viewer",
        authorDisplayName: "Viewer",
        messageText: "こんにちは",
        source: "archive",
      })
    ).toBe("初コメ: 2026-05-25 19:00 @Viewer「こんにちは」");
  });

  it("formats backfill counts", () => {
    expect(
      formatFirstCommentBackfillResult({
        processed: 10,
        saved: 3,
        skipped: 4,
        noComments: 2,
        failed: 1,
      })
    ).toBe(
      "初コメバックフィル完了: 対象10件 / 保存3件 / 既存4件 / コメントなし2件 / 失敗1件"
    );
  });
});
