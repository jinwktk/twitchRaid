import { describe, expect, it, vi } from "vitest";
import {
  buildBoomSummary,
  formatBoomSummary,
  formatDuration,
  parseGameChapters,
} from "../../src/commands/boom";

interface FakeVideo {
  id: string;
  durationInSeconds: number;
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
  it("aggregates recent archive game time and filters totals below one hour", async () => {
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
              { id: "v1", durationInSeconds: 4_200 },
              { id: "v2", durationInSeconds: 1_800 },
            ])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
      }
    );

    expect(summary).toEqual({
      analyzedVideos: 2,
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
            iterableVideos([{ id: "v1", durationInSeconds: 7_200 }])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
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
            iterableVideos([{ id: "v1", durationInSeconds: 3_600 }])
          ),
        },
      },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "bad-client",
        fetchFn,
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

  it("limits archive video fetching to keep the chat command responsive", async () => {
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        { id: "v1", durationInSeconds: 3_600 },
        { id: "v2", durationInSeconds: 3_600 },
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
        maxVideos: 1,
      }
    );

    expect(getVideosByUserPaginated).toHaveBeenCalledWith("broadcaster-id", {
      type: "archive",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("formatBoomSummary", () => {
  it("formats a compact chat response", () => {
    expect(
      formatBoomSummary({
        analyzedVideos: 20,
        games: [
          { gameName: "Game A", totalSeconds: 9_000 },
          { gameName: "Game B", totalSeconds: 3_600 },
        ],
      })
    ).toBe("最近20配信のゲーム時間(1時間以上): Game A 2時間30分 / Game B 1時間");
  });

  it("returns a not-found message when there are no qualifying games", () => {
    expect(formatBoomSummary({ analyzedVideos: 3, games: [] })).toBe(
      "最近3配信で1時間以上のゲームは見つかりませんでした。"
    );
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes without seconds", () => {
    expect(formatDuration(3_900)).toBe("1時間5分");
    expect(formatDuration(3_600)).toBe("1時間");
  });
});
