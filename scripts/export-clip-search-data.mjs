import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const RECENT_SYNC_STATE_KEY = "recent_sync_at";

function parseArgs(argv) {
  const args = {
    db: path.join("data", "clips.sqlite"),
    out: path.join("docs", "clip-search-data.json"),
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--db" && next) {
      args.db = next;
      index += 1;
    } else if (arg === "--out" && next) {
      args.out = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      const limit = Number.parseInt(next, 10);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error("--limit must be a positive integer");
      }
      args.limit = limit;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/export-clip-search-data.mjs [--db data/clips.sqlite] [--out docs/clip-search-data.json] [--limit 3000]

Exports public clip search data for GitHub Pages.
`);
}

function ensureClipCacheExists(db) {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'clip_cache'"
    )
    .get();

  if (!row) {
    throw new Error("clip_cache table was not found");
  }
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

function readSyncState(db, key) {
  if (!tableExists(db, "clip_sync_state")) {
    return null;
  }

  const row = db
    .prepare("SELECT value FROM clip_sync_state WHERE key = ?")
    .get(key);

  return row?.value == null ? null : String(row.value);
}

function readClips(db, limit) {
  const limitSql = limit ? "LIMIT ?" : "";
  const params = limit ? [limit] : [];
  const rows = db
    .prepare(
      `
      SELECT id, url, title, creator_display_name, created_at, views
      FROM clip_cache
      WHERE unavailable_at IS NULL
      ORDER BY created_at DESC, id ASC
      ${limitSql}
    `
    )
    .all(...params);

  return rows.map((row) => ({
    id: String(row.id),
    url: String(row.url),
    title: String(row.title),
    creator: String(row.creator_display_name),
    createdAt: row.created_at == null ? null : String(row.created_at),
    views: row.views == null ? null : Number(row.views),
  }));
}

function writeJson(outPath, payload) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(args.db)) {
    throw new Error(`SQLite database was not found: ${args.db}`);
  }

  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    ensureClipCacheExists(db);
    const clips = readClips(db, args.limit);
    const payload = {
      generatedAt: new Date().toISOString(),
      total: clips.length,
      clipSync: {
        recentSyncedAt: readSyncState(db, RECENT_SYNC_STATE_KEY),
      },
      clips,
    };
    writeJson(args.out, payload);
    console.log(`Exported ${clips.length} clips to ${args.out}`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
