import { describe, expect, it, vi } from "vitest";
import {
  buildStreamedGameCandidates,
  formatGameSuggestion,
  selectRandomStreamedGame,
} from "../../src/commands/game";

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

describe("streamed game suggestion", () => {
  it("builds unique game candidates from archive VOD chapters and metadata", async () => {
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        {
          id: "v1",
          durationInSeconds: 4_200,
          creationDate: new Date("2026-06-01T00:00:00.000Z"),
        },
        {
          id: "v2",
          durationInSeconds: 3_600,
          creationDate: new Date("2026-05-30T00:00:00.000Z"),
        },
      ])
    );
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
                      durationMilliseconds: 2_100_000,
                      details: { game: { displayName: "Game A" } },
                    },
                  },
                  {
                    node: {
                      positionMilliseconds: 2_100_000,
                      durationMilliseconds: 2_100_000,
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
              game: { displayName: "Game C" },
              lengthSeconds: 3_600,
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

    const candidates = await buildStreamedGameCandidates(
      { videos: { getVideosByUserPaginated } },
      {
        broadcasterId: "broadcaster-id",
        gqlClientId: "gql-client",
        fetchFn,
        maxConcurrentVideos: 1,
        now: () => new Date("2026-06-02T00:00:00.000Z"),
      }
    );

    expect(candidates).toHaveLength(3);
    expect(new Set(candidates)).toEqual(
      new Set(["Game A", "Game B", "Game C"])
    );
    expect(candidates).not.toContain("Minecraft");
    expect(getVideosByUserPaginated).toHaveBeenCalledWith("broadcaster-id", {
      type: "archive",
    });
  });

  it("selects and formats a random streamed game candidate", () => {
    const game = selectRandomStreamedGame(["Game A", "Game B"], () => 0.75);

    expect(game).toBe("Game B");
    expect(formatGameSuggestion(game)).toBe("ゲーム候補：Game B");
  });

  it("returns null when streamed game candidates are empty", () => {
    expect(selectRandomStreamedGame([], () => 0)).toBeNull();
  });
});
