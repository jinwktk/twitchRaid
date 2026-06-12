import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClipCacheStore, type CachedClip } from "../../src/commands/clip-cache-store";

function clip(
  id: string,
  creatorDisplayName = "viewer",
  createdAt = "2026-05-25T10:00:00.000Z",
  title = `clip ${id}`
): CachedClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title,
    creatorId: `creator-${creatorDisplayName.toLowerCase()}`,
    creatorDisplayName,
    gameId: "24241",
    gameName: "FINAL FANTASY XIV ONLINE",
    thumbnailUrl: `https://clips-media-assets2.twitch.tv/${id}-preview-480x272.jpg`,
    createdAt,
    views: 1,
  };
}

describe("ClipCacheStore", () => {
  let tmpDir: string;
  let store: ClipCacheStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-cache-store-"));
    store = new ClipCacheStore(path.join(tmpDir, "clips.sqlite"), 2);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("selects a cached clip while avoiding recent history", () => {
    store.saveClips([clip("seen"), clip("fresh")]);
    store.recordHistory("clip", "seen");

    const selected = store.selectRandomClip({
      historyKey: "clip",
      random: () => 0,
    });

    expect(selected?.id).toBe("fresh");
  });

  it("counts only newly available clips when saving cache rows", () => {
    expect(store.saveClips([clip("same")])).toBe(1);
    expect(store.saveClips([clip("same")])).toBe(0);

    store.markMissingClipsUnavailable(
      "2026-05-25T09:00:00.000Z",
      "2026-05-25T11:00:00.000Z",
      []
    );

    expect(store.saveClips([clip("same")])).toBe(1);
  });

  it("filters cached myclip candidates by creator name", () => {
    store.saveClips([clip("other", "Other"), clip("mine", "Viewer")]);

    const selected = store.selectRandomClip({
      historyKey: "myclip:viewer",
      creatorName: "viewer",
      random: () => 0,
    });

    expect(selected?.id).toBe("mine");
  });

  it("searches cached clips by title keyword", () => {
    store.saveClips([
      clip("other", "Viewer", "2026-05-25T10:00:00.000Z", "雑談クリップ"),
      clip("raid", "Viewer", "2026-05-25T10:10:00.000Z", "Raidの名場面"),
    ]);

    const selected = store.searchRandomClip({
      historyKey: "clipsearch:raid",
      query: "raid",
      random: () => 0,
    });

    expect(selected?.id).toBe("raid");
  });

  it("searches cached clips by creator display name", () => {
    store.saveClips([
      clip("other", "OtherViewer"),
      clip("mine", "Nyme_IA"),
    ]);

    const selected = store.searchRandomClip({
      historyKey: "clipsearch:nyme",
      query: "nyme",
      random: () => 0,
    });

    expect(selected?.id).toBe("mine");
  });

  it("searches without ASCII case sensitivity", () => {
    store.saveClips([
      clip("target", "Viewer", "2026-05-25T10:00:00.000Z", "Just Chatting Highlight"),
    ]);

    const selected = store.searchRandomClip({
      historyKey: "clipsearch:just chatting",
      query: "just chatting",
      random: () => 0,
    });

    expect(selected?.id).toBe("target");
  });

  it("avoids recent clipsearch history before falling back to all matches", () => {
    store.saveClips([
      clip("seen", "Viewer", "2026-05-25T10:00:00.000Z", "Raid moment"),
      clip("fresh", "Viewer", "2026-05-25T10:10:00.000Z", "Another raid moment"),
    ]);
    store.recordHistory("clipsearch:raid", "seen");

    const selected = store.searchRandomClip({
      historyKey: "clipsearch:raid",
      query: "raid",
      random: () => 0,
    });

    expect(selected?.id).toBe("fresh");
  });

  it("excludes unavailable clips from clipsearch results", () => {
    store.saveClips([
      clip("kept", "Viewer", "2026-05-25T10:10:00.000Z", "Rare clip"),
      clip("deleted", "Viewer", "2026-05-25T10:20:00.000Z", "Rare deleted clip"),
    ]);
    store.markMissingClipsUnavailable(
      "2026-05-25T10:00:00.000Z",
      "2026-05-25T11:00:00.000Z",
      ["kept"]
    );

    const selected = store.searchRandomClip({
      historyKey: "clipsearch:rare",
      query: "rare",
      random: () => 0.9,
    });

    expect(selected?.id).toBe("kept");
  });

  it("treats LIKE wildcard characters as literal search text", () => {
    store.saveClips([
      clip("plain", "Viewer", "2026-05-25T10:00:00.000Z", "plain clip"),
      clip("percent", "Viewer", "2026-05-25T10:10:00.000Z", "100% clear"),
      clip("underscore", "Viewer", "2026-05-25T10:20:00.000Z", "line_up clip"),
    ]);

    expect(
      store.searchRandomClip({
        historyKey: "clipsearch:%",
        query: "%",
        random: () => 0,
      })?.id
    ).toBe("percent");
    expect(
      store.searchRandomClip({
        historyKey: "clipsearch:_",
        query: "_",
        random: () => 0,
      })?.id
    ).toBe("underscore");
  });

  it("keeps clip history bounded per key", () => {
    store.recordHistory("clip", "a", 1);
    store.recordHistory("clip", "b", 2);
    store.recordHistory("clip", "c", 3);
    store.recordHistory("myclip:viewer", "mine", 4);

    expect(store.getRecentIds("clip")).toEqual(["c", "b"]);
    expect(store.getRecentIds("myclip:viewer")).toEqual(["mine"]);
  });

  it("remembers completed scan windows", () => {
    store.markWindowCompleted(
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      10
    );

    expect(
      store.isWindowCompleted(
        "2026-01-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z"
      )
    ).toBe(true);
  });

  it("lists clips created during a stream window by view count", () => {
    store.saveClips([
      clip("before", "Viewer", "2026-05-25T09:59:59.000Z"),
      clip("low", "Viewer", "2026-05-25T10:30:00.000Z"),
      { ...clip("high", "Viewer", "2026-05-25T10:40:00.000Z"), views: 99 },
      clip("after", "Viewer", "2026-05-25T11:00:01.000Z"),
    ]);

    const clips = store.listClipsCreatedBetween(
      "2026-05-25T10:00:00.000Z",
      "2026-05-25T11:00:00.000Z"
    );

    expect(clips.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("marks clips missing from a rescan window as unavailable", () => {
    store.saveClips([
      clip("kept", "Viewer", "2026-05-25T10:10:00.000Z"),
      clip("deleted", "Viewer", "2026-05-25T10:20:00.000Z"),
      clip("outside", "Viewer", "2026-05-25T11:10:00.000Z"),
    ]);

    const marked = store.markMissingClipsUnavailable(
      "2026-05-25T10:00:00.000Z",
      "2026-05-25T11:00:00.000Z",
      ["kept"]
    );

    expect(marked).toBe(1);
    expect(
      store.selectRandomClip({
        historyKey: "clip",
        creatorName: "viewer",
        random: () => 0,
      })?.id
    ).not.toBe("deleted");
    expect(
      store
        .listClipsCreatedBetween(
          "2026-05-25T10:00:00.000Z",
          "2026-05-25T11:00:00.000Z"
        )
        .map((c) => c.id)
    ).toEqual(["kept"]);
  });

  it("restores an unavailable clip when Twitch returns it again", () => {
    store.saveClips([clip("restored", "Viewer", "2026-05-25T10:10:00.000Z")]);
    store.markMissingClipsUnavailable(
      "2026-05-25T10:00:00.000Z",
      "2026-05-25T11:00:00.000Z",
      []
    );

    expect(store.selectRandomClip({ historyKey: "clip" })).toBeNull();

    store.saveClips([clip("restored", "Viewer", "2026-05-25T10:10:00.000Z")]);

    expect(store.selectRandomClip({ historyKey: "clip" })?.id).toBe(
      "restored"
    );
  });

  it("migrates an existing cache database before creating availability indexes", () => {
    const dbPath = path.join(tmpDir, "old-clips.sqlite");
    const oldDb = new DatabaseSync(dbPath);
    oldDb.exec(`
      CREATE TABLE clip_cache (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        creator_display_name TEXT NOT NULL,
        creator_name_lower TEXT NOT NULL,
        created_at TEXT,
        views INTEGER,
        updated_at TEXT NOT NULL
      );
    `);
    oldDb.close();

    const migratedStore = new ClipCacheStore(dbPath);
    migratedStore.saveClips([
      clip("after-migration", "Viewer", "2026-05-25T10:10:00.000Z"),
    ]);

    expect(
      migratedStore.listClipsCreatedBetween(
        "2026-05-25T10:00:00.000Z",
        "2026-05-25T11:00:00.000Z"
      )
    ).toHaveLength(1);
    migratedStore.close();
  });

  it("migrates and stores clip thumbnail and game fields", () => {
    store.saveClips([clip("details")]);

    const db = new DatabaseSync(path.join(tmpDir, "clips.sqlite"), {
      readOnly: true,
    });
    const row = db
      .prepare(
        "SELECT game_id, game_name, thumbnail_url FROM clip_cache WHERE id = ?"
      )
      .get("details") as {
      game_id: string | null;
      game_name: string | null;
      thumbnail_url: string | null;
    };
    db.close();

    expect(row).toEqual({
      game_id: "24241",
      game_name: "FINAL FANTASY XIV ONLINE",
      thumbnail_url: "https://clips-media-assets2.twitch.tv/details-preview-480x272.jpg",
    });
  });
});
