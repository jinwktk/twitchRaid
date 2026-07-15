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
    asUser?: ReturnType<typeof vi.fn>;
    clips?: {
      getClipsForBroadcasterPaginated?: ReturnType<typeof vi.fn>;
    };
    videos?: {
      getVideosByUserPaginated?: ReturnType<typeof vi.fn>;
    };
    users?: {
      getUserByName?: ReturnType<typeof vi.fn>;
    };
    streams?: {
      getStreamByUserName?: ReturnType<typeof vi.fn>;
    };
  };
  botUserId: string;
  clipCacheStore: {
    saveClips: (clips: unknown[]) => number;
    close: () => void;
  };
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

function makeConfig(overrides: Partial<Config> = {}): Config {
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
    ...overrides,
  } as unknown as Config;
}

function makeBot(overrides: Partial<Config> = {}): {
  bot: HelpTestBot;
  say: ReturnType<typeof vi.fn>;
  config: Config;
} {
  const config = makeConfig(overrides);
  const bot = new Bot(config) as unknown as HelpTestBot;
  const say = vi.fn().mockResolvedValue(undefined);
  bot.chatClient = { say };
  activeBot = bot;
  return { bot, say, config };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
      "!7days",
      "!die",
      "!work",
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

  it("sends the 7days image album message for 7days command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!7days", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "7DAYS持ってるチャネポでリスナーさんも色々出来るので遊んでみてね https://imgur.com/a/w9Y9GbN rukkaEeeee"
    );
  });

  it("sends the die survival phrase for die command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!die", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "簡単に死んでたまるかッ🧟");
  });

  it("sends the work send-off phrase for work command", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!work", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "るっかるん、今日もお仕事気を付けて、いってらっしゃい"
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
      "https://is.gd/rukalunyt"
    );

    const message = say.mock.calls[0][1] as string;
    expect(message).toMatch(/^[\x20-\x7E]+$/);
  });

  it("handles static, random, and count commands through the bot dispatcher", async () => {
    const { bot, say } = makeBot();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      for (const command of [
        "!age",
        "!goods",
        "!7days",
        "!die",
        "!work",
        "!weight",
        "!height",
        "!mood",
        "!menu",
        "!commentcount",
      ]) {
        await bot._handleCommand("#rukalun", "viewer", command, {});
      }
    } finally {
      randomSpy.mockRestore();
    }

    expect(say.mock.calls.map((call) => call[1])).toEqual([
      expect.stringMatching(/^\d+$/),
      "https://rukalun.booth.pm",
      "7DAYS持ってるチャネポでリスナーさんも色々出来るので遊んでみてね https://imgur.com/a/w9Y9GbN rukkaEeeee",
      "簡単に死んでたまるかッ🧟",
      "るっかるん、今日もお仕事気を付けて、いってらっしゃい",
      "15kg",
      "120cm",
      "今日の気分：絶好調！",
      "今日のおすすめ：ラーメン",
      "配信全体のコメント数: 0件",
    ]);
  });

  it("handles clip and myclip commands from the SQLite cache", async () => {
    const { bot, say } = makeBot();
    bot.apiClient = {
      users: { getUserByName: vi.fn().mockResolvedValue({ id: "creator-1" }) },
    };
    bot.clipCacheStore.saveClips([
      {
        id: "clip-1",
        url: "https://clips.twitch.tv/clip-1",
        title: "通常clip",
        creatorId: "creator-1",
        creatorDisplayName: "Viewer",
        createdAt: "2026-05-25T10:00:00.000Z",
        views: 10,
      },
    ]);

    await bot._handleCommand("#rukalun", "viewer", "!clip", {});
    await bot._handleCommand("#rukalun", "viewer", "!myclip", {});

    expect(say.mock.calls.map((call) => call[1])).toEqual([
      "https://clips.twitch.tv/clip-1",
      "https://clips.twitch.tv/clip-1",
    ]);
  });

  it("uses Helix identity fetch for the clip API fallback", async () => {
    const { bot, say } = makeBot();
    const getClipsForBroadcasterPaginated = vi.fn(() => {
      throw new Error("Twurple clip fetch should not be used");
    });
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [
            {
              id: "direct-clip",
              url: "https://clips.twitch.tv/direct-clip",
              title: "direct clip",
              creator_id: "creator-1",
              creator_name: "Viewer",
            },
          ],
          pagination: {},
        }),
    }));
    bot.apiClient = {
      clips: { getClipsForBroadcasterPaginated },
      users: {},
    };
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await bot._handleCommand("#rukalun", "viewer", "!clip", {});
    } finally {
      vi.unstubAllGlobals();
    }

    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "https://clips.twitch.tv/direct-clip"
    );
    expect(getClipsForBroadcasterPaginated).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/clips?broadcaster_id=broadcaster-id&first=100",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Accept-Encoding": "identity",
        }),
      })
    );
  });

  it("handles admin-gated commands with safe responses", async () => {
    const { bot, say } = makeBot();
    bot.apiClient = {
      streams: { getStreamByUserName: vi.fn().mockResolvedValue(null) },
    };
    const viewerMessage = {
      userInfo: { isMod: false, isBroadcaster: false },
    };
    const broadcasterMessage = {
      userInfo: { isMod: false, isBroadcaster: true },
    };

    await bot._handleCommand("#rukalun", "viewer", "!manga", viewerMessage);
    await bot._handleCommand("#rukalun", "viewer", "!mangaon", viewerMessage);
    await bot._handleCommand("#rukalun", "rukalun", "!mangaoff", broadcasterMessage);
    await bot._handleCommand("#rukalun", "viewer", "!shoutout", viewerMessage);
    await bot._handleCommand(
      "#rukalun",
      "rukalun",
      "!shoutout",
      broadcasterMessage
    );
    await bot._handleCommand(
      "#rukalun",
      "viewer",
      "!streamnotify",
      viewerMessage
    );
    await bot._handleCommand(
      "#rukalun",
      "rukalun",
      "!streamnotify",
      broadcasterMessage
    );

    expect(say.mock.calls.map((call) => call[1])).toEqual([
      "⚠️ `manga` コマンドは現在OFFです。",
      "⚠️ `mangaon` は管理者のみ実行できます。",
      "ℹ️ `manga` コマンドはすでにOFFです。",
      "⚠️ `shoutout` は管理者のみ実行できます。",
      "⚠️ 使い方: !shoutout <ユーザー名>",
      "⚠️ `streamnotify` は管理者のみ実行できます。",
      "⚠️ 現在配信中ではないため、配信通知は送信しませんでした。",
    ]);
  });

  it("lets nyme_ia enable manga and deletes the manga reply after 10 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
      })
    );

    const { bot, say, config } = makeBot({
      mangaCommandEnabled: false,
      mangaAdminUsers: ["rukalun", "nyme_ia"],
    });
    config.updateMangaCommandEnabled = vi.fn((enabled: boolean) => {
      config.mangaCommandEnabled = enabled;
    });
    const sendChatMessage = vi.fn().mockResolvedValue({ id: "manga-message-id" });
    const deleteChatMessages = vi.fn().mockResolvedValue(undefined);
    const asUser = vi.fn(async (_userId, callback) =>
      callback({
        chat: { sendChatMessage },
        moderation: { deleteChatMessages },
      })
    );
    bot.botUserId = "bot-user-id";
    bot.apiClient = { asUser };
    const message = {
      userInfo: { isMod: false, isBroadcaster: false },
    };

    await bot._handleCommand("#rukalun", "nyme_ia", "!mangaon", message);
    await bot._handleCommand("#rukalun", "nyme_ia", "!manga", message);

    expect(config.updateMangaCommandEnabled).toHaveBeenCalledWith(true);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "✅ `manga` コマンドをONにしました。"
    );
    expect(sendChatMessage).toHaveBeenCalledWith(
      "broadcaster-id",
      "今日のおすすめ漫画：作品A"
    );
    expect(deleteChatMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(deleteChatMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deleteChatMessages).toHaveBeenCalledWith(
      "broadcaster-id",
      "manga-message-id"
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
    const fetchSpy = vi.fn(async (_input, init) => {
      if (init.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [
                {
                  id: "v1",
                  created_at: "2026-06-01T00:00:00.000Z",
                  duration: "1h30m0s",
                },
              ],
              pagination: {},
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
                game: { displayName: "Fallback Game" },
                lengthSeconds: 5_400,
              },
            },
          }),
        };
      }

      return {
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
      };
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
    expect(getVideosByUserPaginated).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.twitch.tv/helix/videos?user_id=broadcaster-id&type=archive&first=20",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Accept-Encoding": "identity",
        }),
      })
    );
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
      if (init.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [
                {
                  id: "recent",
                  created_at: new Date(
                    now - 2 * 24 * 60 * 60 * 1000
                  ).toISOString(),
                  duration: "1h0m0s",
                },
                {
                  id: "older",
                  created_at: new Date(
                    now - 20 * 24 * 60 * 60 * 1000
                  ).toISOString(),
                  duration: "1h0m0s",
                },
              ],
              pagination: {},
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
