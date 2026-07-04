import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";
import {
  extractBotRequestNote,
  saveBotRequestNoteObservationStore,
} from "../src/commands/bot-request-notes";

let tmpDir: string | null = null;
let activeBot:
  | (Bot & {
      clipCacheStore: { close: () => void };
      keepAliveTimer: ReturnType<typeof setInterval> | null;
    })
  | null = null;

function makeConfig(): Config {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-rec-"));
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
    clipCacheDbPath: ":memory:",
    clipRecentWindowMinutes: 360,
    streamSummaryStatePath: path.join(tmpDir, "stream-summary-state.json"),
    clipSearchAutoPublishEnabled: false,
    clipSearchDataPath: path.join(tmpDir, "clip-search-data.json"),
    clipSearchPublishRepoDir: tmpDir,
    clipSearchPublishMinIntervalMs: 300_000,
    clipSearchPublishRemote: "origin",
    clipSearchPublishBranch: "main",
    chatRecommendationEnabled: true,
    chatRecommendationIntervalMinutes: 60,
    botRequestNotesEnabled: false,
    botRequestNotesDbPath: path.join(tmpDir, "bot-request-notes.sqlite"),
    botRequestNotesDigestEnabled: false,
    botRequestNotesDigestIntervalHours: 168,
    botRequestNotesDigestMaxItems: 10,
    botRequestNotesDiscordChannelId: "",
    chatAiEnabled: false,
    chatAiBaseUrl: "http://127.0.0.1:11434",
    chatAiModel: "",
    chatAiTimeoutMs: 8000,
    chatAiTimeoutFallbackReply: "今ちょっとAIが混み合ってるD！",
    chatAiKeepAlive: "30m",
    chatAiPrewarmEnabled: false,
    chatAiPrewarmIntervalSeconds: 600,
    chatAiPrewarmTimeoutMs: 90_000,
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

function writeActiveStreamState(
  config: Config,
  streamId: string,
  startedAt: string
): void {
  fs.mkdirSync(path.dirname(config.streamSummaryStatePath), {
    recursive: true,
  });
  fs.writeFileSync(
    config.streamSummaryStatePath,
    `${JSON.stringify(
      {
        status: "active",
        streamId,
        title: "配信タイトル",
        gameName: "Just Chatting",
        startedAt,
        streamUrl: "https://www.twitch.tv/rukalun",
        commentCount: 0,
        raidCount: 0,
        postedClipIds: [],
      },
      null,
      2
    )}\n`
  );
}

afterEach(() => {
  if (activeBot?.keepAliveTimer) {
    clearInterval(activeBot.keepAliveTimer);
  }
  activeBot?.clipCacheStore.close();
  activeBot = null;
  vi.useRealTimers();
  vi.restoreAllMocks();

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

describe("Bot periodic recommendations", () => {
  it("posts a recommendation only while the stream is live", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    const say = vi.fn().mockResolvedValue(undefined);
    bot.chatClient = { say };
    bot.streamLive = true;

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(3_555_000);
    expect(say).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
    );
    expect(say.mock.calls[0][1]).toMatch(/^【定期】/);
    expect(say.mock.calls[0][1]).not.toMatch(/^!/);
  });

  it("does not post recommendations while offline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    const say = vi.fn().mockResolvedValue(undefined);
    bot.chatClient = { say };
    bot.streamLive = false;

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(7_200_000);

    expect(say).not.toHaveBeenCalled();
  });

  it("prewarms the chat AI model immediately and on the configured interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmIntervalSeconds: 600,
      chatAiPrewarmTimeoutMs: 90_000,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    const say = vi.fn().mockResolvedValue(undefined);
    bot.chatClient = { say };
    bot.streamLive = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ response: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );

    bot._startKeepAlive();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      model: "qwen3.5:9b",
      keep_alive: "30m",
      options: { num_predict: 1 },
    });

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(90 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(say).not.toHaveBeenCalled();
  });

  it("posts a bot request note digest through Discord when due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestIntervalHours: 168,
      botRequestNotesDigestMaxItems: 10,
    } as Config;
    const entry = extractBotRequestNote(
      "BotでRaid挨拶を再生成できるようにしてほしい",
      { sourceUser: "viewer" }
    );
    expect(entry).not.toBeNull();
    saveBotRequestNoteObservationStore({
      enabled: true,
      dbPath: config.botRequestNotesDbPath,
      entry: entry!,
      now: () => "2026-07-05T00:00:00.000Z",
    });
    const bot = new Bot(config) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    bot.chatClient = { say: vi.fn().mockResolvedValue(undefined) };
    bot.streamLive = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://discord.com/api/webhooks/123/token"
    );
    expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toMatchObject({
      content: expect.stringContaining("Bot要望メモ未対応"),
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("waits one interval after a new stream starts before posting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00.000Z"));
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _handleStreamStarted: (stream: {
        id: string;
        title: string;
        startDate: Date;
      }) => Promise<void>;
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    const say = vi.fn().mockResolvedValue(undefined);
    bot.chatClient = { say };
    bot.streamLive = false;
    bot._startKeepAlive();

    await vi.advanceTimersByTimeAsync(180_000);
    await bot._handleStreamStarted({
      id: "stream-1",
      title: "配信タイトル",
      startDate: new Date("2026-06-13T00:03:00.000Z"),
    });
    bot.streamLive = true;

    await vi.advanceTimersByTimeAsync(3_555_000);
    expect(say).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
    );
  });

  it("uses the stream start time after restoring an active stream state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:30:00.000Z"));
    const config = makeConfig();
    writeActiveStreamState(
      config,
      "stream-1",
      "2026-06-13T00:00:00.000Z"
    );
    const bot = new Bot(config) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      streamLive: boolean;
      keepAliveTimer: ReturnType<typeof setInterval> | null;
      clipCacheStore: { close: () => void };
      _handleStreamStarted: (stream: {
        id: string;
        title: string;
        startDate: Date;
      }) => Promise<void>;
      _startKeepAlive: () => void;
    };
    activeBot = bot;
    const say = vi.fn().mockResolvedValue(undefined);
    bot.chatClient = { say };

    await bot._handleStreamStarted({
      id: "stream-1",
      title: "配信タイトル",
      startDate: new Date("2026-06-13T00:00:00.000Z"),
    });
    bot.streamLive = true;
    bot._startKeepAlive();

    await vi.advanceTimersByTimeAsync(1_755_000);
    expect(say).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
    );
  });
});
