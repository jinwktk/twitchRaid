import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import mentionChatModule from "../dist/commands/mention-chat.js";
import clipCacheStoreModule from "../dist/commands/clip-cache-store.js";
import commentSpeedMeterModule from "../dist/chat/comment-speed-meter.js";

const { createMentionChatMatcher } = mentionChatModule;
const { ClipCacheStore } = clipCacheStoreModule;
const { CommentSpeedMeter } = commentSpeedMeterModule;

const shouldAssert = process.argv.includes("--assert");

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(operation, iterations, rounds = 5) {
  operation(Math.min(iterations, 20_000));
  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const startedAt = performance.now();
    operation(iterations);
    samples.push(performance.now() - startedAt);
  }
  return median(samples);
}

function assertPerformance(condition, message) {
  if (shouldAssert && !condition) throw new Error(message);
}

function legacyExtractMentionChatPrompt(text, aliases) {
  const mentionNameChars = "\\p{L}\\p{N}_";
  const normalizedAliases = [
    ...new Set(
      aliases
        .map((alias) => alias.trim().replace(/^[@＠]+/, "").toLowerCase())
        .filter(Boolean)
    ),
  ];
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alias = normalizedAliases.find((candidate) =>
    new RegExp(
      `(^|[^${mentionNameChars}])[@＠]${escapeRegExp(candidate)}(?![${mentionNameChars}])`,
      "iu"
    ).test(text)
  );
  if (!alias) return null;
  let prompt = text;
  for (const candidate of normalizedAliases) {
    prompt = prompt.replace(
      new RegExp(
        `(^|[^${mentionNameChars}])[@＠]${escapeRegExp(candidate)}(?![${mentionNameChars}])`,
        "giu"
      ),
      (_match, prefix) => prefix
    );
  }
  return { alias, prompt: prompt.replace(/\s+/g, " ").trim() };
}

function benchmarkMentionMatcher() {
  const aliases = ["rukalun", "rukalun_bot"];
  const matcher = createMentionChatMatcher(aliases);
  const messages = [
    "普通のチャットです",
    "今日も配信たのしい",
    "@someone こんにちは",
    "メンションではない文章",
  ];
  const iterations = 300_000;
  const legacyMs = measure((count) => {
    for (let index = 0; index < count; index += 1) {
      legacyExtractMentionChatPrompt(messages[index % messages.length], aliases);
    }
  }, iterations);
  const optimizedMs = measure((count) => {
    for (let index = 0; index < count; index += 1) {
      matcher.extract(messages[index % messages.length]);
    }
  }, iterations);
  const speedup = legacyMs / optimizedMs;
  assertPerformance(
    speedup >= 5,
    `mention matcher speedup ${speedup.toFixed(2)}x is below 5x`
  );
  return { legacyMs, optimizedMs, speedup };
}

class ShiftCommentSpeedMeter {
  constructor(windowSeconds) {
    this.windowSeconds = windowSeconds;
    this.timestamps = [];
  }

  record(timestamp) {
    this.timestamps.push(timestamp);
    const cutoff = timestamp - this.windowSeconds;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}

function benchmarkCommentSpeedMeter() {
  const messageCount = 200_000;
  const run = (Meter, count = messageCount, messagesPerSecond = 1_000) => {
    const meter = new Meter(60);
    for (let index = 0; index < count; index += 1) {
      meter.record(index / messagesPerSecond);
    }
  };
  const legacyMs = measure((count) => {
    for (let index = 0; index < count; index += 1) run(ShiftCommentSpeedMeter);
  }, 1, 3);
  const optimizedMs = measure((count) => {
    for (let index = 0; index < count; index += 1) run(CommentSpeedMeter);
  }, 1, 3);
  const speedup = legacyMs / optimizedMs;
  assertPerformance(
    speedup >= 20,
    `comment meter speedup ${speedup.toFixed(2)}x is below 20x`
  );
  const typicalMessageCount = 30_000;
  const typicalLegacyMs = measure((count) => {
    for (let index = 0; index < count; index += 1) {
      run(ShiftCommentSpeedMeter, typicalMessageCount, 100);
    }
  }, 1, 3);
  const typicalOptimizedMs = measure((count) => {
    for (let index = 0; index < count; index += 1) {
      run(CommentSpeedMeter, typicalMessageCount, 100);
    }
  }, 1, 3);
  return {
    legacyMs,
    optimizedMs,
    speedup,
    messageCount,
    typical100PerSecond: {
      messageCount: typicalMessageCount,
      legacyMs: typicalLegacyMs,
      optimizedMs: typicalOptimizedMs,
      speedup: typicalLegacyMs / typicalOptimizedMs,
    },
  };
}

function createLegacyClipDatabase(dbPath, rowCount) {
  const bootstrap = new ClipCacheStore(dbPath);
  bootstrap.close();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    DROP INDEX IF EXISTS idx_clip_cache_available_created_at_id;
    DROP INDEX IF EXISTS idx_clip_cache_creator_id_available_created_at_id;
    DROP INDEX IF EXISTS idx_clip_cache_creator_name_available_created_at_id;
    CREATE INDEX IF NOT EXISTS idx_clip_cache_available_created_at
      ON clip_cache (unavailable_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_clip_cache_creator_id
      ON clip_cache (creator_id);
    CREATE INDEX IF NOT EXISTS idx_clip_cache_creator_name
      ON clip_cache (creator_name_lower);
  `);
  const insert = db.prepare(`
    INSERT INTO clip_cache (
      id, url, title, creator_id, creator_display_name, creator_name_lower,
      game_id, game_name, thumbnail_url, created_at, views, last_seen_at,
      unavailable_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  db.exec("BEGIN");
  try {
    for (let index = 0; index < rowCount; index += 1) {
      const id = `clip-${String(index).padStart(6, "0")}`;
      const creatorNumber = index % 100;
      insert.run(
        id,
        `https://clips.twitch.tv/${id}`,
        index % 100 === 0 ? `Raid highlight ${index}` : `雑談 ${index}`,
        `creator-${creatorNumber}`,
        `Viewer${creatorNumber}`,
        `viewer${creatorNumber}`,
        "game",
        "Game",
        null,
        new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        index,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return db;
}

function escapeSqlLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

class LegacyClipCacheStore {
  constructor(dbPath, maxHistoryPerKey = 200) {
    this.db = new DatabaseSync(dbPath);
    this.maxHistoryPerKey = maxHistoryPerKey;
  }

  close() {
    this.db.close();
  }

  getRecentIds(historyKey) {
    return this.db
      .prepare(
        "SELECT clip_id FROM clip_history WHERE history_key = ? ORDER BY shown_at DESC"
      )
      .all(historyKey)
      .map((row) => row.clip_id);
  }

  recordHistory(historyKey, clipId, shownAt) {
    this.db
      .prepare(
        `INSERT INTO clip_history (history_key, clip_id, shown_at)
         VALUES (?, ?, ?)
         ON CONFLICT(history_key, clip_id) DO UPDATE SET shown_at = excluded.shown_at`
      )
      .run(historyKey, clipId, shownAt);
    this.db
      .prepare(
        `DELETE FROM clip_history
         WHERE history_key = ?
           AND clip_id NOT IN (
             SELECT clip_id FROM clip_history
             WHERE history_key = ?
             ORDER BY shown_at DESC
             LIMIT ?
           )`
      )
      .run(historyKey, historyKey, this.maxHistoryPerKey);
  }

  findRandomCandidateRow(creatorId, creatorName, excludeIds, random) {
    const filters = [];
    const params = [];
    if (creatorId) {
      filters.push("creator_id = ?");
      params.push(creatorId);
    }
    const normalizedCreatorName = creatorName?.trim().toLowerCase();
    if (normalizedCreatorName) {
      filters.push("creator_name_lower = ?");
      params.push(normalizedCreatorName);
    }
    if (excludeIds.length > 0) {
      filters.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`);
      params.push(...excludeIds);
    }
    filters.push("unavailable_at IS NULL");
    return this.findRandomRow(filters, params, random);
  }

  findRandomSearchCandidateRow(query, excludeIds, random) {
    const escapedQuery = escapeSqlLike(query);
    const pattern = `%${escapedQuery}%`;
    const filters = [
      "(title LIKE ? ESCAPE '\\' OR creator_name_lower LIKE ? ESCAPE '\\' OR game_name LIKE ? ESCAPE '\\')",
      "unavailable_at IS NULL",
    ];
    const params = [pattern, `%${escapeSqlLike(query.toLowerCase())}%`, pattern];
    if (excludeIds.length > 0) {
      filters.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`);
      params.push(...excludeIds);
    }
    return this.findRandomRow(filters, params, random);
  }

  findRandomRow(filters, params, random) {
    const where = `WHERE ${filters.join(" AND ")}`;
    const count = this.db
      .prepare(`SELECT COUNT(*) AS count FROM clip_cache ${where}`)
      .get(...params).count;
    if (count === 0) return null;
    const offset = Math.min(Math.floor(random() * count), count - 1);
    return this.db
      .prepare(
        `SELECT * FROM clip_cache ${where} ` +
          "ORDER BY created_at DESC, id ASC LIMIT 1 OFFSET ?"
      )
      .get(...params, offset);
  }

  selectRandomClip({ historyKey, creatorId, creatorName, random }) {
    const recentIds = this.getRecentIds(historyKey);
    const row =
      this.findRandomCandidateRow(creatorId, creatorName, recentIds, random) ??
      this.findRandomCandidateRow(creatorId, creatorName, [], random);
    return row ? { id: row.id, url: row.url, title: row.title } : null;
  }

  searchRandomClip({ historyKey, query, random }) {
    const normalizedQuery = query.trim().replace(/\s+/g, " ");
    if (!normalizedQuery) return null;
    const recentIds = this.getRecentIds(historyKey);
    const row =
      this.findRandomSearchCandidateRow(normalizedQuery, recentIds, random) ??
      this.findRandomSearchCandidateRow(normalizedQuery, [], random);
    return row ? { id: row.id, url: row.url, title: row.title } : null;
  }
}

function measurePair(legacyOperation, optimizedOperation, batchSize, rounds = 7) {
  legacyOperation();
  optimizedOperation();
  const legacySamples = [];
  const optimizedSamples = [];
  const runBatch = (operation) => {
    const startedAt = performance.now();
    for (let index = 0; index < batchSize; index += 1) operation();
    return (performance.now() - startedAt) / batchSize;
  };
  for (let round = 0; round < rounds; round += 1) {
    if (round % 2 === 0) {
      legacySamples.push(runBatch(legacyOperation));
      optimizedSamples.push(runBatch(optimizedOperation));
    } else {
      optimizedSamples.push(runBatch(optimizedOperation));
      legacySamples.push(runBatch(legacyOperation));
    }
  }
  return {
    legacyMs: median(legacySamples),
    optimizedMs: median(optimizedSamples),
  };
}

function insertCompatibilityRows(db) {
  const rows = [
    ["same-a", "Raid Alpha", "creator-a", "ViewerA", "viewera", "2026-01-03T00:00:00.000Z", null],
    ["same-b", "Raid Beta", "creator-a", "ViewerA", "viewera", "2026-01-03T00:00:00.000Z", null],
    ["middle", "雑談", "creator-b", "ViewerB", "viewerb", "2026-01-02T00:00:00.000Z", null],
    ["old-a", "Raid Old", "creator-a", "ViewerA", "viewera", "2026-01-01T00:00:00.000Z", null],
    ["null-a", "Raid Null A", "creator-a", "ViewerA", "viewera", null, null],
    ["null-b", "Raid Null B", "creator-b", "ViewerB", "viewerb", null, null],
    ["gone", "Raid Gone", "creator-a", "ViewerA", "viewera", "2026-01-04T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
  ];
  const insert = db.prepare(`
    INSERT INTO clip_cache (
      id, url, title, creator_id, creator_display_name, creator_name_lower,
      game_id, game_name, thumbnail_url, created_at, views, last_seen_at,
      unavailable_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'game', 'Game', NULL, ?, 1, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    for (const [id, title, creatorId, displayName, lowerName, createdAt, unavailableAt] of rows) {
      insert.run(
        id,
        `https://clips.twitch.tv/${id}`,
        title,
        creatorId,
        displayName,
        lowerName,
        createdAt,
        "2026-01-05T00:00:00.000Z",
        unavailableAt,
        "2026-01-05T00:00:00.000Z"
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return rows.map(([id]) => id);
}

function verifyClipCompatibility(tempDir) {
  const legacyPath = path.join(tempDir, "compat-legacy.sqlite");
  const optimizedPath = path.join(tempDir, "compat-optimized.sqlite");
  const seedDb = createLegacyClipDatabase(legacyPath, 0);
  const availableIds = insertCompatibilityRows(seedDb).filter((id) => id !== "gone");
  seedDb.close();
  fs.copyFileSync(legacyPath, optimizedPath);
  const legacy = new LegacyClipCacheStore(legacyPath);
  const optimized = new ClipCacheStore(optimizedPath);
  let checks = 0;
  const compare = (legacyOperation, optimizedOperation, label) => {
    const legacyResult = legacyOperation();
    const optimizedResult = optimizedOperation();
    if (JSON.stringify(legacyResult) !== JSON.stringify(optimizedResult)) {
      throw new Error(
        `clip compatibility mismatch (${label}): legacy=${JSON.stringify(legacyResult)} optimized=${JSON.stringify(optimizedResult)}`
      );
    }
    checks += 1;
  };
  try {
    for (const randomValue of [0, 0.5, 0.999_999]) {
      for (const filter of [
        {},
        { creatorId: "creator-a" },
        { creatorName: "viewera" },
        { creatorId: "creator-a", creatorName: "viewera" },
      ]) {
        compare(
          () =>
            legacy.selectRandomClip({
              historyKey: `none-${randomValue}`,
              ...filter,
              random: () => randomValue,
            }),
          () =>
            optimized.selectRandomClip({
              historyKey: `none-${randomValue}`,
              ...filter,
              random: () => randomValue,
            }),
          `random=${randomValue},filter=${JSON.stringify(filter)}`
        );
      }
    }

    for (const [index, id] of ["same-a", "middle"].entries()) {
      legacy.recordHistory("partial", id, index + 1);
      optimized.recordHistory("partial", id, index + 1);
    }
    compare(
      () =>
        legacy.selectRandomClip({ historyKey: "partial", random: () => 0.5 }),
      () =>
        optimized.selectRandomClip({ historyKey: "partial", random: () => 0.5 }),
      "partial history"
    );

    for (const [index, id] of availableIds.entries()) {
      legacy.recordHistory("all", id, index + 1);
      optimized.recordHistory("all", id, index + 1);
    }
    compare(
      () => legacy.selectRandomClip({ historyKey: "all", random: () => 0.5 }),
      () => optimized.selectRandomClip({ historyKey: "all", random: () => 0.5 }),
      "all-history fallback"
    );

    legacy.recordHistory("search", "same-a", 1);
    optimized.recordHistory("search", "same-a", 1);
    for (const randomValue of [0, 0.5, 0.999_999]) {
      compare(
        () =>
          legacy.searchRandomClip({
            historyKey: "search",
            query: "Raid",
            random: () => randomValue,
          }),
        () =>
          optimized.searchRandomClip({
            historyKey: "search",
            query: "Raid",
            random: () => randomValue,
          }),
        `search history random=${randomValue}`
      );
    }
    return checks;
  } finally {
    legacy.close();
    optimized.close();
  }
}

function databaseStorage(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const pageSize = db.prepare("PRAGMA page_size").get().page_size;
    const pageCount = db.prepare("PRAGMA page_count").get().page_count;
    const freePages = db.prepare("PRAGMA freelist_count").get().freelist_count;
    return {
      fileBytes: fs.statSync(dbPath).size,
      activePageBytes: (pageCount - freePages) * pageSize,
      reusableFreeBytes: freePages * pageSize,
    };
  } finally {
    db.close();
  }
}

function createUpsertBatchOperation(db, rowCount = 500) {
  const statement = db.prepare(`
    INSERT INTO clip_cache (
      id, url, title, creator_id, creator_display_name, creator_name_lower,
      game_id, game_name, thumbnail_url, created_at, views, last_seen_at,
      unavailable_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'game', 'Game', NULL, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      creator_id = excluded.creator_id,
      creator_display_name = excluded.creator_display_name,
      creator_name_lower = excluded.creator_name_lower,
      game_id = excluded.game_id,
      game_name = excluded.game_name,
      thumbnail_url = excluded.thumbnail_url,
      created_at = excluded.created_at,
      views = excluded.views,
      last_seen_at = excluded.last_seen_at,
      unavailable_at = NULL,
      updated_at = excluded.updated_at
  `);
  let generation = 0;
  return () => {
    generation += 1;
    db.exec("BEGIN");
    try {
      for (let index = 0; index < rowCount; index += 1) {
        const id = `clip-${String(index).padStart(6, "0")}`;
        const creatorNumber = index % 100;
        const creatorName = `viewer${creatorNumber}${generation % 2 === 0 ? "" : "x"}`;
        statement.run(
          id,
          `https://clips.twitch.tv/${id}`,
          `更新 ${index}`,
          `creator-${creatorNumber}`,
          creatorName,
          creatorName,
          new Date(1_700_000_000_000 + index * 1_000).toISOString(),
          index + generation,
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z"
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
}

function benchmarkClipCache() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitchraid-clip-perf-"));
  const legacyPath = path.join(tempDir, "clips-legacy.sqlite");
  const optimizedPath = path.join(tempDir, "clips-optimized.sqlite");
  const rowCount = 50_000;
  const randomValue = 0.9;
  try {
    const seedDb = createLegacyClipDatabase(legacyPath, rowCount);
    seedDb.close();
    fs.copyFileSync(legacyPath, optimizedPath);
    const legacyStore = new LegacyClipCacheStore(legacyPath);
    const migrationStartedAt = performance.now();
    const store = new ClipCacheStore(optimizedPath);
    const migrationMs = performance.now() - migrationStartedAt;
    const legacyAll = () =>
      legacyStore.selectRandomClip({
        historyKey: "clip",
        random: () => randomValue,
      });
    const optimizedAll = () =>
      store.selectRandomClip({ historyKey: "clip", random: () => randomValue });
    const legacyCreator = () =>
      legacyStore.selectRandomClip({
        historyKey: "myclip:viewer42",
        creatorName: "viewer42",
        random: () => randomValue,
      });
    const optimizedCreator = () =>
      store.selectRandomClip({
        historyKey: "myclip:viewer42",
        creatorName: "viewer42",
        random: () => randomValue,
      });
    const legacySearch = () =>
      legacyStore.searchRandomClip({
        historyKey: "clipsearch:raid",
        query: "Raid",
        random: () => randomValue,
      });
    const optimizedSearch = () =>
      store.searchRandomClip({
        historyKey: "clipsearch:raid",
        query: "Raid",
        random: () => randomValue,
      });
    const all = measurePair(legacyAll, optimizedAll, 5);
    const creator = measurePair(legacyCreator, optimizedCreator, 50);
    const search = measurePair(legacySearch, optimizedSearch, 5);
    legacyStore.close();
    store.close();

    const legacyWriteDb = new DatabaseSync(legacyPath);
    const optimizedWriteDb = new DatabaseSync(optimizedPath);
    const upsertRowCount = 500;
    const upsert = measurePair(
      createUpsertBatchOperation(legacyWriteDb, upsertRowCount),
      createUpsertBatchOperation(optimizedWriteDb, upsertRowCount),
      1
    );
    legacyWriteDb.close();
    optimizedWriteDb.close();

    const allSpeedup = all.legacyMs / all.optimizedMs;
    const creatorSpeedup = creator.legacyMs / creator.optimizedMs;
    const searchSpeedup = search.legacyMs / search.optimizedMs;
    assertPerformance(
      allSpeedup >= 2,
      `random clip speedup ${allSpeedup.toFixed(2)}x is below 2x`
    );
    assertPerformance(
      creatorSpeedup >= 5,
      `creator clip speedup ${creatorSpeedup.toFixed(2)}x is below 5x`
    );
    assertPerformance(
      searchSpeedup >= 0.9,
      `clip search regressed to ${searchSpeedup.toFixed(2)}x of legacy speed`
    );
    const upsertSpeedup = upsert.legacyMs / upsert.optimizedMs;
    assertPerformance(
      upsertSpeedup >= 0.4,
      `clip upsert regressed to ${upsertSpeedup.toFixed(2)}x of legacy speed`
    );
    return {
      rowCount,
      compatibilityChecks: verifyClipCompatibility(tempDir),
      migrationMs,
      databaseStorage: {
        legacy: databaseStorage(legacyPath),
        optimized: databaseStorage(optimizedPath),
      },
      all: { ...all, speedup: allSpeedup },
      creator: {
        ...creator,
        speedup: creatorSpeedup,
      },
      search: {
        ...search,
        speedup: searchSpeedup,
      },
      upsert: {
        rowCount: upsertRowCount,
        ...upsert,
        legacyPerRowMs: upsert.legacyMs / upsertRowCount,
        optimizedPerRowMs: upsert.optimizedMs / upsertRowCount,
        speedup: upsertSpeedup,
      },
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const result = {
  mentionMatcher: benchmarkMentionMatcher(),
  commentSpeedMeter: benchmarkCommentSpeedMeter(),
  clipCache: benchmarkClipCache(),
};

console.log(JSON.stringify(result, null, 2));
