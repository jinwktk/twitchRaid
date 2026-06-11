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
      created_at TEXT,
      views INTEGER,
      last_seen_at TEXT,
      unavailable_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
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
        created_at,
        views,
        last_seen_at,
        unavailable_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "old",
      "https://www.twitch.tv/rukalun/clip/old",
      "古いかわいいClip",
      "creator-secret",
      "Alice",
      "alice",
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
      "2026-01-02T00:00:00.000Z",
      34,
      "2026-01-02T00:00:00.000Z",
      null,
      "2026-01-02T00:00:00.000Z"
    );
    insert.run(
      "hidden",
      "https://www.twitch.tv/rukalun/clip/hidden",
      "消えたClip",
      "creator-secret-3",
      "Carol",
      "carol",
      "2026-01-03T00:00:00.000Z",
      56,
      "2026-01-03T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z",
      "2026-01-04T00:00:00.000Z"
    );
    db.close();

    execFileSync(process.execPath, [
      path.join(process.cwd(), "scripts", "export-clip-search-data.mjs"),
      "--db",
      dbPath,
      "--out",
      outPath,
    ]);

    const exported = JSON.parse(fs.readFileSync(outPath, "utf8")) as {
      generatedAt: string;
      total: number;
      clips: Array<Record<string, unknown>>;
    };

    expect(exported.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(exported.total).toBe(2);
    expect(exported.clips.map((clip) => clip.id)).toEqual(["new", "old"]);
    expect(exported.clips[0]).toEqual({
      id: "new",
      url: "https://www.twitch.tv/rukalun/clip/new",
      title: "新しいふわふわClip",
      creator: "Bob",
      createdAt: "2026-01-02T00:00:00.000Z",
      views: 34,
    });
    expect(Object.keys(exported.clips[0]).sort()).toEqual([
      "createdAt",
      "creator",
      "id",
      "title",
      "url",
      "views",
    ]);
  });
});
