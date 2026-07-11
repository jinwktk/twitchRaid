import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import {
  DiscordApiRequestError,
  DiscordHistoryLookupError,
  type DiscordWebhookPayload,
} from "../src/notifications/discord-webhook";
import { Bot } from "../src/bot";
import {
  buildStreamSummaryThreadName,
  type EnsureStreamSummaryStartThreadOptions,
  type StartStreamSummaryThreadResult,
} from "../src/streams/stream-summary";
import logger from "../src/utils/logger";

let tmpDir: string | null = null;
let activeBot:
  | (Bot & {
      clipCacheStore: { close: () => void };
    })
  | null = null;

function makeConfig(): Config {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-notify-"));
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("Bot stream start notification", () => {
  it("passes stream identity into the Discord preview image URL", async () => {
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: ReturnType<typeof vi.fn>;
      _notifyStreamStartedOnDiscord: (stream: {
        id: string;
        title: string;
        userDisplayName?: string;
        gameName?: string;
        viewers?: number;
        thumbnailUrl?: string;
        startDate: Date;
      }) => Promise<void>;
    };
    activeBot = bot;
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(() => logger);
    bot._ensureStreamStartSummaryThread = vi.fn().mockResolvedValue({
      startMessageId: "start-message-id",
      threadId: "thread-id",
      postedStartNotification: true,
    });

    await bot._notifyStreamStartedOnDiscord({
      id: "stream-123",
      title: "配信タイトル",
      userDisplayName: "るかるん",
      gameName: "Just Chatting",
      viewers: 7,
      thumbnailUrl:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
      startDate: new Date("2026-06-06T01:05:28.000Z"),
    });

    expect(bot._ensureStreamStartSummaryThread).toHaveBeenCalledOnce();
    const payload = bot._ensureStreamStartSummaryThread.mock.calls[0][1] as
      | DiscordWebhookPayload
      | undefined;
    expect(payload?.embeds?.[0]?.image?.url).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?stream_id=stream-123"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "✅ 配信開始通知Discord投稿を確認しました: title=配信タイトル, streamPreviewImage=https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?stream_id=stream-123, startMessageId=start-message-id, threadId=thread-id"
    );
    infoSpy.mockRestore();
  });

  it("does not log a Discord preview image when no post result is available", async () => {
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: ReturnType<typeof vi.fn>;
      _notifyStreamStartedOnDiscord: (stream: {
        id: string;
        title: string;
        thumbnailUrl?: string;
        startDate: Date;
      }) => Promise<void>;
    };
    activeBot = bot;
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(() => logger);
    bot._ensureStreamStartSummaryThread = vi.fn().mockResolvedValue({});

    await bot._notifyStreamStartedOnDiscord({
      id: "stream-123",
      title: "配信タイトル",
      thumbnailUrl:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
      startDate: new Date("2026-06-06T01:05:28.000Z"),
    });

    expect(infoSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
  });

  it("logs the preview image URL for manual stream notifications", async () => {
    const bot = new Bot(makeConfig()) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _forceStreamStartSummaryThread: ReturnType<typeof vi.fn>;
      _postManualStreamStartNotification: (stream: {
        id: string;
        title: string;
        thumbnailUrl?: string;
        startDate: Date;
      }) => Promise<void>;
    };
    activeBot = bot;
    const infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation(() => logger);
    bot._forceStreamStartSummaryThread = vi.fn().mockResolvedValue({
      startMessageId: "manual-message-id",
      postedStartNotification: true,
    });

    await bot._postManualStreamStartNotification({
      id: "stream-456",
      title: "手動通知タイトル",
      thumbnailUrl:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
      startDate: new Date("2026-06-06T01:05:28.000Z"),
    });

    expect(infoSpy).toHaveBeenCalledWith(
      "✅ 配信開始通知Discord投稿を確認しました: title=手動通知タイトル, streamPreviewImage=https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?stream_id=stream-456, startMessageId=manual-message-id, threadId=none"
    );
    infoSpy.mockRestore();
  });

  it("keeps a pending ending summary when the summary thread is missing in bot-token mode", async () => {
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    fs.mkdirSync(path.dirname(config.streamSummaryStatePath), { recursive: true });
    fs.writeFileSync(
      config.streamSummaryStatePath,
      `${JSON.stringify({
        status: "pending",
        streamId: "stream-1",
        title: "配信タイトル",
        gameName: "Just Chatting",
        startedAt: "2026-06-01T10:00:00.000Z",
        endedAt: "2026-06-01T11:00:00.000Z",
        streamUrl: "https://www.twitch.tv/rukalun",
        commentCount: 10,
        raidCount: 0,
        postedClipIds: [],
      })}\n`
    );

    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: {
        close: () => void;
        listClipsCreatedBetween: ReturnType<typeof vi.fn>;
      };
      _finalizeAndPostStreamSummary: (endedAt: string) => Promise<void>;
    };
    activeBot = bot;
    bot.clipCacheStore.listClipsCreatedBetween = vi.fn().mockReturnValue([
      {
        id: "clip-a",
        title: "Clip",
        url: "https://www.twitch.tv/rukalun/clip/Clip",
        creatorDisplayName: "viewer",
        createdAt: "2026-06-01T10:30:00.000Z",
        views: 1,
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await bot._finalizeAndPostStreamSummary("2026-06-01T11:00:00.000Z");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-id",
      expect.objectContaining({ method: "GET" })
    );
    expect(
      fetchMock.mock.calls.some(([, init]) =>
        ["POST", "PATCH"].includes(String(init?.method ?? "GET"))
      )
    ).toBe(false);
    const saved = JSON.parse(
      fs.readFileSync(config.streamSummaryStatePath, "utf8")
    ) as { status: string; summaryMessageId?: string; postedClipIds: string[] };
    expect(saved.status).toBe("pending");
    expect(saved.summaryMessageId).toBeUndefined();
    expect(saved.postedClipIds).toEqual([]);
  });

  it("uses the Unicode-safe thread name for a webhook-only ending summary", async () => {
    const title = `${"a".repeat(91)}😀${"b".repeat(20)}`;
    const expectedThreadName = buildStreamSummaryThreadName(title);
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordSummaryWebhookThreadEnabled: true,
    };
    fs.mkdirSync(path.dirname(config.streamSummaryStatePath), { recursive: true });
    fs.writeFileSync(
      config.streamSummaryStatePath,
      `${JSON.stringify({
        status: "pending",
        streamId: "stream-emoji-title",
        title,
        gameName: "Just Chatting",
        startedAt: "2026-06-01T10:00:00.000Z",
        endedAt: "2026-06-01T11:00:00.000Z",
        streamUrl: "https://www.twitch.tv/rukalun",
        commentCount: 10,
        raidCount: 0,
        postedClipIds: [],
      })}\n`
    );

    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: {
        close: () => void;
        listClipsCreatedBetween: ReturnType<typeof vi.fn>;
      };
      _ensureCurrentStreamSummaryThread: ReturnType<typeof vi.fn>;
      _finalizeAndPostStreamSummary: (endedAt: string) => Promise<void>;
    };
    activeBot = bot;
    bot.clipCacheStore.listClipsCreatedBetween = vi.fn().mockReturnValue([]);
    bot._ensureCurrentStreamSummaryThread = vi.fn().mockResolvedValue(null);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "summary-message-id",
          channel_id: "thread-id",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await bot._finalizeAndPostStreamSummary("2026-06-01T11:00:00.000Z");

    expect(Array.from(expectedThreadName)).toHaveLength(100);
    expect(() => encodeURIComponent(expectedThreadName)).not.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({ thread_name: expectedThreadName })
    );
  });

  it("shares one thread-recovery attempt for the same channel and thread name", async () => {
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      streamSummaryStateStore: { save: (state: unknown) => void };
      _ensureStreamStartSummaryThread: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      _ensureStreamStartSummaryThreadOnce: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot.streamSummaryStateStore.save({
      status: "active",
      streamId: "stream-1",
      title: "同じ配信タイトル",
      gameName: "Just Chatting",
      startedAt: "2026-07-11T00:00:00.000Z",
      streamUrl: "https://www.twitch.tv/rukalun",
      commentCount: 0,
      raidCount: 0,
      postedClipIds: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 }))
    );

    let resolveAttempt:
      | ((result: StartStreamSummaryThreadResult) => void)
      | undefined;
    const attempt = new Promise<StartStreamSummaryThreadResult>((resolve) => {
      resolveAttempt = resolve;
    });
    bot._ensureStreamStartSummaryThreadOnce = vi.fn().mockReturnValue(attempt);

    const first = bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    const second = bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    const settled = Promise.allSettled([first, second]);

    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(1);
    resolveAttempt?.({
      startMessageId: "start-message-id",
      threadId: "thread-id",
    });

    await expect(first).resolves.toMatchObject({ threadId: "thread-id" });
    await expect(second).resolves.toMatchObject({ threadId: "thread-id" });
    await settled;
  });

  it("runs thread recovery independently for different expected thread names", async () => {
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      _ensureStreamStartSummaryThreadOnce: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 }))
    );

    const resolvers = new Map<
      string,
      (result: StartStreamSummaryThreadResult) => void
    >();
    bot._ensureStreamStartSummaryThreadOnce = vi.fn((title: string) =>
      new Promise<StartStreamSummaryThreadResult>((resolve) => {
        resolvers.set(title, resolve);
      })
    );

    const first = bot._ensureStreamStartSummaryThread("タイトルA", {
      content: "start-a",
    });
    const second = bot._ensureStreamStartSummaryThread("タイトルB", {
      content: "start-b",
    });
    const settled = Promise.allSettled([first, second]);

    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(2);
    resolvers.get("タイトルA")?.({ threadId: "thread-a" });
    resolvers.get("タイトルB")?.({ threadId: "thread-b" });

    await expect(first).resolves.toMatchObject({ threadId: "thread-a" });
    await expect(second).resolves.toMatchObject({ threadId: "thread-b" });
    await settled;
  });

  it("honors Discord 429 retry-after and performs zero recovery calls during backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      _ensureStreamStartSummaryThreadOnce: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot._ensureStreamStartSummaryThreadOnce = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordHistoryLookupError("rate_limited", {
          status: 429,
          retryAfterMs: 120_000,
        })
      )
      .mockResolvedValue({ threadId: "thread-id" });

    await expect(
      bot._ensureStreamStartSummaryThread("同じ配信タイトル", { content: "start" })
    ).resolves.toEqual({});
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-11T00:01:59.999Z"));
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-11T00:02:00.000Z"));
    await expect(
      bot._ensureStreamStartSummaryThread("同じ配信タイトル", { content: "start" })
    ).resolves.toMatchObject({ threadId: "thread-id" });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(2);
  });

  it("applies the same 429 backoff to thread-creation failures after saving the start id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      _ensureStreamStartSummaryThreadOnce: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot._ensureStreamStartSummaryThreadOnce = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordApiRequestError("thread_create", "rate_limited", {
          status: 429,
          retryAfterMs: 120_000,
        })
      )
      .mockResolvedValue({ threadId: "thread-id" });

    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-11T00:02:00.000Z"));
    await expect(
      bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
        content: "start",
      })
    ).resolves.toMatchObject({ threadId: "thread-id" });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(2);
  });

  it("uses capped exponential backoff for non-rate-limit recovery failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      _ensureStreamStartSummaryThread: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      _ensureStreamStartSummaryThreadOnce: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot._ensureStreamStartSummaryThreadOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValue({ threadId: "thread-id" });

    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    vi.setSystemTime(new Date("2026-07-11T00:00:59.999Z"));
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-11T00:01:00.000Z"));
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-07-11T00:02:59.999Z"));
    await bot._ensureStreamStartSummaryThread("同じ配信タイトル", {
      content: "start",
    });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date("2026-07-11T00:03:00.000Z"));
    await expect(
      bot._ensureStreamStartSummaryThread("同じ配信タイトル", { content: "start" })
    ).resolves.toMatchObject({ threadId: "thread-id" });
    expect(bot._ensureStreamStartSummaryThreadOnce).toHaveBeenCalledTimes(3);
  });

  it("persists a recovered start message immediately without overwriting newer state fields", async () => {
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      streamSummaryStateStore: {
        save: (state: unknown) => void;
        load: () => Record<string, unknown> | null;
      };
      _ensureStreamStartSummaryThreadOnce: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      streamSummaryThreadEnsurer: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot.streamSummaryStateStore.save({
      status: "active",
      streamId: "stream-1",
      title: "同じ配信タイトル",
      gameName: "Just Chatting",
      startedAt: "2026-07-11T00:00:00.000Z",
      streamUrl: "https://www.twitch.tv/rukalun",
      commentCount: 1,
      raidCount: 0,
      postedClipIds: [],
    });
    bot.streamSummaryThreadEnsurer = vi.fn(
      async (options: EnsureStreamSummaryStartThreadOptions) => {
        bot.streamSummaryStateStore.save({
          ...bot.streamSummaryStateStore.load(),
          status: "pending",
          commentCount: 9,
        });
        await options.persistStartMessage?.("start-message-id");
        expect(bot.streamSummaryStateStore.load()).toMatchObject({
          status: "pending",
          commentCount: 9,
          startMessageId: "start-message-id",
        });
        throw new Error("simulated crash before thread creation");
      }
    );

    await expect(
      bot._ensureStreamStartSummaryThreadOnce("同じ配信タイトル", {
        content: "start",
      })
    ).rejects.toThrow("simulated crash before thread creation");
    expect(bot.streamSummaryStateStore.load()).toMatchObject({
      status: "pending",
      commentCount: 9,
      startMessageId: "start-message-id",
    });
  });

  it("does not overwrite newer manual start and thread ids when an older recovery finishes", async () => {
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "channel-id",
    };
    const bot = new Bot(config) as unknown as {
      clipCacheStore: { close: () => void };
      streamSummaryStateStore: {
        save: (state: unknown) => void;
        load: () => Record<string, unknown> | null;
      };
      _ensureStreamStartSummaryThreadOnce: (
        title: string,
        message: DiscordWebhookPayload
      ) => Promise<StartStreamSummaryThreadResult>;
      streamSummaryThreadEnsurer: ReturnType<typeof vi.fn>;
    };
    activeBot = bot as unknown as Bot & {
      clipCacheStore: { close: () => void };
    };
    bot.streamSummaryStateStore.save({
      status: "active",
      streamId: "stream-1",
      title: "同じ配信タイトル",
      gameName: "Just Chatting",
      startedAt: "2026-07-11T00:00:00.000Z",
      streamUrl: "https://www.twitch.tv/rukalun",
      commentCount: 1,
      raidCount: 0,
      postedClipIds: [],
    });
    bot.streamSummaryThreadEnsurer = vi.fn(async () => {
      bot.streamSummaryStateStore.save({
        ...bot.streamSummaryStateStore.load(),
        startMessageId: "manual-start-message-id",
        threadId: "manual-thread-id",
      });
      return {
        startMessageId: "automatic-start-message-id",
        threadId: "automatic-thread-id",
      };
    });

    await bot._ensureStreamStartSummaryThreadOnce("同じ配信タイトル", {
      content: "start",
    });

    expect(bot.streamSummaryStateStore.load()).toMatchObject({
      startMessageId: "manual-start-message-id",
      threadId: "manual-thread-id",
    });
  });

  it("serializes live clip posting so concurrent triggers do not duplicate a clip", async () => {
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
    };
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: {
        close: () => void;
        listClipsCreatedBetween: ReturnType<typeof vi.fn>;
      };
      streamSummaryStateStore: {
        save: (state: unknown) => void;
        load: () => { postedClipIds: string[] } | null;
      };
      _postNewStreamClipsToSummaryThread: (now?: Date) => Promise<void>;
    };
    activeBot = bot;
    bot.streamSummaryStateStore.save({
      status: "active",
      streamId: "stream-1",
      title: "配信タイトル",
      gameName: "Just Chatting",
      startedAt: "2026-06-16T09:00:00.000Z",
      streamUrl: "https://www.twitch.tv/rukalun",
      commentCount: 10,
      raidCount: 0,
      threadId: "thread-id",
      postedClipIds: [],
    });
    bot.clipCacheStore.listClipsCreatedBetween = vi.fn().mockReturnValue([
      {
        id: "clip-a",
        title: "Clip",
        url: "https://www.twitch.tv/rukalun/clip/Clip",
        creatorDisplayName: "viewer",
        createdAt: "2026-06-16T09:30:00.000Z",
        views: 1,
      },
    ]);

    let resolveFirstPost: ((response: Response) => void) | null = null;
    const firstPost = new Promise<Response>((resolve) => {
      resolveFirstPost = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstPost)
      .mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const first = bot._postNewStreamClipsToSummaryThread(
      new Date("2026-06-16T09:30:12.000Z")
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = bot._postNewStreamClipsToSummaryThread(
      new Date("2026-06-16T09:30:12.500Z")
    );
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirstPost?.({ ok: true } as Response);
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bot.streamSummaryStateStore.load()?.postedClipIds).toEqual([
      "clip-a",
    ]);
  });
});
