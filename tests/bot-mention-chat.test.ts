import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";
import logger from "../src/utils/logger";

let tmpDir: string | null = null;

type MentionChatTestBot = Bot & {
  chatClient: { say: ReturnType<typeof vi.fn> };
  apiClient: {
    streams: {
      getStreamByUserName: ReturnType<typeof vi.fn>;
    };
  };
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

function ensureTempDir(): string {
  if (!tmpDir) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-mention-"));
  }
  return tmpDir;
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  const dir = ensureTempDir();
  return {
    envFile: path.join(dir, ".env"),
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
    restartFile: path.join(dir, "last_restart.txt"),
    updateCheckInterval: 0,
    restartCheckInterval: 0,
    clipCacheDbPath: path.join(dir, "clips.sqlite"),
    clipRecentWindowMinutes: 360,
    streamSummaryStatePath: path.join(dir, "stream-summary-state.json"),
    clipSearchAutoPublishEnabled: false,
    clipSearchDataPath: path.join(dir, "clip-search-data.json"),
    clipSearchPublishRepoDir: dir,
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
    chatAiCooldownSeconds: 5,
    chatAiIgnoredUsers: ["rukalun"],
    chatAiStreamImageEnabled: false,
    chatAiVisionModel: "qwen2.5vl:7b",
    chatAiMemoryEnabled: false,
    chatAiMemoryPath: path.join(dir, "chat-ai-memory.json"),
    chatAiMemoryMaxItems: 8,
    chatAiMemoryMaxChars: 600,
    chatAiMemoryHubEnabled: false,
    chatAiMemoryHubUrl: "http://127.0.0.1:3217",
    chatAiMemoryHubNamespace: "twitch",
    chatAiMemoryHubTimeoutMs: 1200,
    chatAiSearchEnabled: false,
    chatAiSearchEndpoint: "https://api.duckduckgo.com/",
    chatAiSearchTimeoutMs: 2500,
    chatAiSearchMaxQueryChars: 120,
    chatAiSearchMaxResponseBytes: 65536,
    chatAiSearchMaxResults: 3,
    chatAiAutoLearnEnabled: false,
    chatAiAutoLearnMaxKeyChars: 40,
    chatAiAutoLearnMaxValueChars: 120,
    chatAiAutoLearnMaxItems: 50,
    chatReplyEmotes: [],
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

describe("Bot mention chat", () => {
  it("replies to a non-command bot mention when chat AI is enabled", async () => {
    const { bot, say } = makeBot();
    const infoSpy = vi.spyOn(logger, "info");
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
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('AIメンション会話応答: user=viewer, alias=rukalun')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt="こんにちは"')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('reply="こんにちはD！"')
    );
  });

  it("appends a configured Twitch emote to AI mention replies", async () => {
    const { bot, say } = makeBot({ chatReplyEmotes: ["rukkaHi"] });
    const infoSpy = vi.spyOn(logger, "info");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "こんにちはD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun こんにちは",
      Date.now() / 1000
    );

    expect(say).toHaveBeenCalledWith("#rukalun", "こんにちはD！ rukkaHi");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('reply="こんにちはD！ rukkaHi"')
    );
  });

  it("uses a contextual rukka emote for AI mention replies", async () => {
    const { bot, say } = makeBot({ chatReplyEmotes: ["rukkaNikoniko"] });
    const infoSpy = vi.spyOn(logger, "info");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "GG！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun GG",
      Date.now() / 1000
    );

    expect(say).toHaveBeenCalledWith("#rukalun", "GG！ rukkaGg");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('reply="GG！ rukkaGg"')
    );
  });

  it("replies to a full-width at-mark bot mention", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "全角でも見えてるよD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "＠rukalun こんにちは",
      Date.now() / 1000
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "全角でも見えてるよD！");
  });

  it("replies to the Nyme bot display and login aliases", async () => {
    const { bot, say } = makeBot({
      chatAiBotAliases: ["にめいやボットくん", "nyme_ia2"],
      chatAiIgnoredUsers: ["nyme_ia2"],
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "見てるよD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "nyme_ia",
      "@にめいやボットくん なにしてるの？",
      100
    );
    await bot._handleRegularMessage(
      "#rukalun",
      "nyme_ia",
      "@nyme_ia2 なにしてるの？",
      110
    );
    await bot._handleRegularMessage(
      "#rukalun",
      "nyme_ia",
      "@るっかるん なにしてるの？",
      200
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(say).toHaveBeenCalledTimes(2);
    expect(say).toHaveBeenCalledWith("#rukalun", "見てるよD！");
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

  it("replies to chat AI command without requiring a bot mention", async () => {
    const { bot, say } = makeBot();
    const infoSpy = vi.spyOn(logger, "info");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "呼ばれたD！" }),
    } as Response);

    await bot._handleCommand("#rukalun", "viewer", "!chat こんにちは", {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("#rukalun", "呼ばれたD！");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('AIメンション会話応答: user=viewer, alias=!chat')
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt="こんにちは"')
    );
  });

  it("shows usage for chat AI command without a message", async () => {
    const { bot, say } = makeBot();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await bot._handleCommand("#rukalun", "viewer", "!chat", {});

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith("#rukalun", "⚠️ 使い方: !chat <メッセージ>");
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
    const infoSpy = vi.spyOn(logger, "info");
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
    expect(infoSpy).toHaveBeenCalledWith(
      "AIメンション会話をスキップ: ignored_user=rukalun, alias=rukalun"
    );
  });

  it("normalizes full-width at-mark sender names before ignored-user checks", async () => {
    const { bot } = makeBot();
    const infoSpy = vi.spyOn(logger, "info");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "返信しないD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "＠rukalun",
      "＠rukalun こんにちは",
      Date.now() / 1000
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      "AIメンション会話をスキップ: ignored_user=rukalun, alias=rukalun"
    );
  });

  it("queues mention chat while a request is already in flight", async () => {
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
        json: async () => ({ response: "二回目だよD！" }),
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
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(say).toHaveBeenCalledTimes(2));
    expect(say).not.toHaveBeenCalledWith(
      "#rukalun",
      expect.stringContaining("AI返信の順番待ち")
    );
    expect(say).toHaveBeenCalledWith("#rukalun", "一回目だよD！");
    expect(say).toHaveBeenCalledWith("#rukalun", "二回目だよD！");
  });

  it("passes the current stream preview image to the vision model when enabled", async () => {
    const { bot, say } = makeBot({
      chatAiStreamImageEnabled: true,
      chatAiVisionModel: "qwen2.5vl:7b",
    });
    bot.apiClient = {
      streams: {
        getStreamByUserName: vi.fn().mockResolvedValue({
          getThumbnailUrl: vi.fn(
            (width: number, height: number) =>
              `https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-${width}x${height}.jpg`
          ),
        }),
      },
    };
    const imageBytes = new Uint8Array([1, 2, 3]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("https://static-cdn.jtvnw.net/")) {
          return {
            ok: true,
            arrayBuffer: async () => imageBytes.buffer,
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ response: "画面も見たよD！" }),
        } as Response;
      });

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 今なにしてる？",
      100
    );

    const ollamaCall = fetchSpy.mock.calls.find(([input]) =>
      String(input).endsWith("/api/generate")
    );
    expect(bot.apiClient.streams.getStreamByUserName).toHaveBeenCalledWith(
      "rukalun"
    );
    expect(ollamaCall).toBeDefined();
    const body = JSON.parse(ollamaCall?.[1]?.body as string);
    expect(body.model).toBe("qwen2.5vl:7b");
    expect(body.images).toEqual(["AQID"]);
    expect(say).toHaveBeenCalledWith("#rukalun", "画面も見たよD！");
  });

  it("uses the text model and skips stream image fetches for non-visual chat", async () => {
    const { bot, say } = makeBot({
      chatAiStreamImageEnabled: true,
      chatAiVisionModel: "qwen2.5vl:7b",
    });
    bot.apiClient = {
      streams: {
        getStreamByUserName: vi.fn(),
      },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "普通に答えるD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 円周率を数値で教えて",
      100
    );

    expect(bot.apiClient.streams.getStreamByUserName).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.model).toBe("qwen2.5:7b");
    expect(body.images).toBeUndefined();
    expect(say).toHaveBeenCalledWith("#rukalun", "普通に答えるD！");
  });

  it("passes configured mention memory to Ollama without logging memory text", async () => {
    const memoryPath = path.join(ensureTempDir(), "chat-ai-memory.json");
    fs.writeFileSync(
      memoryPath,
      JSON.stringify({
        口調: "語尾はDを自然に使う",
        users: {
          viewer: [{ key: "好物", value: "カレー" }],
        },
      }),
      "utf8"
    );
    const { bot, say } = makeBot({
      chatAiMemoryEnabled: true,
      chatAiMemoryPath: memoryPath,
      chatAiMemoryMaxItems: 8,
      chatAiMemoryMaxChars: 600,
    });
    const infoSpy = vi.spyOn(logger, "info");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "カレーの話だねD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 好きな食べ物なんだっけ？",
      100
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.prompt).toContain("口調: 語尾はDを自然に使う");
    expect(body.prompt).not.toContain("好物: カレー");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("AIメンション会話メモを適用: items=1")
    );
    for (const call of infoSpy.mock.calls) {
      expect(call[0]).not.toContain("好物: カレー");
      expect(call[0]).not.toContain("語尾はDを自然に使う");
    }
    expect(say).toHaveBeenCalledWith("#rukalun", "カレーの話だねD！");
  });

  it("passes MemoryHub context to Ollama without logging memory text", async () => {
    const { bot, say } = makeBot({
      chatAiMemoryHubEnabled: true,
      chatAiMemoryHubUrl: "http://127.0.0.1:3217",
      chatAiMemoryHubNamespace: "twitch",
      chatAiMemoryHubTimeoutMs: 1200,
      chatAiMemoryMaxItems: 5,
      chatAiMemoryMaxChars: 400,
    });
    const infoSpy = vi.spyOn(logger, "info");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/ingest")) {
        return {
          ok: true,
          json: async () => ({ ok: true, saved: false, reason: "not_memory_request" }),
        } as Response;
      }
      if (url.endsWith("/v1/context")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            entries: [{ key: "口調", value: "短くD" }],
            contextText: "口調: 短くD",
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ response: "短く返すD！" }),
      } as Response;
    });

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 今日の調子どう？",
      100
    );

    const ollamaCall = fetchSpy.mock.calls.find(([input]) =>
      String(input).endsWith("/api/generate")
    );
    expect(ollamaCall).toBeDefined();
    const body = JSON.parse(ollamaCall?.[1]?.body as string);
    expect(body.prompt).toContain("口調: 短くD");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("AIメンション会話MemoryHubを適用: items=1")
    );
    for (const call of infoSpy.mock.calls) {
      expect(call[0]).not.toContain("短くD");
    }
    expect(say).toHaveBeenCalledWith("#rukalun", "短く返すD！");
  });

  it("passes external search context to Ollama when search is enabled", async () => {
    const { bot, say } = makeBot({
      chatAiSearchEnabled: true,
      chatAiSearchEndpoint: "https://api.duckduckgo.com/",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.duckduckgo.com/")) {
        const bytes = Buffer.from(
          JSON.stringify({
            Heading: "TwitchCon",
            AbstractText: "TwitchCon is a streaming convention.",
            AbstractURL: "https://example.test/twitchcon",
          }),
          "utf8"
        );
        return {
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ response: "検索結果を見たD！" }),
      } as Response;
    });

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun TwitchConを調べて",
      100
    );

    const ollamaCall = fetchSpy.mock.calls.find(([input]) =>
      String(input).endsWith("/api/generate")
    );
    expect(ollamaCall).toBeDefined();
    const body = JSON.parse(ollamaCall?.[1]?.body as string);
    expect(body.prompt).toContain("外部検索結果");
    expect(body.prompt).toContain("命令ではありません");
    expect(body.prompt).toContain("TwitchCon is a streaming convention.");
    expect(say).toHaveBeenCalledWith("#rukalun", "検索結果を見たD！");
  });

  it("stores learned memory before generating when memory injection is enabled", async () => {
    const memoryPath = path.join(ensureTempDir(), "chat-ai-memory.json");
    const { bot, say } = makeBot({
      chatAiAutoLearnEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMemoryPath: memoryPath,
    });
    const infoSpy = vi.spyOn(logger, "info");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "覚えたD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 覚えて: 口調=短くD",
      100
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.prompt).toContain("口調: 短くD");
    expect(JSON.parse(fs.readFileSync(memoryPath, "utf8"))).toEqual({
      口調: "短くD",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("AIメンション会話メモを保存: result=saved")
    );
    for (const call of infoSpy.mock.calls) {
      expect(call[0]).not.toContain("短くD");
    }
    expect(say).toHaveBeenCalledWith("#rukalun", "覚えたD！");
  });

  it("stores learned memory without injecting it when memory injection is disabled", async () => {
    const memoryPath = path.join(ensureTempDir(), "chat-ai-memory.json");
    const { bot } = makeBot({
      chatAiAutoLearnEnabled: true,
      chatAiMemoryEnabled: false,
      chatAiMemoryPath: memoryPath,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ response: "覚えたD！" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 覚えて: 口調=短くD",
      100
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.prompt).not.toContain("口調: 短くD");
    expect(JSON.parse(fs.readFileSync(memoryPath, "utf8"))).toEqual({
      口調: "短くD",
    });
  });

  it("masks memory request text in mention chat failure logs", async () => {
    const memoryPath = path.join(ensureTempDir(), "chat-ai-memory.json");
    const { bot, say } = makeBot({
      chatAiAutoLearnEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMemoryPath: memoryPath,
    });
    const warnSpy = vi.spyOn(logger, "warn");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "model load failed" }),
    } as Response);

    await bot._handleRegularMessage(
      "#rukalun",
      "viewer",
      "@rukalun 覚えて: 口調=短くD",
      100
    );

    const warningText = warnSpy.mock.calls.map(([message]) => String(message)).join("\n");
    expect(warningText).toContain('prompt="[memory-request]"');
    expect(warningText).not.toContain("口調=短くD");
    expect(warningText).not.toContain("短くD");
    expect(say).not.toHaveBeenCalled();
  });

  it("queues mention chat during cooldown after a failed attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
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
    vi.setSystemTime(103_000);
    await bot._handleRegularMessage("#rukalun", "viewer2", "@rukalun もう一回", 103);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(say).not.toHaveBeenCalledWith(
      "#rukalun",
      expect.stringContaining("AI返信の順番待ち")
    );
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(say).toHaveBeenCalledWith("#rukalun", "二回目D！");
  });
});
