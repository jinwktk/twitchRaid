import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClipCacheStore, type CachedClip } from "../../src/commands/clip-cache-store";

function clip(
  id: string,
  creatorDisplayName = "viewer",
  createdAt = "2026-05-25T10:00:00.000Z"
): CachedClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title: `clip ${id}`,
    creatorId: `creator-${creatorDisplayName.toLowerCase()}`,
    creatorDisplayName,
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

  it("filters cached myclip candidates by creator name", () => {
    store.saveClips([clip("other", "Other"), clip("mine", "Viewer")]);

    const selected = store.selectRandomClip({
      historyKey: "myclip:viewer",
      creatorName: "viewer",
      random: () => 0,
    });

    expect(selected?.id).toBe("mine");
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
});
