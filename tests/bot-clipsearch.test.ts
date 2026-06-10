import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";

let tmpDir: string | null = null;

type ClipSearchTestBot = Bot & {
  chatClient: { say: ReturnType<typeof vi.fn> };
  clipCacheStore: {
    saveClips: (clips: unknown[]) => number;
    getRecentIds: (historyKey: string) => string[];
    close: () => void;
  };
  _handleCommand: (
    channel: string,
    user: string,
    text: string,
    msg: unknown
  ) => Promise<void>;
};

let activeBot: ClipSearchTestBot | null = null;

function makeConfig(): Config {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-bot-"));
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
  bot: ClipSearchTestBot;
  say: ReturnType<typeof vi.fn>;
} {
  const bot = new Bot(makeConfig()) as unknown as ClipSearchTestBot;
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

describe("Bot clipsearch command", () => {
  it("shows usage when query is missing", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!clipsearch", {});

    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "⚠️ 使い方: !clipsearch <キーワード>"
    );
  });

  it("sends a matching clip URL and records clipsearch history", async () => {
    const { bot, say } = makeBot();
    bot.clipCacheStore.saveClips([
      {
        id: "just-chatting",
        url: "https://clips.twitch.tv/just-chatting",
        title: "Just Chattingの名場面",
        creatorId: "creator-1",
        creatorDisplayName: "Viewer",
        createdAt: "2026-05-25T10:00:00.000Z",
        views: 10,
      },
    ]);

    await bot._handleCommand(
      "#rukalun",
      "viewer",
      "!clipsearch Just Chatting",
      {}
    );

    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "https://clips.twitch.tv/just-chatting"
    );
    expect(bot.clipCacheStore.getRecentIds("clipsearch:just chatting")).toEqual([
      "just-chatting",
    ]);
  });

  it("shows a not-found message when no clip matches the query", async () => {
    const { bot, say } = makeBot();

    await bot._handleCommand("#rukalun", "viewer", "!clipsearch missing", {});

    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      "⚠️ `missing` に一致するクリップが見つかりませんでした。"
    );
  });
});
