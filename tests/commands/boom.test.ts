import { describe, expect, it, vi } from "vitest";
import {
  BoomSummaryCache,
  buildBoomSummary,
  formatBoomSummary,
  formatDuration,
  parseGameChapters,
} from "../../src/commands/boom";

interface FakeVideo {
  id: string;
  durationInSeconds: number;
  creationDate: Date;
}

function iterableVideos(videos: FakeVideo[]): AsyncIterable<FakeVideo> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const video of videos) {
        yield video;
      }
    },
  };
}

describe("parseGameChapters", () => {
  it("extracts game names and durations from Twitch GraphQL moments", () => {
    const chapters = parseGameChapters(
      {
        data: {
          video: {
            moments: {
              edges: [
                {
                  node: {
                    positionMilliseconds: 0,
                    durationMilliseconds: 3_600_000,
                    details: {
                      game: { displayName: "FINAL FANTASY XIV ONLINE" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      7_200
    );

    expect(chapters).toEqual([
      { gameName: "FINAL FANTASY XIV ONLINE", durationSeconds: 3_600 },
    ]);
  });

  it("derives missing chapter durations from the next chapter or video length", () => {
    const chapters = parseGameChapters(
      {
        data: {
          video: {
            moments: {
              edges: [
                {
                  node: {
                    positionMilliseconds: 0,
                    details: { game: { displayName: "Game A" } },
                  },
                },
                {
                  node: {
                    positionMilliseconds: 5_400_000,
                    details: { game: { displayName: "Game B" } },
                  },
                },
              ],
            },
          },
        },
      },
      7_200
    );

    expect(chapters).toEqual([
      { gameName: "Game A", durationSeconds: 5_400 },
      { gameName: "Game B", durationSeconds: 1_800 },
    ]);
  });
});

describe("buildBoomSummary", () => {
  it("aggregates archive game time from the last 30 days and filters totals below one hour", async () => {
    const now = new Date("2026-05-31T12:00:00.000Z");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              game: { displayName: "Fallback Game" },
              lengthSeconds: 4_200,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              moments: {
                edges: [
                  {
                    node: {
                      positionMilliseconds: 0,
                      durationMilliseconds: 2_700_000,
                      details: { game: { displayName: "Game A" } },
                    },
                  },
                  {
                    node: {
                      positionMilliseconds: 2_700_000,
                      durationMilliseconds: 1_500_000,
                      details: { game: { displayName: "Game B" } },
                    },
                  },
                ],
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              game: { displayName: "Fallback Game" },
              lengthSeconds: 1_800,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              moments: {
                edges: [
                  {
                    node: {
                      positionMilliseconds: 0,
                      durationMilliseconds: 1_800_000,
                      details: { game: { displayName: "Game A" } },
                    },
                  },
                ],
              },
            },
          },
        }),
      });

    const summary = await buildBoomSummary(
      {
        videos: {
          getVideosByUserPaginated: vi.fn(() =>
            iterableVideos([
              {
                id: "v1",
                durationInSeconds: 4_200,
                creationDate: new Date("2026-05-30T12:00:00.000Z"),
              },
              {
                id: "v2",
                durationInSeconds: 1_800,
                creationDate: new Date("2026-05-20T12:00:00.000Z"),
              },
              {
                id: "old",
                durationInSeconds: 7_200,
                creationDate: new Date("2026-04-20T12:00:00.000Z"),
              },
            ])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
        now: () => now,
      }
    );

    expect(summary).toEqual({
      analyzedVideos: 2,
      lookbackDays: 30,
      totalStreamSeconds: 6_000,
      games: [{ gameName: "Game A", totalSeconds: 4_500 }],
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("uses video metadata as the whole stream game when no game-change chapters exist", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              game: { displayName: "FINAL FANTASY XIV ONLINE" },
              lengthSeconds: 7_200,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { video: { moments: { edges: [] } } },
        }),
      });

    const summary = await buildBoomSummary(
      {
        videos: {
          getVideosByUserPaginated: vi.fn(() =>
            iterableVideos([
              {
                id: "v1",
                durationInSeconds: 7_200,
                creationDate: new Date("2026-05-31T12:00:00.000Z"),
              },
            ])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
        now: () => new Date("2026-05-31T12:00:00.000Z"),
      }
    );

    expect(summary.games).toEqual([
      { gameName: "FINAL FANTASY XIV ONLINE", totalSeconds: 7_200 },
    ]);
  });

  it("retries GraphQL requests with the Twitch web client id when the configured id is rejected", async () => {
    const fetchFn = vi.fn(async (_input, init) => {
      if (init.headers["Client-ID"] !== "kimne78kx3ncx6brgo4mv6wki5h1ko") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            message: "The \"Client-ID\" header is invalid.",
          }),
        };
      }

      const body = JSON.parse(init.body) as { operationName: string };
      if (body.operationName === "VideoMetadata") {
        return {
          ok: true,
          json: async () => ({
            data: {
              video: {
                game: { displayName: "Game A" },
                lengthSeconds: 3_600,
              },
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          data: { video: { moments: { edges: [] } } },
        }),
      };
    });

    const summary = await buildBoomSummary(
      {
        videos: {
          getVideosByUserPaginated: vi.fn(() =>
            iterableVideos([
              {
                id: "v1",
                durationInSeconds: 3_600,
                creationDate: new Date("2026-05-31T12:00:00.000Z"),
              },
            ])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "bad-client",
        fetchFn,
        now: () => new Date("2026-05-31T12:00:00.000Z"),
      }
    );

    expect(summary.games).toEqual([
      { gameName: "Game A", totalSeconds: 3_600 },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        }),
      })
    );
  });

  it("stops archive video fetching once videos are older than the lookback window", async () => {
    const now = new Date("2026-05-31T12:00:00.000Z");
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        {
          id: "v1",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-05-31T12:00:00.000Z"),
        },
        {
          id: "v2",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-04-30T12:00:00.000Z"),
        },
      ])
    );
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          video: {
            game: { displayName: "Game A" },
            lengthSeconds: 3_600,
            moments: {
              edges: [
                {
                  node: {
                    positionMilliseconds: 0,
                    durationMilliseconds: 3_600_000,
                    details: { game: { displayName: "Game A" } },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    await buildBoomSummary(
      { videos: { getVideosByUserPaginated } },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
        now: () => now,
      }
    );

    expect(getVideosByUserPaginated).toHaveBeenCalledWith("broadcaster-id", {
      type: "archive",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fetches multiple videos concurrently to reduce first response time", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        {
          id: "v1",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-05-31T12:00:00.000Z"),
        },
        {
          id: "v2",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-05-30T12:00:00.000Z"),
        },
        {
          id: "v3",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-05-29T12:00:00.000Z"),
        },
      ])
    );
    const fetchFn = vi.fn(async (_input, init) => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeRequests--;

      const body = JSON.parse(init.body) as { operationName: string };
      if (body.operationName === "VideoMetadata") {
        return {
          ok: true,
          json: async () => ({
            data: {
              video: {
                game: { displayName: "Game A" },
                lengthSeconds: 3_600,
              },
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          data: { video: { moments: { edges: [] } } },
        }),
      };
    });

    await buildBoomSummary(
      { videos: { getVideosByUserPaginated } },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
        maxConcurrentVideos: 2,
        now: () => new Date("2026-05-31T12:00:00.000Z"),
      }
    );

    expect(maxActiveRequests).toBeGreaterThan(2);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
  });
});

describe("BoomSummaryCache", () => {
  it("reuses a fresh summary and refreshes after ttl", async () => {
    let now = 1_000;
    const cache = new BoomSummaryCache(5_000, () => now);
    const first = {
      analyzedVideos: 1,
      lookbackDays: 30,
      totalStreamSeconds: 3_600,
      games: [{ gameName: "Game A", totalSeconds: 3_600 }],
    };
    const second = {
      analyzedVideos: 1,
      lookbackDays: 30,
      totalStreamSeconds: 3_600,
      games: [{ gameName: "Game B", totalSeconds: 3_600 }],
    };
    const loader = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await expect(cache.getOrLoad(loader)).resolves.toBe(first);
    await expect(cache.getOrLoad(loader)).resolves.toBe(first);
    now = 7_000;
    await expect(cache.getOrLoad(loader)).resolves.toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("formatBoomSummary", () => {
  it("formats a compact chat response", () => {
    expect(
      formatBoomSummary({
        analyzedVideos: 4,
        lookbackDays: 30,
        totalStreamSeconds: 12_600,
        games: [
          { gameName: "Game A", totalSeconds: 9_000 },
          { gameName: "Game B", totalSeconds: 3_600 },
        ],
      })
    ).toBe(
      "過去30日間の総配信時間 3時間30分 / ゲーム時間(1時間以上): Game A 2時間30分 / Game B 1時間"
    );
  });

  it("returns a not-found message when there are no qualifying games", () => {
    expect(
      formatBoomSummary({
        analyzedVideos: 3,
        lookbackDays: 30,
        totalStreamSeconds: 5_400,
        games: [],
      })
    ).toBe(
      "過去30日間の総配信時間 1時間30分 / 1時間以上のゲームは見つかりませんでした。"
    );
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes without seconds", () => {
    expect(formatDuration(3_900)).toBe("1時間5分");
    expect(formatDuration(3_600)).toBe("1時間");
  });
});
