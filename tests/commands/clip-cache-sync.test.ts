import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HelixClip } from "@twurple/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import logger from "../../src/utils/logger";
import {
  buildClipDateWindows,
  clipsToCachedClips,
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
    gameId: "24241",
    creationDate: new Date(createdAt),
    views: 123,
    thumbnailUrl: `https://clips-media-assets2.twitch.tv/${id}-preview-480x272.jpg`,
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

function failingIterable(error: Error): AsyncIterable<HelixClip> {
  return {
    async *[Symbol.asyncIterator]() {
      throw error;
    },
  };
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

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

  it("splits the moving full-backfill tail into short stable windows", () => {
    const windows = buildClipDateWindows(
      new Date("2026-06-08T00:00:00.000Z"),
      new Date("2026-06-20T12:15:56.291Z"),
      30,
      3
    );

    expect(windows.map((w) => [w.start.toISOString(), w.end.toISOString()]))
      .toEqual([
        ["2026-06-08T00:00:00.000Z", "2026-06-11T00:00:00.000Z"],
        ["2026-06-11T00:00:00.000Z", "2026-06-14T00:00:00.000Z"],
        ["2026-06-14T00:00:00.000Z", "2026-06-17T00:00:00.000Z"],
        ["2026-06-17T00:00:00.000Z", "2026-06-20T00:00:00.000Z"],
        ["2026-06-20T00:00:00.000Z", "2026-06-20T12:15:56.291Z"],
      ]);
  });

  it("converts Twurple clips into cache rows", () => {
    expect(clipToCachedClip(makeClip("abc"))).toMatchObject({
      id: "abc",
      creatorDisplayName: "Viewer",
      gameId: "24241",
      thumbnailUrl: "https://clips-media-assets2.twitch.tv/abc-preview-480x272.jpg",
      createdAt: "2026-05-25T10:00:00.000Z",
      views: 123,
    });
  });

  it("adds game names from resolved game IDs", async () => {
    const clips = await clipsToCachedClips([makeClip("abc")], {
      getGamesByIds: vi.fn(async () => [{ id: "24241", name: "FINAL FANTASY XIV ONLINE" }]),
    });

    expect(clips[0]).toMatchObject({
      id: "abc",
      gameId: "24241",
      gameName: "FINAL FANTASY XIV ONLINE",
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
    vi.restoreAllMocks();
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

  it("uses a wide recent window by default to absorb Twitch clip API delays", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("delayed", "2026-05-25T09:00:00.000Z")])
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledWith(
      "broadcaster-id",
      {
        startDate: "2026-05-25T04:30:00.000Z",
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
      unavailable: 0,
    });
  });

  it("fetches clip sync windows through Helix identity requests when credentials are available", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("twurple")])
    );
    const helixFetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: "api-1",
                url: "https://clips.twitch.tv/api-1",
                title: "api clip 1",
                creator_id: "creator-1",
                creator_name: "Viewer",
                game_id: "24241",
                thumbnail_url:
                  "https://clips-media-assets2.twitch.tv/api-1-preview-480x272.jpg",
                created_at: "2026-05-25T10:00:00.000Z",
                view_count: 9,
              },
            ],
            pagination: { cursor: "cursor-1" },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: "api-2",
                url: "https://clips.twitch.tv/api-2",
                title: "api clip 2",
                creator_id: "creator-2",
                creator_name: "OtherViewer",
                game_id: "509658",
                thumbnail_url:
                  "https://clips-media-assets2.twitch.tv/api-2-preview-480x272.jpg",
                created_at: "2026-05-25T10:15:00.000Z",
                view_count: 7,
              },
            ],
            pagination: {},
          }),
      });
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      helixClientId: "client-id",
      helixAccessTokenProvider: () => "access-token",
      helixFetchFn,
    });

    await sync.syncWindow({
      start: new Date("2026-05-25T10:00:00.000Z"),
      end: new Date("2026-05-25T11:00:00.000Z"),
    });

    expect(getClipsForBroadcasterPaginated).not.toHaveBeenCalled();
    expect(helixFetchFn).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(helixFetchFn.mock.calls[0][0]);
    expect(firstUrl.searchParams.get("broadcaster_id")).toBe("broadcaster-id");
    expect(firstUrl.searchParams.get("started_at")).toBe(
      "2026-05-25T10:00:00.000Z"
    );
    expect(firstUrl.searchParams.get("ended_at")).toBe(
      "2026-05-25T11:00:00.000Z"
    );
    expect(firstUrl.searchParams.get("first")).toBe("100");
    expect(helixFetchFn.mock.calls[0][1].headers).toMatchObject({
      "Accept-Encoding": "identity",
      Authorization: "Bearer access-token",
      "Client-Id": "client-id",
    });
    const secondUrl = new URL(helixFetchFn.mock.calls[1][0]);
    expect(secondUrl.searchParams.get("after")).toBe("cursor-1");
    expect(
      store
        .listClipsCreatedBetween(
          "2026-05-25T10:00:00.000Z",
          "2026-05-25T11:00:00.000Z"
        )
        .map((clip) => clip.id)
    ).toEqual(["api-1", "api-2"]);
  });

  it("marks recently deleted cached clips unavailable after id verification", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("kept", "2026-05-25T10:10:00.000Z")),
      clipToCachedClip(makeClip("deleted", "2026-05-25T08:20:00.000Z")),
    ]);
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("kept", "2026-05-25T10:10:00.000Z")])
    );
    const getClipsByIds = vi.fn(async () => []);
    const onRecentSyncComplete = vi.fn();
    const infoSpy = vi.spyOn(logger, "info");
    const sync = new ClipCacheSynchronizer({
      apiClient: {
        clips: { getClipsForBroadcasterPaginated, getClipsByIds },
      },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 180,
      onRecentSyncComplete,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsByIds).toHaveBeenCalledWith(["deleted"]);
    expect(
      store
        .listClipsCreatedBetween(
          "2026-05-25T07:30:00.000Z",
          "2026-05-25T10:30:00.000Z"
        )
        .map((clip) => clip.id)
    ).toEqual(["kept"]);
    expect(onRecentSyncComplete).toHaveBeenCalledWith({
      syncedAt: "2026-05-25T10:30:00.000Z",
      saved: 0,
      unavailable: 1,
    });
    expect(
      infoSpy.mock.calls.some(([message]) =>
        String(message).includes("unavailable=1")
      )
    ).toBe(true);
  });

  it("keeps newly cached clips during the recent API availability grace period", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("flapping", "2026-05-25T10:20:00.000Z")),
    ]);
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    const getClipsByIds = vi.fn(async () => []);
    const onRecentSyncComplete = vi.fn();
    const sync = new ClipCacheSynchronizer({
      apiClient: {
        clips: { getClipsForBroadcasterPaginated, getClipsByIds },
      },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 180,
      onRecentSyncComplete,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsByIds).not.toHaveBeenCalled();
    expect(store.selectRandomClip({ historyKey: "clip" })?.id).toBe("flapping");
    expect(onRecentSyncComplete).toHaveBeenCalledWith({
      syncedAt: "2026-05-25T10:30:00.000Z",
      saved: 0,
      unavailable: 0,
    });
  });

  it("restores newly cached clips that were marked unavailable during the grace period", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("restored-flapping", "2026-05-25T10:20:00.000Z")),
    ]);
    store.markClipsUnavailableByIds([
      "restored-flapping",
    ], "2026-05-25T10:25:00.000Z");
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    const getClipsByIds = vi.fn(async () => []);
    const onRecentSyncComplete = vi.fn();
    const sync = new ClipCacheSynchronizer({
      apiClient: {
        clips: { getClipsForBroadcasterPaginated, getClipsByIds },
      },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 180,
      onRecentSyncComplete,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsByIds).not.toHaveBeenCalled();
    expect(store.selectRandomClip({ historyKey: "clip" })?.id).toBe(
      "restored-flapping"
    );
    expect(onRecentSyncComplete).toHaveBeenCalledWith({
      syncedAt: "2026-05-25T10:30:00.000Z",
      saved: 1,
      unavailable: 0,
    });
  });

  it("keeps a missing recent clip when id verification still returns it", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("still-public", "2026-05-25T08:20:00.000Z")),
    ]);
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    const getClipsByIds = vi.fn(async () => [
      makeClip("still-public", "2026-05-25T08:20:00.000Z"),
    ]);
    const sync = new ClipCacheSynchronizer({
      apiClient: {
        clips: { getClipsForBroadcasterPaginated, getClipsByIds },
      },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 180,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(getClipsByIds).toHaveBeenCalledWith(["still-public"]);
    expect(store.selectRandomClip({ historyKey: "clip" })?.id).toBe(
      "still-public"
    );
  });

  it("does not mark recent clips unavailable when id verification fails", async () => {
    store.saveClips([
      clipToCachedClip(makeClip("maybe-public", "2026-05-25T10:20:00.000Z")),
    ]);
    const getClipsForBroadcasterPaginated = vi.fn(() => iterableClips([]));
    const getClipsByIds = vi.fn(async () => {
      throw new Error("Twitch API error");
    });
    const sync = new ClipCacheSynchronizer({
      apiClient: {
        clips: { getClipsForBroadcasterPaginated, getClipsByIds },
      },
      broadcasterId: "broadcaster-id",
      store,
      recentWindowMinutes: 60,
    });

    await sync.syncRecentClips(new Date("2026-05-25T10:30:00.000Z"));

    expect(store.selectRandomClip({ historyKey: "clip" })?.id).toBe(
      "maybe-public"
    );
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

  it("retries a transient full-backfill window failure before continuing", async () => {
    const getClipsForBroadcasterPaginated = vi
      .fn()
      .mockReturnValueOnce(failingIterable(new Error("Premature close")))
      .mockReturnValueOnce(iterableClips([makeClip("retried")]));
    const infoSpy = vi.spyOn(logger, "info");
    const warnSpy = vi.spyOn(logger, "warn");
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 1,
      fullWindowRetryAttempts: 1,
      fullWindowRetryDelayMs: 0,
    });

    const completed = await sync.runFullBackfill(
      new Date("2026-01-02T00:00:00.000Z")
    );

    expect(completed).toBe(true);
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);
    expect(
      infoSpy.mock.calls.some(([message]) =>
        String(message).includes("期間同期失敗、再試行します")
      )
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("期間同期失敗、再試行します")
      )
    ).toBe(false);
    expect(store.clipCount()).toBe(1);
    expect(
      store.isWindowCompleted(
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z"
      )
    ).toBe(true);
  });

  it("leaves a full-backfill window incomplete after retry exhaustion", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      failingIterable(new Error("Premature close"))
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 1,
      fullWindowRetryAttempts: 1,
      fullWindowRetryDelayMs: 0,
    });

    const completed = await sync.runFullBackfill(
      new Date("2026-01-02T00:00:00.000Z")
    );

    expect(completed).toBe(false);
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);
    expect(
      store.isWindowCompleted(
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z"
      )
    ).toBe(false);
  });

  it("splits a failed full-backfill window and completes it when child windows succeed", async () => {
    const warnSpy = vi.spyOn(logger, "warn");
    const getClipsForBroadcasterPaginated = vi
      .fn()
      .mockReturnValueOnce(failingIterable(new Error("Premature close")))
      .mockReturnValueOnce(iterableClips([makeClip("first-half")]))
      .mockReturnValueOnce(iterableClips([makeClip("second-half")]));
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 2,
      fullWindowRetryAttempts: 0,
      fullWindowRetryDelayMs: 0,
    });

    const completed = await sync.runFullBackfill(
      new Date("2026-01-03T00:00:00.000Z")
    );

    expect(completed).toBe(true);
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(3);
    expect(store.clipCount()).toBe(2);
    expect(
      store.isWindowCompleted(
        "2026-01-01T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z"
      )
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("期間同期をスキップ")
      )
    ).toBe(false);
  });

  it("fetches a long moving tail as short windows before any retry failure", async () => {
    const requestedWindows: Array<[string, string]> = [];
    const infoSpy = vi.spyOn(logger, "info");
    const getClipsForBroadcasterPaginated = vi.fn(
      (
        _broadcasterId: string,
        filter?: { startDate?: string; endDate?: string }
      ) => {
        const startDate = filter?.startDate ?? "";
        const endDate = filter?.endDate ?? "";
        requestedWindows.push([startDate, endDate]);

        if (Date.parse(endDate) - Date.parse(startDate) > THREE_DAYS_MS) {
          return failingIterable(new Error("window too wide"));
        }
        return iterableClips([]);
      }
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-06-08T00:00:00.000Z"),
      fullWindowDays: 30,
      fullTailWindowDays: 3,
      fullWindowRetryAttempts: 0,
      fullWindowRetryDelayMs: 0,
    });

    const completed = await sync.runFullBackfill(
      new Date("2026-06-20T12:15:56.291Z")
    );

    expect(completed).toBe(true);
    expect(requestedWindows).toEqual([
      ["2026-06-08T00:00:00.000Z", "2026-06-11T00:00:00.000Z"],
      ["2026-06-11T00:00:00.000Z", "2026-06-14T00:00:00.000Z"],
      ["2026-06-14T00:00:00.000Z", "2026-06-17T00:00:00.000Z"],
      ["2026-06-17T00:00:00.000Z", "2026-06-20T00:00:00.000Z"],
      ["2026-06-20T00:00:00.000Z", "2026-06-20T12:15:56.291Z"],
    ]);
    expect(
      requestedWindows.every(
        ([startDate, endDate]) =>
          Date.parse(endDate) - Date.parse(startDate) <= THREE_DAYS_MS
      )
    ).toBe(true);
    expect(
      infoSpy.mock.calls.some(([message]) =>
        String(message).includes("期間同期失敗")
      )
    ).toBe(false);
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

  it("throttles daily reconcile retries after an incomplete scan", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      failingIterable(new Error("Premature close"))
    );
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 1,
      fullWindowRetryAttempts: 0,
      fullWindowRetryDelayMs: 0,
    });

    await sync.runDailyReconcileIfDue(new Date("2026-01-03T00:00:00.000Z"));
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);

    await sync.runDailyReconcileIfDue(new Date("2026-01-03T00:03:00.000Z"));

    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);
    expect(store.getSyncState("daily_reconcile_at")).toBeNull();
    expect(store.getSyncState("daily_reconcile_attempt_at")).toBe(
      "2026-01-03T00:00:00.000Z"
    );

    await sync.runDailyReconcileIfDue(new Date("2026-01-04T00:00:01.000Z"));
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(6);
  });

  it("does not stamp daily reconcile when a full scan is already running", async () => {
    let releaseFetch!: () => void;
    let resolveFetchStarted!: () => void;
    let firstFetch = true;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const getClipsForBroadcasterPaginated = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        if (firstFetch) {
          firstFetch = false;
          resolveFetchStarted();
          await new Promise<void>((release) => {
            releaseFetch = release;
          });
        }
      },
    }));
    const sync = new ClipCacheSynchronizer({
      apiClient: { clips: { getClipsForBroadcasterPaginated } },
      broadcasterId: "broadcaster-id",
      store,
      oldestClipDate: new Date("2026-01-01T00:00:00.000Z"),
      fullWindowDays: 1,
    });

    const fullBackfill = sync.runFullBackfill(
      new Date("2026-01-03T00:00:00.000Z")
    );

    await fetchStarted;
    await sync.runDailyReconcileIfDue(new Date("2026-01-03T00:00:00.000Z"));

    expect(store.getSyncState("daily_reconcile_at")).toBeNull();

    releaseFetch();
    await fullBackfill;
  });
});
