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
  commandCooldownState: {
    lastUsed: (command: string) => number | null;
  };
  recastNotifiers: Record<
    string,
    {
      arm: (
        startedAt: number,
        sendCoroutine: (message: string) => Promise<void>
      ) => void;
      notifyIfReady: (currentTime: number) => Promise<void>;
    }
  >;
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
    lastMangaTime: 0,
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
    updateLastMangaTime: vi.fn(),
    updateLastStreamTitle: vi.fn(),
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
  vi.unstubAllEnvs();
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
      "!pvp",
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
      "!reset",
      "!shoutout",
      "!streamnotify",
    ]) {
      expect(message).toContain(command);
    }
    expect(message).not.toContain("!mangaon");
    expect(message).not.toContain("!mangaoff");
  });

  it("ignores the removed manga toggle commands", async () => {
    const { bot, say } = makeBot();
    const message = {
      userInfo: { isMod: false, isBroadcaster: true },
    };

    await bot._handleCommand("#rukalun", "rukalun", "!mangaon", message);
    await bot._handleCommand("#rukalun", "rukalun", "!mangaoff", message);

    expect(say).not.toHaveBeenCalled();
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
      "https://rukalun-page.vercel.app/"
    );
  });

  it("sends the 7days image album message for 7days command", async () => {
    const { bot, say } = makeBot();
    vi.spyOn(bot as unknown as { _getAvailableChatEmotes(): Promise<unknown[]> },
      "_getAvailableChatEmotes").mockResolvedValue([{ name: "rukkaEeeee" }]);

    await bot._handleCommand("#rukalun", "viewer", "!7days", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "7DAYS持ってるチャネポでリスナーさんも色々出来るので遊んでみてね https://imgur.com/a/w9Y9GbN rukkaEeeee"
    );
  });

  it("does not send a locked 7days emote as a literal code", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!7days", {});

    const message = say.mock.calls[0][1] as string;
    expect(message).not.toContain("rukkaEeeee");
    expect(message).toContain("https://imgur.com/a/w9Y9GbN");
    expect(message).toContain("😊");
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

  it("sends today's and tomorrow's Frontline rules for pvp command", async () => {
    const { bot, say } = makeBot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00.000Z"));

    await bot._handleCommand("#rukalun", "viewer", "!pvp", {});

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "今日のフロントライン：シールロック（争奪戦） / 明日：外縁遺跡群（制圧戦）"
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
      "7DAYS持ってるチャネポでリスナーさんも色々出来るので遊んでみてね https://imgur.com/a/w9Y9GbN 😊",
      "簡単に死んでたまるかッ🧟",
      "るっかるん、今日もお仕事気を付けて、いってらっしゃい",
      "15kg",
      "120cm",
      "今日の気分：絶好調！",
      "今日のおすすめ：ラーメン",
      "配信全体のコメント数: 0件",
    ]);
  });

  it("can suggest a meal from the expanded menu", async () => {
    const { bot, say } = makeBot();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999);

    try {
      await bot._handleCommand("#rukalun", "viewer", "!menu", {});
    } finally {
      randomSpy.mockRestore();
    }

    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "今日のおすすめ：タコス"
    );
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
      "⚠️ `shoutout` は管理者のみ実行できます。",
      "⚠️ 使い方: !shoutout <ユーザー名>",
      "⚠️ `streamnotify` は管理者のみ実行できます。",
      "⚠️ 現在配信中ではないため、配信通知は送信しませんでした。",
    ]);
  });

  it("keeps manga available despite a legacy OFF flag and deletes the reply after 10 seconds", async () => {
    vi.useFakeTimers();
    vi.stubEnv("MANGA_COMMAND_ENABLED", "false");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
      })
    );

    const { bot } = makeBot();
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
    await bot._handleCommand("#rukalun", "nyme_ia", "!manga", {});

    expect(sendChatMessage).toHaveBeenCalledWith(
      "broadcaster-id",
      "今日のおすすめ漫画：作品A https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html"
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

  it("does not consume manga cooldown when the Bot API reports an unsent reply", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(900_000_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
      })
    );
    const { bot, say, config } = makeBot();
    const sendChatMessage = vi.fn().mockResolvedValue({
      isSent: false,
      id: "",
    });
    bot.botUserId = "bot-user-id";
    bot.apiClient = {
      asUser: vi.fn(async (_userId, callback) =>
        callback({ chat: { sendChatMessage } })
      ),
    };

    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
    expect(config.updateLastMangaTime).not.toHaveBeenCalled();
  });

  it("restores manga cooldown and enforces the exact one-hour boundary", async () => {
    vi.useFakeTimers();
    const startedAtMs = 1_000_000;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { bot, say, config } = makeBot({
      lastMangaTime: startedAtMs / 1000,
    });

    vi.setSystemTime(startedAtMs + 3_599_999);
    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(say).toHaveBeenLastCalledWith(
      "#rukalun",
      "⚠️ `manga` コマンドは1時間に1回のみ使用できます。あと 0分 1秒 待ってください。"
    );

    vi.setSystemTime(startedAtMs + 3_600_000);
    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(config.updateLastMangaTime).toHaveBeenCalledWith(
      (startedAtMs + 3_600_000) / 1000
    );
  });

  it("shares the manga cooldown across ordinary users", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { bot, say, config } = makeBot();

    await bot._handleCommand("#rukalun", "viewer-a", "!manga", {});
    await bot._handleCommand("#rukalun", "viewer-b", "!manga", {});

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(config.updateLastMangaTime).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenLastCalledWith(
      "#rukalun",
      "⚠️ `manga` コマンドは1時間に1回のみ使用できます。あと 60分 0秒 待ってください。"
    );
  });

  it("lets CLIP_SPECIAL_USERS use manga repeatedly without consuming cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { bot, config } = makeBot({
      clipSpecialUsers: ["nyme_ia"],
      lastMangaTime: 3_000,
    });

    await bot._handleCommand("#rukalun", "NyMe_Ia", "!manga", {});
    await bot._handleCommand("#rukalun", "nyme_ia", "!manga", {});

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(config.updateLastMangaTime).not.toHaveBeenCalled();
  });

  it("does not consume manga cooldown when the ranking is empty or failed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const emptyResponse = {
      ok: true,
      status: 200,
      text: async () => "<html>候補なし</html>",
    };
    const successResponse = {
      ok: true,
      status: 200,
      text: async () =>
        '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(emptyResponse)
      .mockRejectedValueOnce(new Error("network failure"))
      .mockRejectedValueOnce(new Error("network failure"))
      .mockResolvedValueOnce(successResponse)
      .mockResolvedValueOnce(successResponse);
    vi.stubGlobal("fetch", fetchSpy);
    const { bot, config } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!manga", {});
    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(config.updateLastMangaTime).not.toHaveBeenCalled();

    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(config.updateLastMangaTime).toHaveBeenCalledTimes(1);
  });

  it("blocks a second ordinary manga request while ranking fetch is in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    let resolveFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.fn().mockReturnValue(pendingFetch);
    vi.stubGlobal("fetch", fetchSpy);
    const { bot, say, config } = makeBot();

    const firstRequest = bot._handleCommand(
      "#rukalun",
      "viewer-a",
      "!manga",
      {}
    );
    await Promise.resolve();
    const secondRequest = bot._handleCommand(
      "#rukalun",
      "viewer-b",
      "!manga",
      {}
    );
    await secondRequest;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "⚠️ `manga` コマンドを処理中です。しばらくお待ちください。"
    );

    resolveFetch({
      ok: true,
      status: 200,
      text: async () =>
        '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
    } as Response);
    await firstRequest;

    expect(config.updateLastMangaTime).toHaveBeenCalledTimes(1);
  });

  it("keeps manga cooldown independent from clip cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
      })
    );
    const { bot, config } = makeBot({
      lastClipTime: 6_000,
      lastMyclipTime: 6_000,
    });

    await bot._handleCommand("#rukalun", "viewer", "!manga", {});

    expect(config.updateLastMangaTime).toHaveBeenCalledWith(6_000);
    expect(config.updateLastClipTime).not.toHaveBeenCalled();
    expect(config.updateLastMyclipTime).not.toHaveBeenCalled();
    expect(bot.commandCooldownState.lastUsed("clip")).toBe(6_000);
    expect(bot.commandCooldownState.lastUsed("myclip")).toBe(6_000);
  });

  it("lets only CLIP_SPECIAL_USERS reset all command cooldowns and notifications", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_000_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          '<a href="/maniax/work/=/product_id/RJ123456.html">作品A</a>',
      })
    );
    const { bot, say, config } = makeBot({
      clipSpecialUsers: ["nyme_ia"],
      lastClipTime: 6_900,
      lastMyclipTime: 6_900,
      lastMangaTime: 6_900,
    });
    const readySender = vi.fn().mockResolvedValue(undefined);
    bot.recastNotifiers.clip.arm(6_900, readySender);
    bot.recastNotifiers.myclip.arm(6_900, readySender);

    await bot._handleCommand("#rukalun", "viewer", "!reset", {});

    expect(say).toHaveBeenLastCalledWith(
      "#rukalun",
      "⚠️ `reset` は管理者のみ実行できます。"
    );
    expect(config.updateLastClipTime).not.toHaveBeenCalled();
    expect(config.updateLastMyclipTime).not.toHaveBeenCalled();
    expect(config.updateLastMangaTime).not.toHaveBeenCalled();

    await bot._handleCommand("#rukalun", "NyMe_Ia", "!reset", {});

    expect(config.updateLastClipTime).toHaveBeenCalledWith(0);
    expect(config.updateLastMyclipTime).toHaveBeenCalledWith(0);
    expect(config.updateLastMangaTime).toHaveBeenCalledWith(0);
    expect(bot.commandCooldownState.lastUsed("clip")).toBeNull();
    expect(bot.commandCooldownState.lastUsed("myclip")).toBeNull();
    expect(bot.commandCooldownState.lastUsed("manga")).toBeNull();
    expect(say).toHaveBeenLastCalledWith(
      "#rukalun",
      "✅ `clip` / `myclip` / `manga` のリキャストをリセットしました。"
    );

    await bot.recastNotifiers.clip.notifyIfReady(10_000);
    await bot.recastNotifiers.myclip.notifyIfReady(10_000);
    expect(readySender).not.toHaveBeenCalled();
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
