import { describe, expect, it } from "vitest";
import {
  formatFirstComment,
  formatFirstCommentBackfillResult,
} from "../../src/first-comment/first-comment-format";

describe("first comment formatting", () => {
  it("formats a saved first comment for chat output", () => {
    expect(
      formatFirstComment({
        authorName: "viewer",
        authorDisplayName: "Viewer",
        firstCommentedAt: "2026-05-25T10:00:02.000Z",
        messageText: "こんにちは",
        source: "archive",
        videoId: "123",
        streamId: "stream-123",
        streamTitle: "テスト配信",
        streamStartedAt: "2026-05-25T10:00:00.000Z",
        commentOffsetSeconds: 2,
      })
    ).toBe("@Viewer の初コメ: 2026-05-25 19:00「こんにちは」");
  });

  it("formats backfill counts", () => {
    expect(
      formatFirstCommentBackfillResult({
        processed: 10,
        saved: 3,
        skipped: 4,
        noComments: 2,
        failed: 1,
        commentsScanned: 0,
      })
    ).toBe(
      "初コメバックフィル完了: 対象10件 / 走査コメント0件 / 保存3件 / 既存4件 / コメントなし2件 / 失敗1件"
    );
  });
});
