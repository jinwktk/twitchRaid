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
  it("scans paginated date windows instead of only the first 100 clips", async () => {
    const getClipsForBroadcasterPaginated = vi.fn(
      (_broadcasterId: string, filter: { startDate?: string }) => {
        if (filter.startDate === "2024-01-01T00:00:00.000Z") {
          return iterableClips([makeClip("seen")]);
        }
        return iterableClips([makeClip("fresh")]);
      }
    );
    const getClipsForBroadcaster = vi.fn();

    const selected = await selectClip(
      {
        clips: {
          getClipsForBroadcaster,
          getClipsForBroadcasterPaginated,
        },
        users: {},
      },
      "broadcaster-id",
      undefined,
      undefined,
      {
        oldestClipDate: new Date("2024-01-01T00:00:00.000Z"),
        now: new Date("2024-03-01T00:00:00.000Z"),
        windowDays: 31,
        recentClipIds: ["seen"],
        random: () => 0,
      }
    );

    expect(getClipsForBroadcaster).not.toHaveBeenCalled();
    expect(getClipsForBroadcasterPaginated).toHaveBeenCalledTimes(2);
    expect(selected?.id).toBe("fresh");
  });

  it("filters myclip candidates by the resolved creator id across all windows", async () => {
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
        oldestClipDate: new Date("2024-01-01T00:00:00.000Z"),
        now: new Date("2024-01-15T00:00:00.000Z"),
        random: () => 0,
      }
    );

    expect(selected?.id).toBe("mine");
  });
});
