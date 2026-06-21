import type { HelixClip } from "@twurple/api";
import { describe, expect, it, vi } from "vitest";
import {
  clipSearchHistoryKey,
  clipHistoryKey,
  pickClipAvoidingRecent,
  selectCachedClip,
  selectCachedClipSearch,
  selectClip,
} from "../../src/commands/clip";
import type { ClipCacheStore } from "../../src/commands/clip-cache-store";

function makeClip(
  id: string,
  creatorId = "creator-1",
  creatorDisplayName = "viewer"
): HelixClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title: `clip ${id}`,
    creatorId,
    creatorDisplayName,
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

describe("pickClipAvoidingRecent", () => {
  it("prefers clips that are not in recent history", () => {
    const selected = pickClipAvoidingRecent(
      [makeClip("seen"), makeClip("fresh")],
      ["seen"],
      () => 0
    );

    expect(selected?.id).toBe("fresh");
  });

  it("falls back to all clips when every clip is already in history", () => {
    const selected = pickClipAvoidingRecent(
      [makeClip("a"), makeClip("b")],
      ["a", "b"],
      () => 0.75
    );

    expect(selected?.id).toBe("b");
  });
});

describe("clipHistoryKey", () => {
  it("uses a global key for clip and a per-user key for myclip", () => {
    expect(clipHistoryKey("clip")).toBe("clip");
    expect(clipHistoryKey("myclip", "ViewerName")).toBe("myclip:viewername");
  });
});

describe("clipSearchHistoryKey", () => {
  it("normalizes whitespace and case for clipsearch history", () => {
    expect(clipSearchHistoryKey("  Just   Chatting  ")).toBe(
      "clipsearch:just chatting"
    );
  });
});

describe("selectCachedClip", () => {
  it("uses the resolved creator id for myclip cache lookup", () => {
    const selectedClip = {
      id: "mine",
      url: "https://clips.twitch.tv/mine",
      title: "mine",
    };
    const selectRandomClip = vi.fn().mockReturnValue(selectedClip);

    const selected = selectCachedClip(
      { selectRandomClip } as unknown as ClipCacheStore,
      "myclip",
      "nyme_ia",
      "creator-me",
      () => 0
    );

    expect(selected).toBe(selectedClip);
    expect(selectRandomClip).toHaveBeenCalledWith({
      historyKey: "myclip:nyme_ia",
      creatorName: "nyme_ia",
      creatorId: "creator-me",
      random: expect.any(Function),
    });
  });
});

describe("selectCachedClipSearch", () => {
  it("uses the normalized query for clipsearch cache lookup", () => {
    const selectedClip = {
      id: "matched",
      url: "https://clips.twitch.tv/matched",
      title: "matched",
    };
    const searchRandomClip = vi.fn().mockReturnValue(selectedClip);

    const selected = selectCachedClipSearch(
      { searchRandomClip } as unknown as ClipCacheStore,
      "  Just   Chatting  ",
      () => 0
    );

    expect(selected).toBe(selectedClip);
    expect(searchRandomClip).toHaveBeenCalledWith({
      historyKey: "clipsearch:just chatting",
      query: "Just Chatting",
      random: expect.any(Function),
    });
  });
});

describe("selectClip", () => {
  it("fetches Helix clip pages with identity encoding when credentials are provided", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() => {
      throw new Error("Twurple clip fetch should not be used");
    });
    const helixFetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              id: "direct",
              url: "https://clips.twitch.tv/direct",
              title: "direct clip",
              creator_id: "creator-1",
              creator_name: "Viewer",
            },
          ],
          pagination: {},
        }),
    }));

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcasterPaginated,
        },
        users: {},
      },
      "broadcaster-id",
      undefined,
      undefined,
      {
        maxFetch: 2,
        helixClientId: "client-id",
        helixAccessToken: "access-token",
        helixFetchFn,
      }
    );

    expect(selected?.id).toBe("direct");
    expect(getClipsForBroadcasterPaginated).not.toHaveBeenCalled();
    expect(helixFetchFn).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/clips?broadcaster_id=broadcaster-id&first=2",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "identity",
          Authorization: "Bearer access-token",
          "Client-ID": "client-id",
        },
      }
    );
  });

  it("retries transient Helix clip body failures", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() => {
      throw new Error("Twurple clip fetch should not be used");
    });
    const helixFetchFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Invalid response body while trying to fetch https://api.twitch.tv/helix/clips: Premature close"
        )
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: "retried",
                url: "https://clips.twitch.tv/retried",
                title: "retried clip",
                creator_id: "creator-me",
                creator_name: "Viewer",
              },
            ],
            pagination: {},
          }),
      });

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcasterPaginated,
        },
        users: {
          getUserByName: vi.fn().mockResolvedValue({ id: "creator-me" }),
        },
      },
      "broadcaster-id",
      undefined,
      "viewer",
      {
        helixClientId: "client-id",
        helixAccessToken: "access-token",
        helixFetchFn,
        clipRetryDelayMs: 0,
      }
    );

    expect(selected?.id).toBe("retried");
    expect(helixFetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses paginated fetching and avoids the old first-100 API path", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("seen"), makeClip("fresh")])
    );

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcasterPaginated,
        },
        users: {},
      },
      "broadcaster-id",
      undefined,
      undefined,
      {
        recentClipIds: ["seen"],
        random: () => 0,
      }
    );

    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledWith(
      "broadcaster-id"
    );
    expect(selected?.id).toBe("fresh");
  });

  it("limits the number of fetched clips to keep chat commands responsive", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([makeClip("a"), makeClip("b"), makeClip("c")])
    );

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcasterPaginated,
        },
        users: {},
      },
      "broadcaster-id",
      undefined,
      undefined,
      {
        maxFetch: 2,
        recentClipIds: ["a"],
        random: () => 0,
      }
    );

    expect(selected?.id).toBe("b");
  });

  it("filters myclip candidates by the resolved creator id", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(() =>
      iterableClips([
        makeClip("other", "creator-other", "Other"),
        makeClip("mine", "creator-me", "Viewer"),
      ])
    );

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcasterPaginated,
        },
        users: {
          getUserByName: vi.fn().mockResolvedValue({ id: "creator-me" }),
        },
      },
      "broadcaster-id",
      undefined,
      "Viewer",
      {
        random: () => 0,
      }
    );

    expect(selected?.id).toBe("mine");
  });
});
