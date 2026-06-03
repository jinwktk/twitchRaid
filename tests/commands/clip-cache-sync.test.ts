import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HelixClip } from "@twurple/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClipDateWindows,
  clipToCachedClip,
  ClipCacheSynchronizer,
} from "../../src/commands/clip-cache-sync";
import { ClipCacheStore } from "../../src/commands/clip-cache-store";

function makeClip(id: string, createdAt = "2026-05-25T10:00:00.000Z"): HelixClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title: `clip ${id}`,
    creatorId: "creator-1",
    creatorDisplayName: "Viewer",
    creationDate: new Date(createdAt),
    views: 123,
  } as HelixClip;
}

function iterableClips(clips: HelixClip[]): AsyncIterable<HelixClip> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const clip of clips) {
        yield clip;
      }
    },
  };
}

describe("clip cache sync helpers", () => {
  it("builds fixed date windows for full backfill", () => {
    const windows = buildClipDateWindows(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-05T00:00:00.000Z"),
      2
    );

    expect(windows.map((w) => [w.start.toISOString(), w.end.toISOString()]))
      .toEqual([
        ["2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
        ["2026-01-03T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
      ]);
  });

  it("converts Twurple clips into cache rows", () => {
    expect(clipToCachedClip(makeClip("abc"))).toMatchObject({
      id: "abc",
      creatorDisplayName: "Viewer",
      createdAt: "2026-05-25T10:00:00.000Z",
      views: 123,
    });
  });
});

describe("ClipCacheSynchronizer", () => {
  let tmpDir: string;
  let store: ClipCacheStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-cache-sync-"));
    store = new ClipCacheStore(path.join(tmpDir, "clips.sqlite"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("syncs a recent window into the cache", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("recent")])
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 30,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledWith(
      "broadcaster-id",
      {
        startDate: "2026-05-25T10:00:00.000Z",
        endDate: "2026-05-25T10:30:00.000Z",
      }
    );
    expect(store.clipCount()).toBe(1);
  });

  it("notifies after a recent sync so stream clips can be posted", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("recent")])
    );
    const onRecentSyncComplete = vi.fn();
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 30,
      onRecentSyncComplete,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(onRecentSyncComplete).toHaveBeenCalledWith({
      syncedAt: "2026-05-25T10:30:00.000Z",
      saved: 1,
    });
  });

  it("skips completed full-scan windows", async () => {
    store.markWindowCompleted(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      0
    );
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
    });

    await sync.syncWindow({
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(getClipsForBroadcasterPaginated).not.toHaveBeenCalled();
  });

  it("resyncs a completed window in reconcile mode and marks missing clips unavailable", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("kept", "2026-01-01T10:00:00.000Z")),
      clipToCachedClip(makeClip("deleted", "2026-01-01T11:00:00.000Z")),
    ]);
    store.markWindowCompleted(
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      2
    );
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("kept", "2026-01-01T10:00:00.000Z")])
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
    });

    await sync.syncWindow(
      {
        start: new Date("2026-01-01T00:00:00.000Z"),
        end: new Date("2026-01-02T00:00:00.000Z"),
      },
      { reconcileMissing: true }
    );

    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledOnce();
    expect(
      store
        .listClipsCreatedBetween(
          "2026-01-01T00:00:00.000Z",
          "2026-01-02T00:00:00.000Z"
        )
        .map((clip) => clip.id)
    ).toEqual(["kept"]);
  });

  it("runs daily reconcile only while offline and only once per interval", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    let live = true;
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 1,
      isStreamLive: () => live,
    });

    await sync.runDailyReconcileIfDue(new Date("2026-01-03T00:00:00.000Z"));
    expect(getClipsForBroadcasterPaginated).not.toHaveBeenCalled();

    live = false;
    await sync.runDailyReconcileIfDue(new Date("2026-01-03T00:00:00.000Z"));
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);
    expect(store.getSyncState("daily_reconcile_at")).toBe(
      "2026-01-03T00:00:00.000Z"
    );

    await sync.runDailyReconcileIfDue(new Date("2026-01-03T12:00:00.000Z"));
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);

    await sync.runDailyReconcileIfDue(new Date("2026-01-04T00:00:01.000Z"));
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(6);
  });
});
