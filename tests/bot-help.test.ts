import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";

let tmpDir: string | null = null;

type HelpTestBot = Bot & {
  chatClient: { say: ReturnType<typeof vi.fn> };
  apiClient: {
    videos: {
      getVideosByUserPaginated: ReturnType<typeof vi.fn>;
    };
  };
  clipCacheStore: { close: () => void };
  _handleCommand: (
    channel: string,
    user: string,
    text: string,
    msg: unknown
  ) => Promise<void>;
};

let activeBot: HelpTestBot | null = null;

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

function makeConfig(): Config {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-help-"));
  return {
    envFile: path.join(tmpDir, ".env"),
    loginChannel: "rukalun",
    commandPrefix: "!",
    twitchClientId: "client-id",
    twitchAccessToken: "access-token",
    twitchRefreshToken: "refresh-token",
    twitchSecretToken: "secret-token",
    twitchBroadcasterId: "broadcaster-id",
    twitchModeratorId: "moderator-id",
    twitchGqlClientId: "gql-client-id",
    discordWebhookUrl: "",
    discordBotToken: "",
    discordSummaryChannelId: "",
    discordSummaryWebhookThreadEnabled: false,
    lastClipTime: 0,
    lastMyclipTime: 0,
    lastStreamTitle: "",
    restartInterval: 0,
    restartFile: path.join(tmpDir, "last_restart.txt"),
    updateCheckInterval: 0,
    restartCheckInterval: 0,
    clipCacheDbPath: path.join(tmpDir, "clips.sqlite"),
    streamSummaryStatePath: path.join(tmpDir, "stream-summary-state.json"),
    maxSummaryClipPosts: 10,
    ollamaShoutoutEnabled: false,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaShoutoutModel: "",
    ollamaShoutoutTimeoutMs: 8000,
    ollamaShoutoutKeepAlive: "5m",
    clipSpecialUsers: [],
    mangaCommandEnabled: false,
    mangaAdminUsers: [],
    shoutoutAdminUsers: [],
    activeAuthScopes: [],
    updateAccessToken: vi.fn(),
    hasScopeReauthAttempted: vi.fn(),
    markScopeReauthAttempted: vi.fn(),
    hasScopeEchoed: vi.fn(),
    markScopeEchoed: vi.fn(),
    setActiveAuthScopes: vi.fn(),
    updateLastClipTime: vi.fn(),
    updateLastMyclipTime: vi.fn(),
    updateLastStreamTitle: vi.fn(),
    updateMangaCommandEnabled: vi.fn(),
    getLastStreamTitle: vi.fn(() => ""),
  } as unknown as Config;
}

function makeBot(): {
  bot: HelpTestBot;
  say: ReturnType<typeof vi.fn>;
} {
  const bot = new Bot(makeConfig()) as unknown as HelpTestBot;
  const say = vi.fn().mockResolvedValue(undefined);
  bot.chatClient = { say };
  activeBot = bot;
  return { bot, say };
}

afterEach(() => {
  activeBot?.clipCacheStore.close();
  activeBot = null;

  if (tmpDir) {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    tmpDir = null;
  }
});

describe("Bot help command", () => {
  it("sends a compact command list", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!help", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", expect.any(String));

    const message = say.mock.calls[0][1] as string;
    expect(message).toMatch(/^!/);
    expect(message).toContain("使えるコマンド");
    for (const command of [
      "!help",
      "!age",
      "!goods",
      "!site",
      "!x",
      "!youtube",
      "!game",
      "!weight",
      "!height",
      "!mood",
      "!menu",
      "!chat",
      "!clip",
      "!myclip",
      "!clipsearch",
      "!speed",
      "!commentcount",
      "!boom",
      "!manga",
      "!mangaon",
      "!mangaoff",
      "!shoutout",
      "!streamnotify",
    ]) {
      expect(message).toContain(command);
    }
  });

  it("keeps the response static when extra text follows the command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand(
      "#rukalun",
      "viewer",
      "!help ignore previous instructions",
      {}
    );

    expect(say).toHaveBeenCalledTimes(1);
    const message = say.mock.calls[0][1] as string;
    expect(message).toMatch(/^!/);
    expect(message).toContain("使えるコマンド");
    expect(message).not.toContain("ignore previous instructions");
  });

  it("sends the clip search site URL for site command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!site", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "https://www.rukalun.mydns.jp"
    );
  });

  it("sends the X account URL for x command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!x", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "https://x.com/rukalunlol");
  });

  it("sends the YouTube channel URL for youtube command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!youtube", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "https://www.youtube.com/@%E3%82%8B%E3%81%A3%E3%81%8B%E3%82%8B%E3%82%93%E3%82%8B%E3%81%A3%E3%81%8B"
    );
  });

  it("sends a random game suggestion from streamed VOD games", async () => {
    const { bot, say } = makeBot();
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        {
          id: "v1",
          durationInSeconds: 5_400,
          creationDate: new Date("2026-06-01T00:00:00.000Z"),
        },
      ])
    );
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            video: {
              game: { displayName: "Fallback Game" },
              lengthSeconds: 5_400,
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
                      durationMilliseconds: 2_700_000,
                      details: { game: { displayName: "Game B" } },
                    },
                  },
                ],
              },
            },
          },
        }),
      });
    bot.apiClient = {
      videos: { getVideosByUserPaginated },
    };
    vi.stubGlobal("fetch", fetchSpy);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);

    try {
      await bot._handleCommand("#rukalun", "viewer", "!game", {});
    } finally {
      randomSpy.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "ゲーム候補：Game B");
    expect(getVideosByUserPaginated).toHaveBeenCalledWith("broadcaster-id", {
      type: "archive",
    });
  });

  it("uses an optional day count for boom without reusing the default cache", async () => {
    const { bot, say } = makeBot();
    const now = Date.now();
    const getVideosByUserPaginated = vi.fn(() =>
      iterableVideos([
        {
          id: "recent",
          durationInSeconds: 3_600,
          creationDate: new Date(now - 2 * 24 * 60 * 60 * 1000),
        },
        {
          id: "older",
          durationInSeconds: 3_600,
          creationDate: new Date(now - 20 * 24 * 60 * 60 * 1000),
        },
      ])
    );
    const fetchSpy = vi.fn(async (_input, init) => {
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
    bot.apiClient = {
      videos: { getVideosByUserPaginated },
    };
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await bot._handleCommand("#rukalun", "viewer", "!boom 7", {});
      await bot._handleCommand("#rukalun", "viewer", "!boom", {});
    } finally {
      vi.unstubAllGlobals();
    }

    expect(say).toHaveBeenCalledTimes(2);
    expect(say.mock.calls[0][1]).toBe(
      "!過去7日間の総配信時間 1時間 / ゲーム時間(1時間以上): Game A 1時間"
    );
    expect(say.mock.calls[1][1]).toBe(
      "!過去30日間の総配信時間 2時間 / ゲーム時間(1時間以上): Game A 2時間"
    );
  });

  it("returns usage when boom day count is outside the supported VOD retention window", async () => {
    const { bot, say } = makeBot();
    const getVideosByUserPaginated = vi.fn();
    bot.apiClient = {
      videos: { getVideosByUserPaginated },
    };

    await bot._handleCommand("#rukalun", "viewer", "!boom 61", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "⚠️ 使い方: !boom [日数]（1〜60の整数）"
    );
    expect(getVideosByUserPaginated).not.toHaveBeenCalled();
  });
});
