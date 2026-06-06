import { describe, expect, it, vi } from "vitest";
import {
  fetchRaidSourceInfo,
  formatRaidSourceInfoMessage,
} from "../../src/commands/raid-info";

describe("formatRaidSourceInfoMessage", () => {
  it("includes raid source URL, stream title, and game name", () => {
    expect(
      formatRaidSourceInfoMessage({
        userName: "RaidUser",
        streamUrl: "https://www.twitch.tv/raiduser",
        title: "楽しい配信",
        gameName: "FINAL FANTASY XIV ONLINE",
      })
    ).toBe(
      "レイドありがとうD！！ @raiduser さんは、「FINAL FANTASY XIV ONLINE」で「楽しい配信」をしてたD！お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("falls back to URL-only message when stream metadata is unavailable", () => {
    expect(
      formatRaidSourceInfoMessage({
        userName: "RaidUser",
        streamUrl: "https://www.twitch.tv/raiduser",
        title: null,
        gameName: null,
      })
    ).toBe(
      "レイドありがとうD！！ @raiduser さんの配信情報は取得できなかったD！お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("keeps the message single-line and trims long titles", () => {
    const message = formatRaidSourceInfoMessage({
      userName: "raiduser",
      streamUrl: "https://www.twitch.tv/raiduser",
      title: `長い${"タイトル".repeat(40)}\n改行`,
      gameName: "Game",
    });

    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message).toContain("...");
  });
});

describe("fetchRaidSourceInfo", () => {
  it("fetches stream metadata by raider login name", async () => {
    const getStreamByUserName = vi.fn().mockResolvedValue({
      title: "配信タイトル",
      gameName: "Game Name",
    });

    await expect(
      fetchRaidSourceInfo(
        {
          streams: { getStreamByUserName },
        },
        "RaidUser"
      )
    ).resolves.toEqual({
      userName: "raiduser",
      streamUrl: "https://www.twitch.tv/raiduser",
      title: "配信タイトル",
      gameName: "Game Name",
    });
    expect(getStreamByUserName).toHaveBeenCalledWith("raiduser");
  });

  it("returns URL-only info when the raid source is already offline", async () => {
    await expect(
      fetchRaidSourceInfo(
        {
          streams: { getStreamByUserName: vi.fn().mockResolvedValue(null) },
        },
        "RaidUser"
      )
    ).resolves.toEqual({
      userName: "raiduser",
      streamUrl: "https://www.twitch.tv/raiduser",
      title: null,
      gameName: null,
    });
  });
});
