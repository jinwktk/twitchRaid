import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";
import logger from "../src/utils/logger";

let tmpDir: string | null = null;

function makeConfig(overrides: Partial<Config> = {}): Config {
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
    clipCacheDbPath: ":memory:",
    streamSummaryStatePath: path.join(tmpDir, "stream-summary-state.json"),
    maxSummaryClipPosts: 10,
    ollamaShoutoutEnabled: false,
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaShoutoutModel: "",
    ollamaShoutoutTimeoutMs: 8000,
    ollamaShoutoutKeepAlive: "5m",
    chatReplyEmotes: [],
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

afterEach(() => {
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

describe("Bot raid greeting", () => {
  it("fetches raid info without sending chat and sends exactly one greeting", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const bot = new Bot(makeConfig()) as unknown as {
      chatClient: { say: ReturnType<typeof vi.fn> };
      apiClient: {
        streams: {
          getStreamByUserName: ReturnType<typeof vi.fn>;
        };
      };
      _fetchRaidSourceInfo: (username: string) => Promise<unknown>;
      _sendRaidGreeting: (
        channel: string,
        info: unknown,
        viewerCount: number
      ) => Promise<void>;
    };
    bot.chatClient = { say: vi.fn().mockResolvedValue(undefined) };
    bot.apiClient = {
      streams: {
        getStreamByUserName: vi.fn().mockResolvedValue({
          title: "たのしい建築配信",
          gameName: "Minecraft",
        }),
      },
    };

    const info = await bot._fetchRaidSourceInfo("RaidUser");
    expect(bot.chatClient.say).not.toHaveBeenCalled();

    await bot._sendRaidGreeting("#rukalun", info, 1);
    expect(bot.chatClient.say).toHaveBeenCalledOnce();
    expect(bot.chatClient.say).toHaveBeenCalledWith(
      "#rukalun",
      "レイドありがとうD！！ @raiduser さんは、「Minecraft」で「たのしい建築配信」をしてたD！お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '✅ Raid挨拶文を送信: target=raiduser, viewerCount=1, message="レイドありがとうD！！ @raiduser さんは、「Minecraft」で「たのしい建築配信」をしてたD！'
      )
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://www.twitch.tv/raiduser"'
      )
    );
  });

  it("appends a configured Twitch emote to raid greetings", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const bot = new Bot(
      makeConfig({ chatReplyEmotes: ["rukkaHi"] })
    ) as unknown as {
      chatClient: { say: ReturnType<typeof vi.fn> };
      apiClient: {
        streams: {
          getStreamByUserName: ReturnType<typeof vi.fn>;
        };
      };
      _fetchRaidSourceInfo: (username: string) => Promise<unknown>;
      _sendRaidGreeting: (
        channel: string,
        info: unknown,
        viewerCount: number
      ) => Promise<void>;
    };
    bot.chatClient = { say: vi.fn().mockResolvedValue(undefined) };
    bot.apiClient = {
      streams: {
        getStreamByUserName: vi.fn().mockResolvedValue({
          title: "たのしい建築配信",
          gameName: "Minecraft",
        }),
      },
    };

    const info = await bot._fetchRaidSourceInfo("RaidUser");
    await bot._sendRaidGreeting("#rukalun", info, 1);

    expect(bot.chatClient.say).toHaveBeenCalledWith(
      "#rukalun",
      "レイドありがとうD！！ @raiduser さんは、「Minecraft」で「たのしい建築配信」をしてたD！お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser rukkaHi"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'message="レイドありがとうD！！ @raiduser さんは、「Minecraft」で「たのしい建築配信」をしてたD！'
      )
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('rukkaHi"')
    );
  });
});
