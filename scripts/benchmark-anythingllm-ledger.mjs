import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const shouldAssert = args.includes("--assert");
// Samples report one public-operation run. Sparse reads must improve by 2x.
// Dense limit 20/100 calls complete below 1 ms, so their fixed plan-probe cost
// uses a 0.25 ms absolute budget; the longer limit 1000 path keeps a ratio gate.
const operationRepeats = 3;
const sparseMinimumSpeedup = 2;
const denseSmallLimitMaximumOverheadMs = 0.25;
const denseLargeLimitMinimumSpeedup = 0.9;

function argumentValue(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const rowCount = Number(argumentValue("--rows", "40000"));
if (!Number.isInteger(rowCount) || rowCount < 1_000) {
  throw new Error("--rows must be an integer of at least 1000");
}
if (shouldAssert && rowCount < 40_000) {
  throw new Error("--assert requires at least 40000 synthetic rows");
}

const baselineModulePath = path.resolve(
  repoRoot,
  argumentValue(
    "--baseline-module",
    ".omx/perf-baselines/anythingllm-ledger-before-20260905.js"
  )
);
const currentModulePath = path.resolve(
  repoRoot,
  argumentValue(
    "--current-module",
    "dist/commands/anythingllm-ledger.js"
  )
);
const outputPathArgument = argumentValue("--output", "");
const outputPath = outputPathArgument
  ? path.resolve(repoRoot, outputPathArgument)
  : null;

for (const modulePath of [baselineModulePath, currentModulePath]) {
  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `ledger module not found: ${modulePath}. Build dist and pass --baseline-module with the preserved pre-change module.`
    );
  }
}

const { AnythingLlmLedger: BaselineLedger } = require(baselineModulePath);
const { AnythingLlmLedger: CurrentLedger } = require(currentModulePath);
const scenarios = ["none", "sparse", "dense", "dense-unbatched"];
const now = "2026-09-05T12:00:00.000Z";

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function summarize(samples) {
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
  };
}

function formatMetric(metric) {
  return {
    medianMs: Number(metric.medianMs.toFixed(3)),
    p95Ms: Number(metric.p95Ms.toFixed(3)),
  };
}

function isPending(index, scenario) {
  if (scenario === "none" || scenario === "dense-unbatched") return false;
  if (scenario === "sparse") {
    const stride = Math.max(1, Math.floor(rowCount / 10));
    return index % stride === 0;
  }
  return index % 4 === 0;
}

function seedFixture(dbPath, scenario) {
  const bootstrap = new BaselineLedger(dbPath);
  bootstrap.close();
  const db = new DatabaseSync(dbPath);
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
      ?, 'benchmark', ?, ?, ?, ?, 1, ?, ?, ?,
      '2027-09-05T00:00:00.000Z', ?, ?, ?, ?,
      '2026-09-05T00:00:00.000Z', ?, ?, ?, NULL, 0, NULL, NULL,
      NULL, NULL, NULL, '2026-09-05T00:00:00.000Z'
    )
  `);
  const insertEvent = db.prepare(`
    INSERT INTO anythingllm_comment_events (
      accepted_sequence, event_id, batch_id, channel, channel_id,
      stream_id, user_id, user_login, user_display_name, occurred_at,
      body, content_hash, accepted_at, body_purged_at
    ) VALUES (?, ?, ?, ?, 'channel-id', ?, 'viewer-id', 'viewer',
      'Viewer', ?, ?, ?, '2026-09-05T00:00:00.000Z', ?)
  `);

  db.exec("BEGIN");
  try {
    for (let index = 0; index < rowCount; index += 1) {
      const sequence = index + 1;
      const batchId = `batch-${scenario}-${String(sequence).padStart(6, "0")}`;
      const pending = isPending(index, scenario);
      const pendingOrdinal = Math.floor(index / Math.max(1, Math.floor(rowCount / 10)));
      const status = pending
        ? ["pending", "uploaded", "failed"][pendingOrdinal % 3]
        : "embedded";
      const cleanupStatus = pending && pendingOrdinal % 11 === 10
        ? "body_purged"
        : "retained";
      const occurredAt = new Date(
        Date.parse("2026-09-01T00:00:00.000Z") + index * 1_000
      ).toISOString();
      const documentLocation = status === "pending"
        ? null
        : `custom-documents/${batchId}.json`;
      const failureStage = status === "failed" ? "upload" : null;
      const retryCount = status === "failed" ? 1 : 0;
      const lastFailureReason = status === "failed" ? "benchmark" : null;
      const nextAttemptAt = status === "failed"
        ? "2026-09-05T11:00:00.000Z"
        : null;
      const uploadedAt = status === "uploaded" || status === "embedded"
        ? "2026-09-05T00:01:00.000Z"
        : null;
      const embeddedAt = status === "embedded"
        ? "2026-09-05T00:02:00.000Z"
        : null;
      insertBatch.run(
        batchId,
        `document-${scenario}-${sequence}`,
        `hash-${sequence}`,
        status,
        documentLocation,
        sequence,
        sequence,
        occurredAt,
        failureStage,
        retryCount,
        lastFailureReason,
        nextAttemptAt,
        uploadedAt,
        embeddedAt,
        cleanupStatus
      );
      insertEvent.run(
        sequence,
        `event-${scenario}-${sequence}`,
        scenario === "dense-unbatched" && index % 4 === 0
          ? null
          : batchId,
        `benchmark-${scenario}`,
        `stream-${index % 100}`,
        occurredAt,
        `synthetic body ${sequence}`,
        `content-${sequence}`,
        pending && pendingOrdinal % 17 === 16 ? now : null
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function readPending(ledger, scenario, limit = 1_000) {
  return ledger.listUnembeddedComments(`benchmark-${scenario}`, limit);
}

function readStreams(ledger) {
  const streamIds = ["stream-0", "stream-99"];
  return streamIds.map((streamId) => {
    const watermark = ledger.getStreamFinalAcceptedSequence(streamId);
    return {
      streamId,
      watermark,
      comments: ledger.listStreamCommentsThrough(streamId, watermark),
      ready: ledger.areStreamCommentsEmbeddedThrough(streamId, watermark),
    };
  });
}

function readStats(ledger) {
  return ledger.getIngestionQueueStats(now);
}

function readSnapshot(ledger, scenario) {
  return {
    pending: readPending(ledger, scenario),
    streams: readStreams(ledger),
    missing: {
      watermark: ledger.getStreamFinalAcceptedSequence("missing-stream"),
      comments: ledger.listStreamCommentsThrough("missing-stream", rowCount),
    },
    stats: readStats(ledger),
  };
}

function measureAlternating(baselineOperation, currentOperation, rounds = 9) {
  baselineOperation();
  currentOperation();
  const baselineSamples = [];
  const currentSamples = [];
  const measure = (operation) => {
    const startedAt = performance.now();
    for (let repeat = 0; repeat < operationRepeats; repeat += 1) operation();
    return (performance.now() - startedAt) / operationRepeats;
  };
  for (let round = 0; round < rounds; round += 1) {
    if (round % 2 === 0) {
      baselineSamples.push(measure(baselineOperation));
      currentSamples.push(measure(currentOperation));
    } else {
      currentSamples.push(measure(currentOperation));
      baselineSamples.push(measure(baselineOperation));
    }
  }
  const baseline = summarize(baselineSamples);
  const current = summarize(currentSamples);
  return {
    baseline: formatMetric(baseline),
    current: formatMetric(current),
    medianSpeedup: baseline.medianMs / current.medianMs,
    p95Speedup: baseline.p95Ms / current.p95Ms,
  };
}

function measureWrites(Ledger, dbPath) {
  const ledger = new Ledger(dbPath);
  const startedAt = performance.now();
  for (let index = 0; index < 200; index += 1) {
    ledger.acceptComment({
      eventId: `write-${index}`,
      channel: "benchmark-write",
      channelId: "channel-id",
      streamId: "write-stream",
      userId: "viewer-id",
      userLogin: "viewer",
      userDisplayName: "Viewer",
      occurredAt: new Date(
        Date.parse("2026-09-05T00:00:00.000Z") + index * 1_000
      ).toISOString(),
      body: `synthetic write ${index}`,
    });
  }
  for (let index = 0; index < 10; index += 1) {
    const batch = ledger.sealNextBatch({
      workspaceSlug: "benchmark",
      maxComments: 20,
    });
    ledger.markBatchUploaded(
      batch.batchId,
      batch.documentName,
      `custom-documents/${batch.batchId}.json`
    );
    ledger.markBatchEmbedded(batch.batchId, "benchmark");
  }
  const elapsedMs = performance.now() - startedAt;
  ledger.close();
  return elapsedMs;
}

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "twitchraid-ledger-benchmark-")
);

try {
  const readResults = {};
  const databaseSizes = {};
  for (const scenario of scenarios) {
    const seedPath = path.join(tempRoot, `${scenario}-seed.sqlite`);
    const baselinePath = path.join(tempRoot, `${scenario}-baseline.sqlite`);
    const currentPath = path.join(tempRoot, `${scenario}-current.sqlite`);
    seedFixture(seedPath, scenario);
    fs.copyFileSync(seedPath, baselinePath);
    fs.copyFileSync(seedPath, currentPath);

    const baselineLedger = new BaselineLedger(baselinePath);
    const currentLedger = new CurrentLedger(currentPath);
    try {
      const baselineSnapshot = readSnapshot(baselineLedger, scenario);
      const currentSnapshot = readSnapshot(currentLedger, scenario);
      if (!isDeepStrictEqual(baselineSnapshot, currentSnapshot)) {
        throw new Error(`${scenario} public result mismatch`);
      }
      readResults[scenario] = {
        combined: measureAlternating(
          () => readSnapshot(baselineLedger, scenario),
          () => readSnapshot(currentLedger, scenario)
        ),
        ...Object.fromEntries(
          [20, 100, 1_000].map((limit) => [
            `listUnembeddedLimit${limit}`,
            measureAlternating(
              () => readPending(baselineLedger, scenario, limit),
              () => readPending(currentLedger, scenario, limit)
            ),
          ])
        ),
        streamReads: measureAlternating(
          () => readStreams(baselineLedger),
          () => readStreams(currentLedger)
        ),
        queueStats: measureAlternating(
          () => readStats(baselineLedger),
          () => readStats(currentLedger)
        ),
      };
    } finally {
      baselineLedger.close();
      currentLedger.close();
    }
    databaseSizes[scenario] = {
      baselineBytes: fs.statSync(baselinePath).size,
      currentBytes: fs.statSync(currentPath).size,
    };
  }

  const migrationSamples = { baseline: [], current: [] };
  const writeSamples = { baseline: [], current: [] };
  for (let round = 0; round < 5; round += 1) {
    for (const [label, Ledger] of round % 2 === 0
      ? [["baseline", BaselineLedger], ["current", CurrentLedger]]
      : [["current", CurrentLedger], ["baseline", BaselineLedger]]) {
      const migrationPath = path.join(tempRoot, `migration-${label}-${round}.sqlite`);
      fs.copyFileSync(path.join(tempRoot, "sparse-seed.sqlite"), migrationPath);
      const migrationStartedAt = performance.now();
      new Ledger(migrationPath).close();
      migrationSamples[label].push(performance.now() - migrationStartedAt);
      writeSamples[label].push(
        measureWrites(
          Ledger,
          path.join(tempRoot, `write-${label}-${round}.sqlite`)
        )
      );
    }
  }

  const output = {
    rowsPerScenario: rowCount,
    syntheticOnly: true,
    modules: {
      baseline: baselineModulePath,
      current: currentModulePath,
    },
    publicResultsEqual: true,
    thresholds: {
      sparseMinimumSpeedup,
      denseSmallLimitMaximumOverheadMs,
      denseLargeLimitMinimumSpeedup,
    },
    reads: Object.fromEntries(
      Object.entries(readResults).map(([scenario, metrics]) => [
        scenario,
        Object.fromEntries(
          Object.entries(metrics).map(([name, result]) => [
            name,
            {
              ...result,
              medianSpeedup: Number(result.medianSpeedup.toFixed(2)),
              p95Speedup: Number(result.p95Speedup.toFixed(2)),
            },
          ])
        ),
      ])
    ),
    reference: {
      migration: {
        baseline: formatMetric(summarize(migrationSamples.baseline)),
        current: formatMetric(summarize(migrationSamples.current)),
      },
      acceptAndTenSmallBatchUpdates: {
        baseline: formatMetric(summarize(writeSamples.baseline)),
        current: formatMetric(summarize(writeSamples.current)),
      },
      databaseSizes,
    },
  };

  const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;
  console.log(serializedOutput.trimEnd());
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serializedOutput, "utf8");
  }

  if (shouldAssert) {
    const sparse = readResults.sparse.combined;
    if (
      sparse.medianSpeedup < sparseMinimumSpeedup ||
      sparse.p95Speedup < sparseMinimumSpeedup
    ) {
      throw new Error(
        `sparse read speedup must be at least ${sparseMinimumSpeedup}x (median ${sparse.medianSpeedup.toFixed(2)}x, p95 ${sparse.p95Speedup.toFixed(2)}x)`
      );
    }
    for (const metricName of [
      "listUnembeddedLimit20",
      "listUnembeddedLimit100",
      "listUnembeddedLimit1000",
      "streamReads",
      "queueStats",
    ]) {
      const metric = readResults.sparse[metricName];
      if (metric.medianSpeedup < sparseMinimumSpeedup) {
        throw new Error(
          `sparse ${metricName} median speedup ${metric.medianSpeedup.toFixed(2)}x is below ${sparseMinimumSpeedup}x`
        );
      }
    }
    for (const scenario of ["dense", "dense-unbatched"]) {
      for (const limit of [20, 100, 1_000]) {
        const denseList = readResults[scenario][
          `listUnembeddedLimit${limit}`
        ];
        if (
          limit < 1_000 &&
          denseList.current.medianMs >
            denseList.baseline.medianMs + denseSmallLimitMaximumOverheadMs
        ) {
          throw new Error(
            `${scenario} listUnembedded limit ${limit} added more than ${denseSmallLimitMaximumOverheadMs} ms median overhead`
          );
        }
        if (
          limit === 1_000 &&
          denseList.medianSpeedup < denseLargeLimitMinimumSpeedup
        ) {
          throw new Error(
            `${scenario} listUnembedded limit ${limit} median ${denseList.medianSpeedup.toFixed(2)}x is below ${denseLargeLimitMinimumSpeedup}x baseline`
          );
        }
      }
    }
  }

} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
