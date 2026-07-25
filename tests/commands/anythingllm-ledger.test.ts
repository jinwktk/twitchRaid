import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnythingLlmLedger,
  type AnythingLlmCommentEvent,
} from "../../src/commands/anythingllm-ledger";

let tempDir: string | null = null;

function makeDbPath(): string {
  tempDir ??= fs.mkdtempSync(
    path.join(os.tmpdir(), "twitchraid-anythingllm-ledger-")
  );
  return path.join(tempDir, "ledger.sqlite");
}

function makeComment(
  overrides: Partial<AnythingLlmCommentEvent> = {}
): AnythingLlmCommentEvent {
  return {
    eventId: "twitch-message-1",
    channel: "rukalun",
    channelId: "channel-id",
    streamId: "stream-1",
    userId: "viewer-id",
    userLogin: "viewer",
    userDisplayName: "Viewer",
    occurredAt: "2026-07-25T07:00:00.000Z",
    body: "マグロが好き",
    ...overrides,
  };
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("AnythingLlmLedger", () => {
  it("accepts a stable Twitch message once without duplicating its sequence", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());

    const first = ledger.acceptComment(makeComment());
    const duplicate = ledger.acceptComment(makeComment());

    expect(first).toMatchObject({
      accepted: true,
      sequence: 1,
      batchId: null,
    });
    expect(duplicate).toMatchObject({
      accepted: false,
      sequence: 1,
      batchId: null,
    });
    expect(ledger.countUnbatchedComments()).toBe(1);
    ledger.close();
  });

  it("fails closed when the same stable ID is reused for different content", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    ledger.acceptComment(makeComment());

    expect(() =>
      ledger.acceptComment(makeComment({ body: "別の内容" }))
    ).toThrow("AnythingLLM ledger event ID conflict");
    ledger.close();
  });

  it("preserves the original comment body including surrounding whitespace", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    ledger.acceptComment(makeComment({ body: "  マグロが好き  " }));

    expect(ledger.getComment("twitch-message-1")?.body).toBe(
      "  マグロが好き  "
    );
    ledger.close();
  });

  it("persists a sealed batch and upload/embedding state across restart", () => {
    const dbPath = makeDbPath();
    const first = new AnythingLlmLedger(dbPath);
    first.acceptComment(makeComment());
    first.acceptComment(
      makeComment({
        eventId: "twitch-message-2",
        occurredAt: "2026-07-25T07:00:01.000Z",
        body: "サーモンも好き",
      })
    );
    const batch = first.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });
    expect(batch).toMatchObject({
      status: "pending",
      workspaceSlug: "twitch-rukalun",
      eventCount: 2,
      firstSequence: 1,
      lastSequence: 2,
      newestOccurredAt: "2026-07-25T07:00:01.000Z",
      retentionExpiresAt: "2027-07-25T07:00:01.000Z",
      cleanupStatus: "retained",
    });
    first.markBatchUploaded(
      batch?.batchId ?? "",
      batch?.documentName ?? "",
      "custom-documents/twitch-comments-batch.json"
    );
    first.markBatchEmbedded(batch?.batchId ?? "", "twitch-rukalun");
    first.close();

    const second = new AnythingLlmLedger(dbPath);
    expect(second.getBatch(batch?.batchId ?? "")).toMatchObject({
      status: "embedded",
      documentLocation: "custom-documents/twitch-comments-batch.json",
      retryCount: 0,
      eventCount: 2,
    });
    expect(
      second.listDueBatches("2026-07-25T07:05:00.000Z")
    ).toEqual([]);
    second.close();
  });

  it("persists failure stage and waits until the retry deadline", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    ledger.acceptComment(makeComment({ body: "  マグロが好き  " }));
    const batch = ledger.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });

    ledger.markBatchFailed(
      batch?.batchId ?? "",
      "upload",
      "unavailable",
      "2026-07-25T07:10:00.000Z"
    );

    expect(
      ledger.listDueBatches("2026-07-25T07:09:59.999Z")
    ).toEqual([]);
    expect(
      ledger.listDueBatches("2026-07-25T07:10:00.000Z")
    ).toEqual([
      expect.objectContaining({
        batchId: batch?.batchId,
        status: "failed",
        failureStage: "upload",
        retryCount: 1,
        lastFailureReason: "unavailable",
        events: [
          expect.objectContaining({
            eventId: "twitch-message-1",
            body: "  マグロが好き  ",
          }),
        ],
      }),
    ]);
    ledger.close();
  });

  it("does not overwrite an uploaded batch with a different document location", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    ledger.acceptComment(makeComment());
    const batch = ledger.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });
    const batchId = batch?.batchId ?? "";
    const documentName = batch?.documentName ?? "";
    ledger.markBatchUploaded(
      batchId,
      documentName,
      "custom-documents/expected.json"
    );

    expect(() =>
      ledger.markBatchUploaded(
        batchId,
        documentName,
        "custom-documents/foreign.json"
      )
    ).toThrow("AnythingLLM ledger document location conflict");
    expect(() =>
      ledger.markBatchUploaded(
        batchId,
        "foreign-document.txt",
        "custom-documents/expected.json"
      )
    ).toThrow("AnythingLLM ledger document name conflict");
    ledger.close();
  });

  it("lists only unembedded comments for a channel in accepted sequence order with a limit", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(makeComment());
      ledger.acceptComment(
        makeComment({
          eventId: "twitch-message-2",
          occurredAt: "2026-07-25T07:00:01.000Z",
          body: "サーモンも好き",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "other-channel-message",
          channel: "other-channel",
          occurredAt: "2026-07-25T07:00:02.000Z",
          body: "別チャンネルの発言",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "twitch-message-4",
          occurredAt: "2026-07-25T07:00:03.000Z",
          body: "イカも好き",
        })
      );

      const embeddedBatch = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 1,
      });
      ledger.markBatchUploaded(
        embeddedBatch?.batchId ?? "",
        embeddedBatch?.documentName ?? "",
        "custom-documents/embedded.json"
      );
      ledger.markBatchEmbedded(
        embeddedBatch?.batchId ?? "",
        "twitch-rukalun"
      );
      const pendingBatch = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 1,
      });
      expect(pendingBatch?.events.map(({ sequence }) => sequence)).toEqual([2]);

      expect(
        ledger
          .listUnembeddedComments("#RUKALUN", 10)
          .map(({ sequence, eventId }) => ({ sequence, eventId }))
      ).toEqual([
        { sequence: 2, eventId: "twitch-message-2" },
        { sequence: 4, eventId: "twitch-message-4" },
      ]);
      expect(
        ledger
          .listUnembeddedComments("rukalun", 1)
          .map(({ sequence }) => sequence)
      ).toEqual([2]);
    } finally {
      ledger.close();
    }
  });

  it("keeps the latest AI topic isolated per requester across restart", () => {
    const dbPath = makeDbPath();
    const first = new AnythingLlmLedger(dbPath);
    first.saveTopicCursor({
      channel: "rukalun",
      userLogin: "viewer-a",
      topicText: "タン塩と塩タンの違い",
      sequence: 7,
      updatedAt: "2026-07-25T07:01:00.000Z",
    });
    first.saveTopicCursor({
      channel: "rukalun",
      userLogin: "viewer-b",
      topicText: "別のAI話題",
      sequence: 8,
      updatedAt: "2026-07-25T07:02:00.000Z",
    });
    first.acceptComment(
      makeComment({
        eventId: "other-viewer-message",
        userLogin: "other",
        body: "別の雑談",
      })
    );
    first.close();

    const second = new AnythingLlmLedger(dbPath);
    expect(second.getTopicCursor("rukalun", "viewer-a")).toEqual({
      channel: "rukalun",
      userLogin: "viewer-a",
      topicText: "タン塩と塩タンの違い",
      sequence: 7,
      updatedAt: "2026-07-25T07:01:00.000Z",
    });
    expect(second.getTopicCursor("rukalun", "viewer-b")?.topicText).toBe(
      "別のAI話題"
    );
    second.close();
  });

  it("seals only one channel, stream, JST day, and fifteen-minute window at a time", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      const comments: AnythingLlmCommentEvent[] = [
        makeComment({
          eventId: "anchor",
          occurredAt: "2026-07-25T05:00:00.000Z",
        }),
        makeComment({
          eventId: "other-channel",
          channel: "other-channel",
          occurredAt: "2026-07-25T05:00:01.000Z",
        }),
        makeComment({
          eventId: "other-stream",
          streamId: "stream-2",
          occurredAt: "2026-07-25T05:00:02.000Z",
        }),
        makeComment({
          eventId: "fifteen-minutes",
          occurredAt: "2026-07-25T05:15:00.000Z",
        }),
        makeComment({
          eventId: "outside-window",
          occurredAt: "2026-07-25T05:15:00.001Z",
        }),
      ];
      for (const comment of comments) ledger.acceptComment(comment);

      const first = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 200,
      });

      expect(first?.events.map(({ eventId }) => eventId)).toEqual([
        "anchor",
        "fifteen-minutes",
      ]);
      expect(first).toMatchObject({
        eventCount: 2,
        newestOccurredAt: "2026-07-25T05:15:00.000Z",
        retentionExpiresAt: "2027-07-25T05:15:00.000Z",
      });
      expect(ledger.countUnbatchedComments()).toBe(3);
    } finally {
      ledger.close();
    }
  });

  it("keeps null stream IDs together but splits a batch at the JST calendar boundary", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(
        makeComment({
          eventId: "before-midnight",
          streamId: null,
          occurredAt: "2026-07-25T14:59:59.999Z",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "after-midnight",
          streamId: null,
          occurredAt: "2026-07-25T15:00:00.000Z",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "same-jst-day",
          streamId: null,
          occurredAt: "2026-07-25T15:00:01.000Z",
        })
      );

      const first = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 200,
      });
      const second = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 200,
      });

      expect(first?.events.map(({ eventId }) => eventId)).toEqual([
        "before-midnight",
      ]);
      expect(second?.events.map(({ eventId }) => eventId)).toEqual([
        "after-midnight",
        "same-jst-day",
      ]);
    } finally {
      ledger.close();
    }
  });

  it("never seals more than two hundred comments into one batch", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      for (let index = 0; index < 201; index += 1) {
        ledger.acceptComment(
          makeComment({
            eventId: `message-${index}`,
            occurredAt: new Date(
              Date.parse("2026-07-25T05:00:00.000Z") + index
            ).toISOString(),
          })
        );
      }

      const first = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 500,
      });
      const second = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 500,
      });

      expect(first?.eventCount).toBe(200);
      expect(second?.eventCount).toBe(1);
    } finally {
      ledger.close();
    }
  });

  it("persists restart-safe and idempotent retention cleanup through body purge", () => {
    const dbPath = makeDbPath();
    const first = new AnythingLlmLedger(dbPath);
    first.acceptComment(
      makeComment({
        occurredAt: "2024-02-29T07:00:00.000Z",
        body: "  365日だけ保持する原文  ",
      })
    );
    const batch = first.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });
    const batchId = batch?.batchId ?? "";
    const documentName = batch?.documentName ?? "";
    const documentLocation = "custom-documents/retention-batch.json";
    first.markBatchUploaded(batchId, documentName, documentLocation);
    first.markBatchEmbedded(batchId, "twitch-rukalun");

    expect(
      first.listExpiredBatches("2025-02-28T06:59:59.999Z")
    ).toEqual([]);
    expect(
      first.listExpiredBatches("2025-02-28T07:00:00.000Z")
    ).toEqual([
      expect.objectContaining({
        batchId,
        retentionExpiresAt: "2025-02-28T07:00:00.000Z",
        cleanupStatus: "retained",
      }),
    ]);

    first.markBatchUnembeddedForCleanup(batchId, documentLocation);
    first.markBatchUnembeddedForCleanup(batchId, documentLocation);
    first.close();

    const second = new AnythingLlmLedger(dbPath);
    expect(second.getBatch(batchId)).toMatchObject({
      cleanupStatus: "unembedded",
      cleanupFailureStage: null,
      cleanupRetryCount: 0,
      unembeddedAt: expect.any(String),
    });
    second.markBatchSourceDeleted(batchId, documentLocation);
    second.markBatchSourceDeleted(batchId, documentLocation);
    second.markBatchBodiesPurged(batchId);
    second.markBatchBodiesPurged(batchId);

    expect(second.getBatch(batchId)).toMatchObject({
      cleanupStatus: "body_purged",
      sourceDeletedAt: expect.any(String),
      bodiesPurgedAt: expect.any(String),
      events: [
        expect.objectContaining({
          eventId: "twitch-message-1",
          body: "",
          bodyPurgedAt: expect.any(String),
        }),
      ],
    });
    expect(
      second.listExpiredBatches("2030-01-01T00:00:00.000Z")
    ).toEqual([]);
    second.close();
  });

  it("uses a validated configurable raw retention period for newly sealed batches", () => {
    const dbPath = makeDbPath();
    const ledger = new AnythingLlmLedger(dbPath, 30);
    try {
      ledger.acceptComment(
        makeComment({ occurredAt: "2026-01-01T00:00:00.000Z" })
      );

      expect(
        ledger.sealNextBatch({
          workspaceSlug: "twitch-rukalun",
          maxComments: 200,
        })?.retentionExpiresAt
      ).toBe("2026-01-31T00:00:00.000Z");
    } finally {
      ledger.close();
    }

    expect(() => new AnythingLlmLedger(dbPath, 0)).toThrow(
      "AnythingLLM ledger retention days is invalid"
    );
    expect(() => new AnythingLlmLedger(dbPath, 3_651)).toThrow(
      "AnythingLLM ledger retention days is invalid"
    );
    expect(() => new AnythingLlmLedger(dbPath, 1.5)).toThrow(
      "AnythingLLM ledger retention days is invalid"
    );
  });

  it("persists cleanup failure stage and resumes only after its retry deadline", () => {
    const dbPath = makeDbPath();
    const first = new AnythingLlmLedger(dbPath);
    first.acceptComment(
      makeComment({ occurredAt: "2024-01-01T00:00:00.000Z" })
    );
    const batch = first.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });
    const batchId = batch?.batchId ?? "";
    const documentLocation = "custom-documents/partial-cleanup.json";
    first.markBatchUploaded(
      batchId,
      batch?.documentName ?? "",
      documentLocation
    );
    first.markBatchEmbedded(batchId, "twitch-rukalun");
    first.markBatchUnembeddedForCleanup(batchId, documentLocation);
    first.markBatchCleanupFailed(
      batchId,
      "source_delete",
      "upstream private detail",
      "2025-01-01T00:10:00.000Z"
    );
    first.close();

    const second = new AnythingLlmLedger(dbPath);
    expect(
      second.listExpiredBatches("2025-01-01T00:09:59.999Z")
    ).toEqual([]);
    expect(
      second.listExpiredBatches("2025-01-01T00:10:00.000Z")
    ).toEqual([
      expect.objectContaining({
        batchId,
        cleanupStatus: "failed",
        cleanupFailureStage: "source_delete",
        cleanupRetryCount: 1,
        cleanupLastFailureReason: "upstream_private_detail",
        unembeddedAt: expect.any(String),
      }),
    ]);
    second.markBatchSourceDeleted(batchId, documentLocation);
    second.markBatchBodiesPurged(batchId);
    expect(second.getComment("twitch-message-1")).toMatchObject({
      body: "",
      bodyPurgedAt: expect.any(String),
    });
    second.close();
  });

  it("reports ingestion queue health without returning comment bodies", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(
        makeComment({
          eventId: "oldest",
          occurredAt: "2026-07-25T07:00:00.000Z",
          body: "本文を統計へ出さない",
        })
      );
      const failed = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 200,
      });
      ledger.markBatchFailed(
        failed?.batchId ?? "",
        "upload",
        "unavailable",
        "2026-07-25T07:10:00.000Z"
      );
      ledger.acceptComment(
        makeComment({
          eventId: "newer",
          occurredAt: "2026-07-25T07:01:00.000Z",
          body: "別の本文",
        })
      );

      const waiting = ledger.getIngestionQueueStats(
        "2026-07-25T07:09:59.999Z"
      );
      expect(waiting).toEqual({
        unembeddedCommentCount: 2,
        dueBatchCount: 0,
        failedBatchCount: 1,
        oldestUnembeddedOccurredAt: "2026-07-25T07:00:00.000Z",
      });
      expect(JSON.stringify(waiting)).not.toContain("本文");
      expect(
        ledger.getIngestionQueueStats("2026-07-25T07:10:00.000Z")
          .dueBatchCount
      ).toBe(1);

      ledger.markBatchUploaded(
        failed?.batchId ?? "",
        failed?.documentName ?? "",
        "custom-documents/stats.json"
      );
      ledger.markBatchEmbedded(failed?.batchId ?? "", "twitch-rukalun");
      expect(
        ledger.getIngestionQueueStats("2026-07-25T07:10:00.000Z")
      ).toEqual({
        unembeddedCommentCount: 1,
        dueBatchCount: 0,
        failedBatchCount: 0,
        oldestUnembeddedOccurredAt: "2026-07-25T07:01:00.000Z",
      });
    } finally {
      ledger.close();
    }
  });

  it("freezes and reads one stream through an accepted-sequence watermark", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(
        makeComment({
          eventId: "stream-first",
          body: "先に受理されたコメント",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "other-stream",
          streamId: "stream-2",
          body: "別配信のコメント",
        })
      );
      ledger.acceptComment(
        makeComment({
          eventId: "stream-second",
          occurredAt: "2026-07-25T07:00:02.000Z",
          body: "次に受理されたコメント",
        })
      );

      const watermark =
        ledger.getStreamFinalAcceptedSequence("stream-1");
      expect(watermark).toBe(3);

      ledger.acceptComment(
        makeComment({
          eventId: "stream-after-watermark",
          occurredAt: "2026-07-25T07:00:03.000Z",
          body: "終了capture後のコメント",
        })
      );

      expect(
        ledger
          .listStreamCommentsThrough("stream-1", watermark)
          .map(({ eventId, sequence }) => ({ eventId, sequence }))
      ).toEqual([
        { eventId: "stream-first", sequence: 1 },
        { eventId: "stream-second", sequence: 3 },
      ]);
      expect(
        ledger.getStreamFinalAcceptedSequence("missing-stream")
      ).toBe(0);
    } finally {
      ledger.close();
    }
  });

  it("reports a stream ready only after every comment through its watermark is embedded", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(makeComment({ eventId: "stream-first" }));
      ledger.acceptComment(
        makeComment({
          eventId: "stream-second",
          occurredAt: "2026-07-25T07:00:01.000Z",
        })
      );
      const watermark =
        ledger.getStreamFinalAcceptedSequence("stream-1");

      expect(
        ledger.areStreamCommentsEmbeddedThrough("stream-1", watermark)
      ).toBe(false);

      const batch = ledger.sealNextBatch({
        workspaceSlug: "twitch-rukalun",
        maxComments: 200,
      });
      expect(
        ledger.areStreamCommentsEmbeddedThrough("stream-1", watermark)
      ).toBe(false);

      ledger.markBatchUploaded(
        batch?.batchId ?? "",
        batch?.documentName ?? "",
        "custom-documents/stream-batch.json"
      );
      ledger.markBatchEmbedded(batch?.batchId ?? "", "twitch-rukalun");

      expect(
        ledger.areStreamCommentsEmbeddedThrough("stream-1", watermark)
      ).toBe(true);
      expect(
        ledger.areStreamCommentsEmbeddedThrough("zero-comment-stream", 0)
      ).toBe(true);
    } finally {
      ledger.close();
    }
  });
});
