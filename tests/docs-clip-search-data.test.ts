import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clip-search-data-"));
}

function createClipCache(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE clip_cache (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      creator_display_name TEXT NOT NULL,
      creator_name_lower TEXT NOT NULL,
      game_id TEXT,
      game_name TEXT,
      thumbnail_url TEXT,
      created_at TEXT,
      views INTEGER,
      last_seen_at TEXT,
      unavailable_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE clip_sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function runExporter(dbPath: string, outPath: string): void {
  execFileSync(process.execPath, [
    path.join(process.cwd(), "scripts", "export-clip-search-data.mjs"),
    "--db",
    dbPath,
    "--out",
    outPath,
  ]);
}

function insertClip(
  db: DatabaseSync,
  overrides: Partial<{
    id: string;
    title: string;
    views: number;
    unavailableAt: string | null;
  }> = {}
): void {
  const id = overrides.id ?? "clip-1";
  db.prepare(`
    INSERT INTO clip_cache (
      id,
      url,
      title,
      creator_id,
      creator_display_name,
      creator_name_lower,
      game_id,
      game_name,
      thumbnail_url,
      created_at,
      views,
      last_seen_at,
      unavailable_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    `https://www.twitch.tv/rukalun/clip/${id}`,
    overrides.title ?? "同じClip",
    "creator-secret",
    "Alice",
    "alice",
    "509658",
    "Just Chatting",
    `https://clips-media-assets2.twitch.tv/${id}-preview-480x272.jpg`,
    "2026-01-01T00:00:00.000Z",
    overrides.views ?? 12,
    "2026-01-01T00:00:00.000Z",
    overrides.unavailableAt ?? null,
    "2026-01-01T00:00:00.000Z"
  );
}

function insertRecentSyncState(db: DatabaseSync, value: string): void {
  db.prepare(
    "INSERT INTO clip_sync_state (key, value, updated_at) VALUES (?, ?, ?)"
  ).run("recent_sync_at", value, value);
}

function publicClip(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "clip-1",
    url: "https://www.twitch.tv/rukalun/clip/clip-1",
    title: "同じClip",
    creator: "Alice",
    gameName: "Just Chatting",
    thumbnailUrl:
      "https://clips-media-assets2.twitch.tv/clip-1-preview-480x272.jpg",
    createdAt: "2026-01-01T00:00:00.000Z",
    views: 12,
    ...overrides,
  };
}

describe("export-clip-search-data", () => {
  it("exports only public fields for available clips in newest order", () => {
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "clips.sqlite");
    const outPath = path.join(tempDir, "clip-search-data.json");
    const db = createClipCache(dbPath);

    const insert = db.prepare(`
      INSERT INTO clip_cache (
        id,
        url,
        title,
        creator_id,
        creator_display_name,
        creator_name_lower,
        game_id,
        game_name,
        thumbnail_url,
        created_at,
        views,
        last_seen_at,
        unavailable_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.prepare(
      "INSERT INTO clip_sync_state (key, value, updated_at) VALUES (?, ?, ?)"
    ).run(
      "recent_sync_at",
      "2026-01-02T03:04:05.000Z",
      "2026-01-02T03:04:05.000Z"
    );
    insert.run(
      "old",
      "https://www.twitch.tv/rukalun/clip/old",
      "古いかわいいClip",
      "creator-secret",
      "Alice",
      "alice",
      "509658",
      "Just Chatting",
      "https://clips-media-assets2.twitch.tv/old-preview-480x272.jpg",
      "2026-01-01T00:00:00.000Z",
      12,
      "2026-01-01T00:00:00.000Z",
      null,
      "2026-01-01T00:00:00.000Z"
    );
    insert.run(
      "new",
      "https://www.twitch.tv/rukalun/clip/new",
      "新しいふわふわClip",
      "creator-secret-2",
      "Bob",
      "bob",
      "24241",
      "FINAL FANTASY XIV ONLINE",
      "https://clips-media-assets2.twitch.tv/new-preview-480x272.jpg",
      "2026-01-02T00:00:00.000Z",
      34,
      "2026-01-02T00:00:00.000Z",
      null,
      "2026-01-02T00:00:00.000Z"
    );
    insert.run(
      "missing-details",
      "https://www.twitch.tv/rukalun/clip/missing-details",
      "補完を引き継ぐClip",
      "creator-secret-4",
      "Diana",
      "diana",
      null,
      null,
      null,
      "2026-01-01T12:00:00.000Z",
      22,
      "2026-01-01T12:00:00.000Z",
      null,
      "2026-01-01T12:00:00.000Z"
    );
    insert.run(
      "hidden",
      "https://www.twitch.tv/rukalun/clip/hidden",
      "消えたClip",
      "creator-secret-3",
      "Carol",
      "carol",
      "999",
      "Hidden Game",
      "https://clips-media-assets2.twitch.tv/hidden-preview-480x272.jpg",
      "2026-01-03T00:00:00.000Z",
      56,
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z"
    );
    db.close();
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        clips: [
          {
            id: "missing-details",
            gameName: "Previous Game",
            thumbnailUrl: "https://static.example/missing-details.jpg",
          },
        ],
      })
    );

    runExporter(dbPath, outPath);

    const exported = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
      generatedAt: string;
      total: number;
      clipSync: {
        recentSyncedAt: string | null;
      };
      clips: Array<Record<string, unknown>>;
    };

    expect(exported.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.total).toBe(3);
    expect(exported.clipSync).toEqual({
      recentSyncedAt: "2026-01-02T03:04:05.000Z",
    });
    expect(exported.clips.map((clip) => clip.id)).toEqual([
      "new",
      "missing-details",
      "old",
    ]);
    expect(exported.clips[0]).toEqual({
      id: "new",
      url: "https://www.twitch.tv/rukalun/clip/new",
      title: "新しいふわふわClip",
      creator: "Bob",
      gameName: "FINAL FANTASY XIV ONLINE",
      thumbnailUrl: "https://clips-media-assets2.twitch.tv/new-preview-480x272.jpg",
      createdAt: "2026-01-02T00:00:00.000Z",
      views: 34,
    });
    expect(exported.clips[1]).toMatchObject({
      id: "missing-details",
      gameName: "Previous Game",
      thumbnailUrl: "https://static.example/missing-details.jpg",
    });
    expect(Object.keys(exported.clips[0]).sort()).toEqual([
      "createdAt",
      "creator",
      "gameName",
      "id",
      "thumbnailUrl",
      "title",
      "url",
      "views",
    ]);
  });

  it("keeps the existing bytes and generatedAt when only sync timestamps and JSON formatting differ", () => {
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "clips.sqlite");
    const outPath = path.join(tempDir, "clip-search-data.json");
    const db = createClipCache(dbPath);
    insertClip(db);
    insertRecentSyncState(db, "2026-01-02T04:05:06.000Z");
    db.close();

    const existing = JSON.stringify({
      clips: [
        {
          views: 12,
          createdAt: "2026-01-01T00:00:00.000Z",
          thumbnailUrl:
            "https://clips-media-assets2.twitch.tv/clip-1-preview-480x272.jpg",
          gameName: "Just Chatting",
          creator: "Alice",
          title: "同じClip",
          url: "https://www.twitch.tv/rukalun/clip/clip-1",
          id: "clip-1",
        },
      ],
      clipSync: { recentSyncedAt: "2026-01-02T03:04:05.000Z" },
      total: 1,
      generatedAt: "2025-12-31T00:00:00.000Z",
    });
    fs.writeFileSync(outPath, existing, "utf8");

    runExporter(dbPath, outPath);

    expect(fs.readFileSync(outPath, "utf8")).toBe(existing);
    expect(JSON.parse(fs.readFileSync(outPath, "utf8")).generatedAt).toBe(
      "2025-12-31T00:00:00.000Z"
    );
  });

  it("rewrites the output when clip views change", () => {
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "clips.sqlite");
    const outPath = path.join(tempDir, "clip-search-data.json");
    const db = createClipCache(dbPath);
    insertClip(db, { views: 34 });
    insertRecentSyncState(db, "2026-01-02T04:05:06.000Z");
    db.close();
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2025-12-31T00:00:00.000Z",
        total: 1,
        clipSync: { recentSyncedAt: "2026-01-02T03:04:05.000Z" },
        clips: [publicClip()],
      }),
      "utf8"
    );

    runExporter(dbPath, outPath);

    const exported = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(exported.generatedAt).not.toBe("2025-12-31T00:00:00.000Z");
    expect(exported.clips[0]).toMatchObject({
      title: "同じClip",
      views: 34,
    });
  });

  it.each([
    {
      name: "added",
      seedDatabase: (db: DatabaseSync) => insertClip(db),
      existingClips: [],
      expectedIds: ["clip-1"],
    },
    {
      name: "removed",
      seedDatabase: (db: DatabaseSync) =>
        insertClip(db, { unavailableAt: "2026-01-02T00:00:00.000Z" }),
      existingClips: [publicClip()],
      expectedIds: [],
    },
  ])("rewrites the output when a clip is $name", ({
    seedDatabase,
    existingClips,
    expectedIds,
  }) => {
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "clips.sqlite");
    const outPath = path.join(tempDir, "clip-search-data.json");
    const db = createClipCache(dbPath);
    seedDatabase(db);
    db.close();
    fs.writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2025-12-31T00:00:00.000Z",
        total: existingClips.length,
        clipSync: { recentSyncedAt: null },
        clips: existingClips,
      }),
      "utf8"
    );

    runExporter(dbPath, outPath);

    const exported = JSON.parse(fs.readFileSync(outPath, "utf8"));
    expect(exported.generatedAt).not.toBe("2025-12-31T00:00:00.000Z");
    expect(exported.clips.map((clip: { id: string }) => clip.id)).toEqual(
      expectedIds
    );
  });

  it("rewrites an unreadable existing output", () => {
    const tempDir = makeTempDir();
    const dbPath = path.join(tempDir, "clips.sqlite");
    const outPath = path.join(tempDir, "clip-search-data.json");
    const db = createClipCache(dbPath);
    insertClip(db);
    db.close();
    fs.writeFileSync(outPath, "not json", "utf8");

    runExporter(dbPath, outPath);

    expect(JSON.parse(fs.readFileSync(outPath, "utf8")).clips).toEqual([
      publicClip(),
    ]);
  });
});
