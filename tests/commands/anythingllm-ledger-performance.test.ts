import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnythingLlmLedger,
  type AnythingLlmCommentEvent,
} from "../../src/commands/anythingllm-ledger";

interface QueryPlanRow {
  detail: string;
}

interface RawLedger {
  db: DatabaseSync;
}

let tempDir: string | null = null;

function makeDbPath(name = "ledger.sqlite"): string {
  tempDir ??= fs.mkdtempSync(
    path.join(os.tmpdir(), "twitchraid-ledger-performance-")
  );
  return path.join(tempDir, name);
}

function rawDb(ledger: AnythingLlmLedger): DatabaseSync {
  return (ledger as unknown as RawLedger).db;
}

function capturePreparedSql(
  ledger: AnythingLlmLedger,
  marker: string,
  operation: () => void
): string {
  const captured = captureAllPreparedSql(ledger, operation);
  const sql = captured.find((candidate) => candidate.includes(marker));
  if (!sql) throw new Error(`query containing ${marker} was not prepared`);
  return sql;
}

function captureAllPreparedSql(
  ledger: AnythingLlmLedger,
  operation: () => void
): string[] {
  const db = rawDb(ledger);
  const prepare = db.prepare.bind(db);
  const captured: string[] = [];
  Object.defineProperty(db, "prepare", {
    configurable: true,
    value(sql: string) {
      captured.push(sql);
      return prepare(sql);
    },
  });
  try {
    operation();
  } finally {
    delete (db as unknown as { prepare?: unknown }).prepare;
  }
  return captured;
}

function explain(
  ledger: AnythingLlmLedger,
  sql: string,
  ...parameters: Array<string | number>
): string[] {
  return (
    rawDb(ledger)
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...parameters) as unknown as QueryPlanRow[]
  ).map(({ detail }) => detail);
}

function comment(
  eventId: string,
  overrides: Partial<AnythingLlmCommentEvent> = {}
): AnythingLlmCommentEvent {
  return {
    eventId,
    channel: "rukalun",
    channelId: "channel-id",
    streamId: "stream-target",
    userId: "viewer-id",
    userLogin: "viewer",
    userDisplayName: "Viewer",
    occurredAt: "2026-09-05T00:00:00.000Z",
    body: eventId,
    ...overrides,
  };
}

function seedMixedPendingComments(
  ledger: AnythingLlmLedger,
  count: number
): void {
  const db = rawDb(ledger);
  const insertBatch = db.prepare(`
    INSERT INTO anythingllm_ingestion_batches (
      batch_id, workspace_slug, document_name, document_content_hash,
      status, document_location, event_count, first_sequence,
      last_sequence, newest_occurred_at, retention_expires_at,
      failure_stage, retry_count, last_failure_reason, next_attempt_at,
      created_at, uploaded_at, embedded_at, cleanup_status,
      cleanup_failure_stage, cleanup_retry_count,
      cleanup_last_failure_reason, cleanup_next_attempt_at,
      unembedded_at, source_deleted_at, bodies_purged_at, updated_at
    ) VALUES (
      ?, 'workspace', ?, 'hash', 'pending', NULL, 1, ?, ?,
      '2026-09-05T00:00:00.000Z', '2027-09-05T00:00:00.000Z',
      NULL, 0, NULL, NULL, '2026-09-05T00:00:00.000Z',
      NULL, NULL, 'retained', NULL, 0, NULL, NULL, NULL, NULL, NULL,
      '2026-09-05T00:00:00.000Z'
    )
  `);
  const assign = db.prepare(`
    UPDATE anythingllm_comment_events SET batch_id = ? WHERE event_id = ?
  `);
  for (let index = 0; index < count; index += 1) {
    const sequence = index + 1;
    const eventId = `boundary-event-${sequence}`;
    ledger.acceptComment(
      comment(eventId, {
        occurredAt: new Date(
          Date.parse("2026-09-05T00:00:00.000Z") + index * 1_000
        ).toISOString(),
      })
    );
    if (sequence % 2 === 0) {
      const batchId = `boundary-batch-${sequence}`;
      insertBatch.run(
        batchId,
        `boundary-document-${sequence}`,
        sequence,
        sequence
      );
      assign.run(batchId, eventId);
    }
  }
}

afterEach(() => {
  if (!tempDir) return;
  fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("AnythingLlmLedger performance contracts", () => {
  it("adds the stream/sequence index after migrating a legacy events table and remains idempotent", () => {
    const dbPath = makeDbPath();
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE anythingllm_comment_events (
        accepted_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        batch_id TEXT,
        channel TEXT NOT NULL,
        channel_id TEXT,
        user_id TEXT,
        user_login TEXT NOT NULL,
        user_display_name TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        body TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        accepted_at TEXT NOT NULL
      );
    `);
    legacy.close();

    new AnythingLlmLedger(dbPath).close();
    const reopened = new AnythingLlmLedger(dbPath);
    try {
      const indexes = rawDb(reopened)
        .prepare("PRAGMA index_list(anythingllm_comment_events)")
        .all() as unknown as Array<{ name: string }>;
      expect(
        indexes.filter(
          ({ name }) => name === "anythingllm_stream_sequence_idx"
        )
      ).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  it("uses indexed stream range searches for watermark, ordered reads, and readiness", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      ledger.acceptComment(comment("target-first"));
      ledger.acceptComment(
        comment("other-stream", { streamId: "stream-other" })
      );
      const watermark = ledger.getStreamFinalAcceptedSequence("stream-target");

      const finalSql = capturePreparedSql(
        ledger,
        "MAX(accepted_sequence)",
        () => void ledger.getStreamFinalAcceptedSequence("stream-target")
      );
      const listSql = capturePreparedSql(
        ledger,
        "ORDER BY accepted_sequence ASC",
        () => void ledger.listStreamCommentsThrough("stream-target", watermark)
      );
      const readinessSql = capturePreparedSql(
        ledger,
        "embedded_count",
        () =>
          void ledger.areStreamCommentsEmbeddedThrough(
            "stream-target",
            watermark
          )
      );

      for (const plan of [
        explain(ledger, finalSql, "stream-target"),
        explain(ledger, listSql, "stream-target", watermark),
        explain(ledger, readinessSql, "stream-target", watermark),
      ]) {
        expect(plan).toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              /SEARCH events? USING INDEX anythingllm_stream_sequence_idx|SEARCH anythingllm_comment_events USING (?:COVERING )?INDEX anythingllm_stream_sequence_idx/u
            ),
          ])
        );
      }
    } finally {
      ledger.close();
    }
  });

  it("finds sparse pending events by index and aggregates queue count/min in one pass", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      const listSql = capturePreparedSql(
        ledger,
        "SELECT events.*",
        () => void ledger.listUnembeddedComments("rukalun", 100)
      );
      const statsSql = capturePreparedSql(
        ledger,
        "unembedded_comment_count",
        () =>
          void ledger.getIngestionQueueStats("2026-09-05T00:00:00.000Z")
      );

      expect(listSql).not.toContain("LEFT JOIN");
      expect(listSql).toContain("UNION ALL");
      expect(statsSql).not.toContain("LEFT JOIN");
      expect(
        statsSql.match(/FROM anythingllm_comment_events AS events/gu)
      ).toHaveLength(1);

      const listPlan = explain(
        ledger,
        listSql,
        "rukalun",
        "rukalun",
        32
      );
      expect(listPlan).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^SCAN events$/u)])
      );
      expect(listPlan).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /SEARCH events USING INDEX anythingllm_unbatched_comment_idx/u
          ),
          expect.stringMatching(
            /SEARCH (?:anythingllm_ingestion_batches|batches) USING INDEX anythingllm_due_batch_idx/u
          ),
        ])
      );

      const statsPlan = explain(
        ledger,
        statsSql,
        "2026-09-05T00:00:00.000Z"
      );
      expect(statsPlan).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^SCAN events$/u)])
      );
    } finally {
      ledger.close();
    }
  });

  it("falls back to an ordered limited scan when the pending batch set is dense", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      const db = rawDb(ledger);
      const insertBatch = db.prepare(`
        INSERT INTO anythingllm_ingestion_batches (
          batch_id, workspace_slug, document_name, document_content_hash,
          status, document_location, event_count, first_sequence,
          last_sequence, newest_occurred_at, retention_expires_at,
          failure_stage, retry_count, last_failure_reason, next_attempt_at,
          created_at, uploaded_at, embedded_at, cleanup_status,
          cleanup_failure_stage, cleanup_retry_count,
          cleanup_last_failure_reason, cleanup_next_attempt_at,
          unembedded_at, source_deleted_at, bodies_purged_at, updated_at
        ) VALUES (
          ?, 'workspace', ?, 'hash', 'pending', NULL, 1, ?, ?,
          '2026-09-05T00:00:00.000Z', '2027-09-05T00:00:00.000Z',
          NULL, 0, NULL, NULL, '2026-09-05T00:00:00.000Z',
          NULL, NULL, 'retained', NULL, 0, NULL, NULL, NULL, NULL, NULL,
          '2026-09-05T00:00:00.000Z'
        )
      `);
      const insertEvent = db.prepare(`
        INSERT INTO anythingllm_comment_events (
          accepted_sequence, event_id, batch_id, channel, channel_id,
          stream_id, user_id, user_login, user_display_name, occurred_at,
          body, content_hash, accepted_at, body_purged_at
        ) VALUES (
          ?, ?, ?, 'rukalun', 'channel-id', 'dense-stream', 'viewer-id',
          'viewer', 'Viewer', ?, ?, ?, '2026-09-05T00:00:00.000Z', NULL
        )
      `);
      db.exec("BEGIN");
      try {
        for (let index = 0; index < 1_005; index += 1) {
          const sequence = index + 1;
          const batchId = `dense-batch-${sequence}`;
          insertBatch.run(
            batchId,
            `dense-document-${sequence}`,
            sequence,
            sequence
          );
          insertEvent.run(
            sequence,
            `dense-event-${sequence}`,
            batchId,
            new Date(
              Date.parse("2026-09-05T00:00:00.000Z") + index * 1_000
            ).toISOString(),
            `dense body ${sequence}`,
            `dense-content-${sequence}`
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      let result: AnythingLlmCommentEvent[] = [];
      const prepared = captureAllPreparedSql(ledger, () => {
        result = ledger.listUnembeddedComments("rukalun", 1_000);
      });
      expect(result.map(({ eventId }) => eventId)).toEqual(
        Array.from({ length: 1_000 }, (_, index) => `dense-event-${index + 1}`)
      );
      expect(prepared).toEqual(
        expect.arrayContaining([expect.stringContaining("LEFT JOIN")])
      );
    } finally {
      ledger.close();
    }
  });

  it("falls back to an ordered limited scan when unbatched events are dense", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      for (let index = 0; index < 1_005; index += 1) {
        ledger.acceptComment(
          comment(`unbatched-${index + 1}`, {
            occurredAt: new Date(
              Date.parse("2026-09-05T00:00:00.000Z") + index * 1_000
            ).toISOString(),
          })
        );
      }

      let result: AnythingLlmCommentEvent[] = [];
      const prepared = captureAllPreparedSql(ledger, () => {
        result = ledger.listUnembeddedComments("rukalun", 1_000);
      });
      expect(result.map(({ eventId }) => eventId)).toEqual(
        Array.from({ length: 1_000 }, (_, index) => `unbatched-${index + 1}`)
      );
      expect(prepared).toEqual(
        expect.arrayContaining([expect.stringContaining("LEFT JOIN")])
      );
    } finally {
      ledger.close();
    }
  });

  it.each([
    { count: 20, limit: 20, fallsBack: false },
    { count: 21, limit: 20, fallsBack: true },
    { count: 31, limit: 1_000, fallsBack: false },
    { count: 32, limit: 1_000, fallsBack: true },
  ])(
    "keeps candidate ordering and switches plans at count=$count limit=$limit",
    ({ count, limit, fallsBack }) => {
      const ledger = new AnythingLlmLedger(makeDbPath());
      try {
        seedMixedPendingComments(ledger, count);
        let result: AnythingLlmCommentEvent[] = [];
        const prepared = captureAllPreparedSql(ledger, () => {
          result = ledger.listUnembeddedComments("rukalun", limit);
        });
        expect(result.map(({ eventId }) => eventId)).toEqual(
          Array.from(
            { length: Math.min(count, limit) },
            (_, index) => `boundary-event-${index + 1}`
          )
        );
        expect(prepared.some((sql) => sql.includes("LEFT JOIN"))).toBe(
          fallsBack
        );
      } finally {
        ledger.close();
      }
    }
  );

  it("preserves pending visibility across delivery and cleanup states", () => {
    const ledger = new AnythingLlmLedger(makeDbPath());
    try {
      const cases = [
        ["null-batch", null, null, null],
        ["pending-retained", "pending", "retained", null],
        ["uploaded-unembedded", "uploaded", "unembedded", null],
        ["failed-source-deleted", "failed", "source_deleted", null],
        ["failed-cleanup", "failed", "failed", null],
        ["embedded-retained", "embedded", "retained", null],
        ["pending-body-purged", "pending", "body_purged", null],
        ["purged-event", null, null, "2026-09-05T01:00:00.000Z"],
        ["other-channel", null, null, null],
      ] as const;
      for (const [eventId] of cases) {
        ledger.acceptComment(
          comment(eventId, {
            channel: eventId === "other-channel" ? "elsewhere" : "rukalun",
          })
        );
      }

      const db = rawDb(ledger);
      const insertBatch = db.prepare(`
        INSERT INTO anythingllm_ingestion_batches (
          batch_id, workspace_slug, document_name, document_content_hash,
          status, document_location, event_count, first_sequence,
          last_sequence, newest_occurred_at, retention_expires_at,
          failure_stage, retry_count, last_failure_reason, next_attempt_at,
          created_at, uploaded_at, embedded_at, cleanup_status,
          cleanup_failure_stage, cleanup_retry_count,
          cleanup_last_failure_reason, cleanup_next_attempt_at,
          unembedded_at, source_deleted_at, bodies_purged_at, updated_at
        ) VALUES (
          ?, 'workspace', ?, 'hash', ?, NULL, 1, ?, ?,
          '2026-09-05T00:00:00.000Z', '2027-09-05T00:00:00.000Z',
          NULL, 0, NULL, NULL, '2026-09-05T00:00:00.000Z',
          NULL, NULL, ?, NULL, 0, NULL, NULL, NULL, NULL, NULL,
          '2026-09-05T00:00:00.000Z'
        )
      `);
      const assign = db.prepare(`
        UPDATE anythingllm_comment_events
        SET batch_id = ?, body_purged_at = ?
        WHERE event_id = ?
      `);
      for (const [eventId, status, cleanupStatus, bodyPurgedAt] of cases) {
        let batchId: string | null = null;
        if (status && cleanupStatus) {
          const event = ledger.getComment(eventId);
          batchId = `batch-${eventId}`;
          insertBatch.run(
            batchId,
            `document-${eventId}`,
            status,
            event?.sequence ?? 0,
            event?.sequence ?? 0,
            cleanupStatus
          );
        }
        assign.run(batchId, bodyPurgedAt, eventId);
      }

      expect(
        ledger
          .listUnembeddedComments("#RUKALUN", 3)
          .map(({ eventId }) => eventId)
      ).toEqual([
        "null-batch",
        "pending-retained",
        "uploaded-unembedded",
      ]);
      expect(
        ledger
          .listUnembeddedComments("rukalun", 100)
          .map(({ eventId }) => eventId)
      ).toEqual([
        "null-batch",
        "pending-retained",
        "uploaded-unembedded",
        "failed-source-deleted",
        "failed-cleanup",
      ]);
      expect(ledger.listStreamCommentsThrough("missing-stream", 100)).toEqual(
        []
      );
      expect(
        ledger.getIngestionQueueStats("2026-09-05T00:00:00.000Z")
      ).toMatchObject({
        unembeddedCommentCount: 6,
        oldestUnembeddedOccurredAt: "2026-09-05T00:00:00.000Z",
      });
    } finally {
      ledger.close();
    }
  });
});
