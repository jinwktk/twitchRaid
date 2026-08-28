import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const RECENT_SYNC_STATE_KEY = "recent_sync_at";

function parseArgs(argv) {
  const args = {
    db: path.join("data", "clips.sqlite"),
    out: path.join("docs", "clip-search-data.json"),
    env: ".env",
    enrichFromTwitch: false,
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
    } else if (arg === "--env" && next) {
      args.env = next;
      index += 1;
    } else if (arg === "--enrich-from-twitch") {
      args.enrichFromTwitch = true;
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
  node scripts/export-clip-search-data.mjs [--db data/clips.sqlite] [--out docs/clip-search-data.json] [--limit 3000] [--enrich-from-twitch] [--env .env]

Exports public clip search data for Vercel.
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

function tableColumns(db, tableName) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => String(column.name))
  );
}

function selectColumn(columns, columnName) {
  return columns.has(columnName) ? columnName : `NULL AS ${columnName}`;
}

function readClips(db, limit) {
  const limitSql = limit ? "LIMIT ?" : "";
  const params = limit ? [limit] : [];
  const columns = tableColumns(db, "clip_cache");
  const rows = db
    .prepare(
      `
      SELECT
        id,
        url,
        title,
        creator_display_name,
        ${selectColumn(columns, "game_name")},
        ${selectColumn(columns, "thumbnail_url")},
        created_at,
        views
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
    gameName: row.game_name == null ? null : String(row.game_name),
    thumbnailUrl: row.thumbnail_url == null ? null : String(row.thumbnail_url),
    createdAt: row.created_at == null ? null : String(row.created_at),
    views: row.views == null ? null : Number(row.views),
  }));
}

function readPreviousClipDetails(outPath) {
  if (!fs.existsSync(outPath)) return new Map();

  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
    return new Map(
      clips
        .filter((clip) => typeof clip?.id === "string")
        .map((clip) => [
          clip.id,
          {
            gameName:
              typeof clip.gameName === "string" && clip.gameName.trim()
                ? clip.gameName
                : null,
            thumbnailUrl:
              typeof clip.thumbnailUrl === "string" && clip.thumbnailUrl.trim()
                ? clip.thumbnailUrl
                : null,
          },
        ])
    );
  } catch {
    return new Map();
  }
}

function preservePreviousClipDetails(clips, previousDetails) {
  if (previousDetails.size === 0) return clips;

  return clips.map((clip) => {
    const previous = previousDetails.get(clip.id);
    if (!previous) return clip;

    return {
      ...clip,
      gameName: clip.gameName ?? previous.gameName,
      thumbnailUrl: clip.thumbnailUrl ?? previous.thumbnailUrl,
    };
  });
}

function writeJson(outPath, payload) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function createTwitchApiClient(envPath) {
  const [{ config: dotenvConfig }, { ApiClient }, { RefreshingAuthProvider }] =
    await Promise.all([
      import("dotenv"),
      import("@twurple/api"),
      import("@twurple/auth"),
    ]);
  const env = dotenvConfig({ path: envPath }).parsed ?? {};
  const requiredKeys = [
    "TWITCH_CLIENT_ID",
    "TWITCH_SECRET_TOKEN",
    "TWITCH_ACCESS_TOKEN",
    "TWITCH_REFRESH_TOKEN",
  ];
  const missingKeys = requiredKeys.filter((key) => !env[key]);
  if (missingKeys.length > 0) {
    throw new Error(`Missing Twitch env values: ${missingKeys.join(", ")}`);
  }

  const authProvider = new RefreshingAuthProvider({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_SECRET_TOKEN,
  });
  await authProvider.addUserForToken(
    {
      accessToken: env.TWITCH_ACCESS_TOKEN,
      refreshToken: env.TWITCH_REFRESH_TOKEN,
      expiresIn: null,
      obtainmentTimestamp: Date.now(),
      scope: [],
    },
    ["api"]
  );

  return new ApiClient({ authProvider });
}

async function enrichClipsFromTwitch(clips, envPath) {
  if (clips.length === 0) return clips;

  const apiClient = await createTwitchApiClient(envPath);
  const clipDetails = new Map();
  for (const ids of chunkArray(
    clips.map((clip) => clip.id),
    100
  )) {
    const fetchedClips = await apiClient.clips.getClipsByIds(ids);
    for (const clip of fetchedClips) {
      clipDetails.set(clip.id, {
        gameId: clip.gameId || null,
        thumbnailUrl: clip.thumbnailUrl || null,
      });
    }
  }

  const gameIds = [
    ...new Set(
      [...clipDetails.values()]
        .map((clip) => clip.gameId)
        .filter((gameId) => Boolean(gameId))
    ),
  ];
  const gameNamesById = new Map();
  for (const ids of chunkArray(gameIds, 100)) {
    const games = await apiClient.games.getGamesByIds(ids);
    for (const game of games) {
      gameNamesById.set(game.id, game.name);
    }
  }

  let enriched = 0;
  const mergedClips = clips.map((clip) => {
    const detail = clipDetails.get(clip.id);
    if (!detail) return clip;
    const thumbnailUrl = detail.thumbnailUrl ?? clip.thumbnailUrl ?? null;
    const gameName = detail.gameId
      ? gameNamesById.get(detail.gameId) ?? clip.gameName ?? null
      : clip.gameName ?? null;
    if (thumbnailUrl || gameName) enriched += 1;
    return {
      ...clip,
      gameName,
      thumbnailUrl,
    };
  });

  console.log(`Enriched ${enriched} clips from Twitch API`);
  return mergedClips;
}

async function main() {
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
    const previousDetails = readPreviousClipDetails(args.out);
    let clips = preservePreviousClipDetails(
      readClips(db, args.limit),
      previousDetails
    );
    if (args.enrichFromTwitch) {
      clips = await enrichClipsFromTwitch(clips, args.env);
    }
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
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    message
      .replace(/(client_secret=)[^&\s]+/g, "$1[redacted]")
      .replace(/(refresh_token=)[^&\s]+/g, "$1[redacted]")
      .replace(/(access_token=)[^&\s]+/g, "$1[redacted]")
  );
  process.exitCode = 1;
}
