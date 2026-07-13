import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import mentionChatModule from "../dist/commands/mention-chat.js";
import clipCacheStoreModule from "../dist/commands/clip-cache-store.js";
import commentSpeedMeterModule from "../dist/chat/comment-speed-meter.js";

const { createMentionChatMatcher, extractMentionChatPrompt } = mentionChatModule;
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
      extractMentionChatPrompt(messages[index % messages.length], aliases);
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
  const run = (Meter) => {
    const meter = new Meter(60);
    for (let index = 0; index < messageCount; index += 1) {
      meter.record(index / 1_000);
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
  return { legacyMs, optimizedMs, speedup, messageCount };
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

function legacyRandomClip(db, filters, params, randomValue) {
  const where = `WHERE ${[...filters, "unavailable_at IS NULL"].join(" AND ")}`;
  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM clip_cache ${where}`)
    .get(...params).count;
  const offset = Math.min(Math.floor(randomValue * count), count - 1);
  return db
    .prepare(
      `SELECT id FROM clip_cache ${where} ` +
        "ORDER BY created_at DESC, id ASC LIMIT 1 OFFSET ?"
    )
    .get(...params, offset).id;
}

function legacyRandomSearchClip(db, randomValue) {
  const filters =
    "(title LIKE ? ESCAPE '\\' OR creator_name_lower LIKE ? ESCAPE '\\' OR game_name LIKE ? ESCAPE '\\') AND unavailable_at IS NULL";
  const params = ["%Raid%", "%raid%", "%Raid%"];
  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM clip_cache WHERE ${filters}`)
    .get(...params).count;
  const offset = Math.min(Math.floor(randomValue * count), count - 1);
  return db
    .prepare(
      `SELECT id FROM clip_cache WHERE ${filters} ` +
        "ORDER BY created_at DESC, id ASC LIMIT 1 OFFSET ?"
    )
    .get(...params, offset).id;
}

function benchmarkClipCache() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitchraid-clip-perf-"));
  const dbPath = path.join(tempDir, "clips.sqlite");
  const rowCount = 50_000;
  const randomValue = 0.9;
  try {
    const legacyDb = createLegacyClipDatabase(dbPath, rowCount);
    const legacyAllId = legacyRandomClip(legacyDb, [], [], randomValue);
    const legacyCreatorId = legacyRandomClip(
      legacyDb,
      ["creator_name_lower = ?"],
      ["viewer42"],
      randomValue
    );
    const legacySearchId = legacyRandomSearchClip(legacyDb, randomValue);
    const legacyAllMs = measure(
      (count) => {
        for (let index = 0; index < count; index += 1) {
          legacyRandomClip(legacyDb, [], [], randomValue);
        }
      },
      1,
      7
    );
    const legacyCreatorMs = measure(
      (count) => {
        for (let index = 0; index < count; index += 1) {
          legacyRandomClip(
            legacyDb,
            ["creator_name_lower = ?"],
            ["viewer42"],
            randomValue
          );
        }
      },
      1,
      7
    );
    const legacySearchMs = measure(
      (count) => {
        for (let index = 0; index < count; index += 1) {
          legacyRandomSearchClip(legacyDb, randomValue);
        }
      },
      1,
      7
    );
    legacyDb.close();

    const store = new ClipCacheStore(dbPath);
    const optimizedAll = () =>
      store.selectRandomClip({ historyKey: "clip", random: () => randomValue });
    const optimizedCreator = () =>
      store.selectRandomClip({
        historyKey: "myclip:viewer42",
        creatorName: "viewer42",
        random: () => randomValue,
      });
    const optimizedSearch = () =>
      store.searchRandomClip({
        historyKey: "clipsearch:raid",
        query: "Raid",
        random: () => randomValue,
      });
    const allResult = optimizedAll();
    const creatorResult = optimizedCreator();
    const searchResult = optimizedSearch();
    if (
      allResult?.id !== legacyAllId ||
      creatorResult?.id !== legacyCreatorId ||
      searchResult?.id !== legacySearchId
    ) {
      throw new Error("clip selection result changed during optimization");
    }
    const optimizedAllMs = measure((count) => {
      for (let index = 0; index < count; index += 1) optimizedAll();
    }, 1, 7);
    const optimizedCreatorMs = measure((count) => {
      for (let index = 0; index < count; index += 1) optimizedCreator();
    }, 1, 7);
    const optimizedSearchMs = measure((count) => {
      for (let index = 0; index < count; index += 1) optimizedSearch();
    }, 1, 7);
    store.close();

    const allSpeedup = legacyAllMs / optimizedAllMs;
    const creatorSpeedup = legacyCreatorMs / optimizedCreatorMs;
    const searchSpeedup = legacySearchMs / optimizedSearchMs;
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
    return {
      rowCount,
      all: { legacyMs: legacyAllMs, optimizedMs: optimizedAllMs, speedup: allSpeedup },
      creator: {
        legacyMs: legacyCreatorMs,
        optimizedMs: optimizedCreatorMs,
        speedup: creatorSpeedup,
      },
      search: {
        legacyMs: legacySearchMs,
        optimizedMs: optimizedSearchMs,
        speedup: searchSpeedup,
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
