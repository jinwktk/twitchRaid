import type { HelixClip } from "@twurple/api";
import { describe, expect, it, vi } from "vitest";
import {
  clipHistoryKey,
  pickClipAvoidingRecent,
  selectClip,
} from "../../src/commands/clip";

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

describe("selectClip", () => {
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
