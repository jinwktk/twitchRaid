import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import type { DiscordWebhookPayload } from "../src/notifications/discord-webhook";
import { Bot } from "../src/bot";
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
  vi.restoreAllMocks();
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
});
