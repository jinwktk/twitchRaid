import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";

let tmpDir: string | null = null;

type MentionChatTestBot = Bot & {
  chatClient: { say: ReturnType<typeof vi.fn> };
  clipCacheStore: { close: () => void };
  _handleRegularMessage: (
    channel: string,
    user: string,
    text: string,
    now?: number
  ) => Promise<void>;
  _handleCommand: (
    channel: string,
    user: string,
    text: string,
    msg: unknown
  ) => Promise<void>;
};

let activeBot: MentionChatTestBot | null = null;

function makeConfig(overrides: Partial<Config> = {}): Config {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-mention-"));
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
    chatAiEnabled: true,
    chatAiBaseUrl: "http://127.0.0.1:11434",
    chatAiModel: "qwen2.5:7b",
    chatAiTimeoutMs: 3000,
    chatAiKeepAlive: "30m",
    chatAiMaxResponseChars: 200,
    chatAiBotAliases: ["rukalun"],
    chatAiCooldownSeconds: 60,
    chatAiIgnoredUsers: ["rukalun"],
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
  bot: MentionChatTestBot;
  say: ReturnType<typeof vi.fn>;
} {
  const bot = new Bot(makeConfig(overrides)) as unknown as MentionChatTestBot;
  const say = vi.fn().mockResolvedValue(undefined);
  bot.chatClient = { say };
  activeBot = bot;
  return { bot, say };
}

afterEach(() => {
  activeBot?.clipCacheStore.close();
  activeBot = null;
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

describe("Bot mention chat", () => {
  it("replies to a non-command bot mention when chat AI is enabled", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "こんにちはD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun こんにちは",
      Date.now() / 1000
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "こんにちはD！");
  });

  it("keeps normal comment accounting for mention messages", async () => {
    const { bot, say } = makeBot({ chatAiEnabled: false });
    const now = Math.floor(Date.now() / 1000);
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);

    await bot._handleRegularMessage("#rukalun", "viewer", "@rukalun こんにちは", now);
    await bot._handleCommand("#rukalun", "viewer", "!speed", {});

    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      expect.stringContaining("直近60秒 1/分 (1件)")
    );
  });

  it("does not call AI for command messages", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await bot._handleCommand("#rukalun", "viewer", "!help @rukalun", {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledTimes(1);
    expect(say.mock.calls[0][1]).toContain("使えるコマンド");
  });

  it("does not send chat message when AI returns null", async () => {
    const { bot, say } = makeBot();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await bot._handleRegularMessage("#rukalun", "viewer", "@rukalun こんにちは", 100);

    expect(say).not.toHaveBeenCalled();
  });

  it("ignores configured bot users but still counts the comment", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const now = Math.floor(Date.now() / 1000);
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);

    await bot._handleRegularMessage(
      "#rukalun",
      "rukalun",
      "@rukalun こんにちは",
      now
    );
    await bot._handleCommand("#rukalun", "viewer", "!speed", {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(
      "#rukalun",
      expect.stringContaining("直近60秒 1/分 (1件)")
    );
  });

  it("skips mention chat while a request is already in flight", async () => {
    const { bot, say } = makeBot();
    let resolveFetch: ((value: Response) => void) | null = null;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ response: "二回目D！" }),
      } as Response);

    const first = bot._handleRegularMessage(
      "#rukalun",
      "viewer1",
      "@rukalun こんにちは",
      100
    );
    await bot._handleRegularMessage(
      "#rukalun",
      "viewer2",
      "@rukalun もう一回",
      101
    );

    resolveFetch?.({
      ok: true,
      json: async () => ({ response: "一回目だよD！" }),
    } as Response);
    await first;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "一回目だよD！");
  });

  it("skips mention chat during cooldown after a failed attempt", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ response: "二回目D！" }),
      } as Response);

    await bot._handleRegularMessage("#rukalun", "viewer1", "@rukalun こんにちは", 100);
    await bot._handleRegularMessage("#rukalun", "viewer2", "@rukalun もう一回", 120);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalled();
  });
});
