import { describe, expect, it, vi } from "vitest";
import { TwitchVodCommentsClient } from "../../src/first-comment/vod-comments-client";

describe("TwitchVodCommentsClient", () => {
  it("fetches comments from a VOD response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          data: {
            video: {
              comments: {
                edges: [
                  {
                    node: {
                      contentOffsetSeconds: 7.25,
                      createdAt: "2026-05-25T10:00:07.250Z",
                      commenter: {
                        login: "viewer",
                        displayName: "Viewer",
                      },
                      message: {
                        fragments: [{ text: "初" }, { text: "コメ" }],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    });
    const client = new TwitchVodCommentsClient({ fetchFn });

    const comments = await client.fetchComments("123", {
      videoCreatedAt: "2026-05-25T10:00:00.000Z",
    });

    expect(comments).toEqual([
      {
        offsetSeconds: 7.25,
        commentedAt: "2026-05-25T10:00:07.250Z",
        authorName: "viewer",
        authorDisplayName: "Viewer",
        messageText: "初コメ",
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://gql.twitch.tv/gql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Client-ID": expect.any(String),
          "content-type": "application/json",
        }),
      })
    );
  });

  it("returns null when a VOD has no comments", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          data: {
            video: {
              comments: {
                edges: [],
              },
            },
          },
        },
      ],
    });
    const client = new TwitchVodCommentsClient({ fetchFn });

    await expect(
      client.fetchComments("123", {
        videoCreatedAt: "2026-05-25T10:00:00.000Z",
      })
    ).resolves.toEqual([]);
  });
});
