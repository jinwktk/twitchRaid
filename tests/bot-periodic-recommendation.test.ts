import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config";
import { Bot } from "../src/bot";
import logger from "../src/utils/logger";
import {
  buildBotRequestNotesDigest,
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
    botRequestNotesDigestFilePath: path.join(
      tmpDir,
      "bot-request-notes-digest.md"
    ),
    botRequestNotesDigestDiscordEnabled: false,
    chatAiEnabled: false,
    chatAiBaseUrl: "http://127.0.0.1:11434",
    chatAiModel: "",
    chatAiTimeoutMs: 8000,
    chatAiTimeoutFallbackReply: "今ちょっとAIが混み合ってるD！",
    chatAiKeepAlive: "30m",
    chatAiPrewarmEnabled: false,
    chatAiPrewarmPrimeEnabled: false,
    chatAiPrewarmIntervalSeconds: 600,
    chatAiPrewarmTimeoutMs: 90_000,
    chatAiMem0EmbedPrewarmEnabled: false,
    chatAiMem0EmbedModel: "",
    chatAiMem0SearchPrewarmEnabled: false,
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
    });
    const body = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("options");

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(90 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(say).not.toHaveBeenCalled();
  });

  it("runs startup-only prime and mem0 search in strict order while keeping intervals lightweight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T14:20:00.000Z"));
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmIntervalSeconds: 600,
      chatAiPrewarmTimeoutMs: 90_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiMem0ApiKey: "test-key",
      chatAiMem0UserId: "rukalun",
      chatAiMem0AgentId: "twitchRaid",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
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
    let resolveStartupGenerate!: (response: Response) => void;
    const startupGenerate = new Promise<Response>((resolve) => {
      resolveStartupGenerate = resolve;
    });
    let resolvePrimeGenerate!: (response: Response) => void;
    const primeGenerate = new Promise<Response>((resolve) => {
      resolvePrimeGenerate = resolve;
    });
    let generateCalls = 0;
    let resolvePrimeStarted!: () => void;
    const primeStarted = new Promise<void>((resolve) => {
      resolvePrimeStarted = resolve;
    });
    let resolveEmbedStarted!: () => void;
    const embedStarted = new Promise<void>((resolve) => {
      resolveEmbedStarted = resolve;
    });
    let resolveMem0Started!: () => void;
    const mem0Started = new Promise<void>((resolve) => {
      resolveMem0Started = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (String(input).endsWith("/api/embed")) {
          resolveEmbedStarted();
          return new Response(JSON.stringify({ embeddings: [[0.1]] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (String(input) === "http://mem0:8888/search") {
          resolveMem0Started();
          return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        generateCalls += 1;
        if (generateCalls === 1) return startupGenerate;
        if (generateCalls === 2) {
          resolvePrimeStarted();
          return primeGenerate;
        }
        return new Response(JSON.stringify({ response: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    bot._startKeepAlive();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "http://ollama:11434/api/generate"
    );

    resolveStartupGenerate(
      new Response(JSON.stringify({ response: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await primeStarted;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1]?.[0])).toBe(
      "http://ollama:11434/api/generate"
    );
    const primeBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
    expect(primeBody).toMatchObject({
      model: "qwen3.5:9b",
      stream: false,
      think: false,
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_predict: 1,
        num_ctx: 4096,
      },
    });
    expect(primeBody.system).toContain("るっかるん本人");
    expect(primeBody.prompt).toContain("チャンネル: #prewarm");
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "http://ollama:11434/api/embed",
      expect.anything()
    );

    resolvePrimeGenerate(
      new Response(JSON.stringify({ response: "D" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await embedStarted;
    await mem0Started;

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(String(fetchSpy.mock.calls[2]?.[0])).toBe(
      "http://ollama:11434/api/embed"
    );
    expect(JSON.parse(fetchSpy.mock.calls[2]?.[1]?.body as string)).toEqual({
      model: "nomic-embed-text",
      input: "warmup",
    });
    expect(String(fetchSpy.mock.calls[3]?.[0])).toBe(
      "http://mem0:8888/search"
    );
    expect(fetchSpy.mock.calls[3]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-API-Key": "test-key",
    });
    expect(JSON.parse(fetchSpy.mock.calls[3]?.[1]?.body as string)).toEqual({
      query: "好きな食べ物なんだっけ？",
      filters: {
        user_id: "rukalun",
        agent_id: "twitchRaid",
      },
      top_k: 1,
      threshold: 1,
    });

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(90 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    expect(String(fetchSpy.mock.calls[4]?.[0])).toBe(
      "http://ollama:11434/api/generate"
    );
    expect(JSON.parse(fetchSpy.mock.calls[4]?.[1]?.body as string)).not.toHaveProperty(
      "prompt"
    );
    expect(String(fetchSpy.mock.calls[5]?.[0])).toBe(
      "http://ollama:11434/api/embed"
    );
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) => String(input) === "http://mem0:8888/search"
      )
    ).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.filter(([input, init]) => {
        if (!String(input).endsWith("/api/generate")) return false;
        const body = JSON.parse(init?.body as string);
        return typeof body.prompt === "string";
      })
    ).toHaveLength(1);
    expect(say).not.toHaveBeenCalled();
  });

  it("attempts startup-only prime and mem0 search only once across reconnects", async () => {
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmTimeoutMs: 180_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiMem0ApiKey: "test-key",
      chatAiMem0UserId: "rukalun",
      chatAiMem0AgentId: "twitchRaid",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _prewarmChatAiModel: (trigger: "startup" | "interval") => Promise<void>;
    };
    activeBot = bot;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input) === "http://mem0:8888/search") {
          return new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const body = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify(
            String(input).endsWith("/api/embed")
              ? { embeddings: [[0.1]] }
              : { response: body.prompt ? "D" : "" }
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      });

    await bot._prewarmChatAiModel("startup");
    await bot._prewarmChatAiModel("startup");

    const generateBodies = fetchSpy.mock.calls
      .filter(([input]) => String(input).endsWith("/api/generate"))
      .map(([, init]) => JSON.parse(init?.body as string));
    expect(generateBodies.filter((body) => body.prompt)).toHaveLength(1);
    expect(generateBodies.filter((body) => !body.prompt)).toHaveLength(2);
    expect(
      fetchSpy.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/embed")
      )
    ).toHaveLength(2);
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) => String(input) === "http://mem0:8888/search"
      )
    ).toHaveLength(1);
  });

  it("never calls direct Ollama prewarm after AnythingLLM read cutover", async () => {
    const base = makeConfig();
    const config = {
      ...base,
      chatAiEnabled: true,
      chatAiAnythingLlmEnabled: true,
      anythingLlmCommentWriteEnabled: true,
      anythingLlmBaseUrl: "http://anythingllm:3001",
      anythingLlmApiKeyFile: path.join(tmpDir ?? "", "anythingllm.key"),
      anythingLlmWorkspaceName: "Twitch rukalun",
      anythingLlmWorkspaceSlug: "twitch-rukalun",
      anythingLlmSessionId: "twitchraid-channel-test-v1",
      anythingLlmUtilityWorkspaceName: "Twitch rukalun utility",
      anythingLlmUtilityWorkspaceSlug: "twitch-rukalun-utility",
      anythingLlmUtilitySessionId: "twitchraid-utility-test-v1",
      anythingLlmTimeoutMs: 3_000,
      anythingLlmLedgerDbPath: path.join(
        tmpDir ?? "",
        "anythingllm-ledger.sqlite"
      ),
      anythingLlmBatchMaxComments: 200,
      anythingLlmQueueHighWaterComments: 5_000,
      anythingLlmDiskMinFreeBytes: 0,
      anythingLlmCleanupIntervalSeconds: 3_600,
      anythingLlmRawRetentionDays: 365,
      anythingLlmStreamKnowledgeEnabled: false,
      anythingLlmStreamKnowledgeDbPath: path.join(
        tmpDir ?? "",
        "anythingllm-stream-knowledge.sqlite"
      ),
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0SearchPrewarmEnabled: true,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      anythingLlmChannelMemory: { close: () => Promise<void> } | null;
      anythingLlmLedger: { close: () => void } | null;
      _prewarmChatAiModel: (
        trigger: "startup" | "interval"
      ) => Promise<void>;
    };
    activeBot = bot;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await bot._prewarmChatAiModel("startup");

    expect(fetchSpy).not.toHaveBeenCalled();
    await bot.anythingLlmChannelMemory?.close();
    bot.anythingLlmLedger?.close();
  });

  it("does not start prime or embedding when the generation preload fails", async () => {
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmTimeoutMs: 180_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _prewarmChatAiModel: (trigger: "startup" | "interval") => Promise<void>;
    };
    activeBot = bot;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("preload failed", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );

    await bot._prewarmChatAiModel("startup");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "http://ollama:11434/api/generate"
    );
    expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).not.toHaveProperty(
      "prompt"
    );
  });

  it("does not start embedding or mem0 search when the startup prime returns HTTP 500", async () => {
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmTimeoutMs: 180_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _prewarmChatAiModel: (trigger: "startup" | "interval") => Promise<void>;
    };
    activeBot = bot;
    let generateCalls = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        generateCalls += 1;
        if (generateCalls === 2) {
          return new Response("prime failed", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response(JSON.stringify({ response: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    await bot._prewarmChatAiModel("startup");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string)).toHaveProperty(
      "prompt"
    );
  });

  it("does not start mem0 search when the embedding prewarm fails", async () => {
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmTimeoutMs: 180_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      clipCacheStore: { close: () => void };
      _prewarmChatAiModel: (trigger: "startup" | "interval") => Promise<void>;
    };
    activeBot = bot;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input).endsWith("/api/embed")) {
          return new Response("embed failed", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        }
        const body = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ response: body.prompt ? "D" : "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    await bot._prewarmChatAiModel("startup");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) => String(input) === "http://mem0:8888/search"
      )
    ).toHaveLength(0);
  });

  it("fails open without leaking secrets when the startup mem0 search returns HTTP 500", async () => {
    const config = {
      ...makeConfig(),
      chatAiEnabled: true,
      chatAiBaseUrl: "http://ollama:11434",
      chatAiModel: "qwen3.5:9b",
      chatAiKeepAlive: "30m",
      chatAiPrewarmEnabled: true,
      chatAiPrewarmPrimeEnabled: true,
      chatAiPrewarmTimeoutMs: 180_000,
      chatAiMem0EmbedPrewarmEnabled: true,
      chatAiMem0EmbedModel: "nomic-embed-text",
      chatAiMem0SearchPrewarmEnabled: true,
      chatAiMemoryEnabled: true,
      chatAiMem0Enabled: true,
      chatAiMem0Endpoint: "http://mem0:8888",
      chatAiMem0ApiKey: "startup-secret-key",
      chatAiMem0UserId: "rukalun",
      chatAiMem0AgentId: "twitchRaid",
      chatAiContextLength: 4096,
      chatAiMaxResponseChars: 500,
    } as Config;
    const bot = new Bot(config) as unknown as Bot & {
      chatClient: { say: ReturnType<typeof vi.fn> };
      clipCacheStore: { close: () => void };
      _prewarmChatAiModel: (trigger: "startup" | "interval") => Promise<void>;
    };
    activeBot = bot;
    const say = vi.fn();
    bot.chatClient = { say };
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input) === "http://mem0:8888/search") {
          expect(init?.headers).toMatchObject({
            "X-API-Key": "startup-secret-key",
          });
          return new Response("startup-secret-response-body", {
            status: 500,
            headers: { "content-type": "text/plain" },
          });
        }
        if (String(input).endsWith("/api/embed")) {
          return new Response(JSON.stringify({ embeddings: [[0.1]] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const body = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ response: body.prompt ? "D" : "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    await expect(bot._prewarmChatAiModel("startup")).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(say).not.toHaveBeenCalled();
    const logs = [...infoSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(logs).toContain("AIメンション会話mem0検索prewarm失敗");
    expect(logs).not.toContain("startup-secret-key");
    expect(logs).not.toContain("startup-secret-response-body");
  });

  it("writes a bot request note digest file by default without posting to Discord", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordBotToken: "bot-token",
      discordSummaryChannelId: "summary-channel",
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected Discord fetch"));

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    const digestFile = fs.readFileSync(
      config.botRequestNotesDigestFilePath,
      "utf8"
    );
    expect(digestFile).toContain("# Bot要望メモ未対応");
    expect(digestFile).toContain("BotでRaid挨拶を再生成できるようにしてほしい");

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts a bot request note digest through Discord when explicitly enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestDiscordEnabled: true,
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
    expect(fs.existsSync(config.botRequestNotesDigestFilePath)).toBe(true);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a bot request note digest unsent when Discord is enabled without a destination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestDiscordEnabled: true,
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
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(config.botRequestNotesDigestFilePath)).toBe(true);
    expect(
      buildBotRequestNotesDigest({
        enabled: true,
        dbPath: config.botRequestNotesDbPath,
        intervalHours: 168,
        maxItems: 10,
        now: () => "2026-07-05T00:00:45.000Z",
      }).shouldSend
    ).toBe(true);
  });

  it("falls back to webhook when bot request note digest bot API posting fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordBotToken: "bot-token",
      discordSummaryChannelId: "summary-channel",
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestDiscordEnabled: true,
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://discord.com/api/v10/channels/summary-channel/messages"
    );
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://discord.com/api/webhooks/123/token"
    );
    expect(JSON.parse(fetchSpy.mock.calls[1][1]?.body as string)).toMatchObject({
      content: expect.stringContaining("Bot要望メモ未対応"),
    });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries bot request note digest when bot API and webhook posting both fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordWebhookUrl: "https://discord.com/api/webhooks/123/token",
      discordBotToken: "bot-token",
      discordSummaryChannelId: "summary-channel",
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestDiscordEnabled: true,
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 500,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 500,
          headers: { "content-type": "application/json" },
        })
      );

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://discord.com/api/v10/channels/summary-channel/messages"
    );
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://discord.com/api/webhooks/123/token"
    );

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy.mock.calls[2][0]).toBe(
      "https://discord.com/api/v10/channels/summary-channel/messages"
    );
    expect(fetchSpy.mock.calls[3][0]).toBe(
      "https://discord.com/api/webhooks/123/token"
    );
  });

  it("retries bot request note digest when bot API posting fails without a webhook", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const config = {
      ...makeConfig(),
      discordBotToken: "bot-token",
      discordSummaryChannelId: "summary-channel",
      botRequestNotesEnabled: true,
      botRequestNotesDigestEnabled: true,
      botRequestNotesDigestDiscordEnabled: true,
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
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );

    bot._startKeepAlive();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://discord.com/api/v10/channels/summary-channel/messages"
    );

    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://discord.com/api/v10/channels/summary-channel/messages"
    );
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
