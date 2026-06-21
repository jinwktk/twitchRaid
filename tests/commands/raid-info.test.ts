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

  it("uses Helix identity fetch with retry for transient response body failures", async () => {
    const getStreamByUserName = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Invalid response body while trying to fetch https://api.twitch.tv/helix/streams?user_login=raiduser: Premature close"
        )
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [
              {
                title: "配信タイトル",
                game_name: "Game Name",
              },
            ],
          }),
      });

    await expect(
      fetchRaidSourceInfo(
        {
          streams: { getStreamByUserName },
        },
        "RaidUser",
        {
          helixClientId: "client-id",
          helixAccessToken: "access-token",
          helixFetchFn: fetchImpl,
          helixRetryAttempts: 2,
          helixRetryDelayMs: 0,
        }
      )
    ).resolves.toEqual({
      userName: "raiduser",
      streamUrl: "https://www.twitch.tv/raiduser",
      title: "配信タイトル",
      gameName: "Game Name",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://api.twitch.tv/helix/streams?user_login=raiduser",
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
    expect(getStreamByUserName).not.toHaveBeenCalled();
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
