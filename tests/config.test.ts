import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../src/config";

let tempDir: string | null = null;

function writeEnvFile(contents: string): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-config-"));
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, contents, "utf8");
  return envPath;
}

describe("Config", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("falls back to process.env when an env file is not available", () => {
    const keys = [
      "TWITCH_CLIENT_ID",
      "TWITCH_ACCESS_TOKEN",
      "TWITCH_REFRESH_TOKEN",
      "TWITCH_SECRET_TOKEN",
      "TWITCH_BROADCASTER_ID",
      "TWITCH_MODERATOR_ID",
      "OLLAMA_BASE_URL",
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));

    try {
      process.env.TWITCH_CLIENT_ID = "process-client";
      process.env.TWITCH_ACCESS_TOKEN = "process-access";
      process.env.TWITCH_REFRESH_TOKEN = "process-refresh";
      process.env.TWITCH_SECRET_TOKEN = "process-secret";
      process.env.TWITCH_BROADCASTER_ID = "process-broadcaster";
      process.env.TWITCH_MODERATOR_ID = "process-moderator";
      process.env.OLLAMA_BASE_URL = "http://192.168.0.99:11434";

      const config = new Config(path.join(os.tmpdir(), "missing-dokploy.env"));

      expect(config.twitchClientId).toBe("process-client");
      expect(config.twitchAccessToken).toBe("process-access");
      expect(config.twitchRefreshToken).toBe("process-refresh");
      expect(config.twitchSecretToken).toBe("process-secret");
      expect(config.twitchBroadcasterId).toBe("process-broadcaster");
      expect(config.twitchModeratorId).toBe("process-moderator");
      expect(config.ollamaBaseUrl).toBe("http://192.168.0.99:11434");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("restores a Dokploy environment block packed into TWITCH_CLIENT_ID", () => {
    const keys = [
      "TWITCH_CLIENT_ID",
      "TWITCH_ACCESS_TOKEN",
      "TWITCH_REFRESH_TOKEN",
      "TWITCH_SECRET_TOKEN",
      "TWITCH_BROADCASTER_ID",
      "TWITCH_MODERATOR_ID",
      "TWITCH_RUNTIME_ENV_FILE",
      "MANGA_COMMAND_ENABLED",
      "MANGA_ADMIN_USERS",
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));

    try {
      for (const key of keys) delete process.env[key];
      process.env.TWITCH_CLIENT_ID = [
        "packed-client",
        "TWITCH_ACCESS_TOKEN=packed-access",
        "TWITCH_REFRESH_TOKEN=packed-refresh",
        "TWITCH_SECRET_TOKEN=packed-secret",
        "TWITCH_BROADCASTER_ID=packed-broadcaster",
        "TWITCH_MODERATOR_ID=packed-moderator",
        "MANGA_COMMAND_ENABLED=true",
        "MANGA_ADMIN_USERS=rukalun,nyme_ia",
      ].join("\\n");

      const config = new Config(path.join(os.tmpdir(), "missing-packed.env"));

      expect(config.twitchClientId).toBe("packed-client");
      expect(config.twitchAccessToken).toBe("packed-access");
      expect(config.twitchRefreshToken).toBe("packed-refresh");
      expect(config.twitchSecretToken).toBe("packed-secret");
      expect(config.twitchBroadcasterId).toBe("packed-broadcaster");
      expect(config.twitchModeratorId).toBe("packed-moderator");
      expect(config.mangaCommandEnabled).toBe(true);
      expect(config.mangaAdminUsers).toEqual(["rukalun", "nyme_ia"]);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("loads mutable runtime tokens ahead of process.env and writes updates there", () => {
    const runtimeEnvPath = writeEnvFile(`
TWITCH_ACCESS_TOKEN=persisted-access
TWITCH_REFRESH_TOKEN=persisted-refresh
`);
    const keys = [
      "TWITCH_CLIENT_ID",
      "TWITCH_ACCESS_TOKEN",
      "TWITCH_REFRESH_TOKEN",
      "TWITCH_SECRET_TOKEN",
      "TWITCH_BROADCASTER_ID",
      "TWITCH_MODERATOR_ID",
      "TWITCH_RUNTIME_ENV_FILE",
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));

    try {
      process.env.TWITCH_CLIENT_ID = "process-client";
      process.env.TWITCH_ACCESS_TOKEN = "stale-access";
      process.env.TWITCH_REFRESH_TOKEN = "stale-refresh";
      process.env.TWITCH_SECRET_TOKEN = "process-secret";
      process.env.TWITCH_BROADCASTER_ID = "process-broadcaster";
      process.env.TWITCH_MODERATOR_ID = "process-moderator";
      process.env.TWITCH_RUNTIME_ENV_FILE = runtimeEnvPath;

      const missingEnvPath = path.join(path.dirname(runtimeEnvPath), "missing.env");
      const config = new Config(missingEnvPath);

      expect(config.twitchAccessToken).toBe("persisted-access");
      expect(config.twitchRefreshToken).toBe("persisted-refresh");
      expect(config.envFile).toBe(runtimeEnvPath);

      config.updateAccessToken("new-access", "new-refresh");
      const content = fs.readFileSync(runtimeEnvPath, "utf8");
      expect(content).toContain("TWITCH_ACCESS_TOKEN=new-access");
      expect(content).toContain("TWITCH_REFRESH_TOKEN=new-refresh");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("can disable the internal Git updater for Dokploy deployments", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
GIT_AUTO_UPDATE_ENABLED=false
`);

    const config = new Config(envPath);

    expect(config.gitAutoUpdateEnabled).toBe(false);
  });

  it("keeps the internal Git updater enabled by default", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
`);

    const config = new Config(envPath);

    expect(config.gitAutoUpdateEnabled).toBe(true);
  });

  it("loads clip search auto-publish settings for GitHub Pages JSON updates", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true
CLIP_SEARCH_DATA_PATH=public/clip-search-data.json
CLIP_SEARCH_PUBLISH_REPO_DIR=../RukalunPage
CLIP_SEARCH_PUBLISH_MIN_INTERVAL_MS=120000
CLIP_SEARCH_PUBLISH_REMOTE=origin
CLIP_SEARCH_PUBLISH_BRANCH=main
CLIP_SEARCH_PUBLISH_GITHUB_TOKEN=token-123
CLIP_SEARCH_PUBLISH_GITHUB_USERNAME=clip-bot
TWITCH_CLIP_RECENT_WINDOW_MINUTES=720
`);

    const config = new Config(envPath);

    expect(config.clipSearchAutoPublishEnabled).toBe(true);
    expect(config.clipSearchDataPath).toBe(
      path.resolve("public", "clip-search-data.json")
    );
    expect(config.clipSearchPublishRepoDir).toBe(
      path.resolve("..", "RukalunPage")
    );
    expect(config.clipSearchPublishMinIntervalMs).toBe(120_000);
    expect(config.clipSearchPublishRemote).toBe("origin");
    expect(config.clipSearchPublishBranch).toBe("main");
    expect(config.clipSearchPublishGithubToken).toBe("token-123");
    expect(config.clipSearchPublishGithubUsername).toBe("clip-bot");
    expect(config.clipRecentWindowMinutes).toBe(720);
  });

  it("defaults clip search publishing to the sibling RukalunPage repository", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
`);

    const config = new Config(envPath);
    const publishRepoDir = path.resolve("..", "RukalunPage");

    expect(config.clipSearchPublishRepoDir).toBe(publishRepoDir);
    expect(config.clipSearchDataPath).toBe(
      path.join(publishRepoDir, "clip-search-data.json")
    );
  });

  it("loads chat recommendation settings", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_RECOMMENDATION_ENABLED=false
CHAT_RECOMMENDATION_INTERVAL_MINUTES=45
`);

    const config = new Config(envPath);

    expect(config.chatRecommendationEnabled).toBe(false);
    expect(config.chatRecommendationIntervalMinutes).toBe(45);
  });

  it("enables chat recommendations every 60 minutes by default", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
`);

    const config = new Config(envPath);

    expect(config.chatRecommendationEnabled).toBe(true);
    expect(config.chatRecommendationIntervalMinutes).toBe(60);
  });

  it("loads chat AI mention settings", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_AI_ENABLED=true
CHAT_AI_BASE_URL=http://127.0.0.1:11435
CHAT_AI_MODEL=qwen2.5:7b
CHAT_AI_TIMEOUT_MS=4500
CHAT_AI_TIMEOUT_FALLBACK_REPLY=AIが混み合ってるD！
CHAT_AI_KEEP_ALIVE=10m
CHAT_AI_CONTEXT_LENGTH=2048
CHAT_AI_PREWARM_ENABLED=true
CHAT_AI_PREWARM_PRIME_ENABLED=true
CHAT_AI_PREWARM_INTERVAL_SECONDS=300
CHAT_AI_PREWARM_TIMEOUT_MS=90000
CHAT_AI_MAX_RESPONSE_CHARS=120
CHAT_AI_CONVERSATION_HISTORY_ENABLED=false
CHAT_AI_CONVERSATION_HISTORY_MAX_MESSAGES=4
CHAT_AI_CONVERSATION_HISTORY_MAX_CHARS=320
CHAT_AI_CONVERSATION_HISTORY_TTL_SECONDS=900
CHAT_AI_COMMENT_MEMORY_ENABLED=true
CHAT_AI_COMMENT_MEMORY_MAX_ENTRIES_PER_MESSAGE=3
CHAT_AI_COMMENT_MEMORY_DEDUP_TTL_SECONDS=120
CHAT_AI_BOT_ALIASES=＠RukalunBot,@Rukalun
CHAT_AI_COOLDOWN_SECONDS=30
CHAT_AI_IGNORED_USERS=＠RukalunBot,nightbot
CHAT_AI_STREAM_IMAGE_ENABLED=true
CHAT_AI_VISION_MODEL=qwen2.5vl:7b
CHAT_AI_MEMORY_ENABLED=true
CHAT_AI_MEMORY_STORE=sqlite
CHAT_AI_MEMORY_PATH=data/custom-chat-ai-memory.json
CHAT_AI_MEMORY_DB_PATH=data/custom-chat-ai-memory.sqlite
CHAT_AI_MEMORY_MAX_ITEMS=12
CHAT_AI_MEMORY_MAX_CHARS=900
CHAT_AI_MEMORY_PROMOTION_MIN_OBSERVATIONS=3
CHAT_AI_MEMORY_WRITER_USERS=＠Rukalun,nyme_ia
CHAT_AI_MEMORY_RELEVANCE_FILTER_ENABLED=false
CHAT_AI_IMPLICIT_MEMORY_ENABLED=true
CHAT_AI_MEM0_ENABLED=true
CHAT_AI_MEM0_ENDPOINT=http://mem0:8888
CHAT_AI_MEM0_API_KEY=mem0-key
CHAT_AI_MEM0_USER_ID=rukalun
CHAT_AI_MEM0_AGENT_ID=twitchRaid
CHAT_AI_MEM0_APP_ID=chat
CHAT_AI_MEM0_TIMEOUT_MS=1700
CHAT_AI_MEM0_MAX_RESULTS=4
CHAT_AI_MEM0_MAX_CHARS=700
CHAT_AI_MEM0_MIN_SCORE=0.72
CHAT_AI_MEM0_RECALL_GATE_ENABLED=false
CHAT_AI_MEM0_ALLOW_MISSING_SCORE=true
CHAT_AI_MEM0_EMBED_PREWARM_ENABLED=true
CHAT_AI_MEM0_EMBED_MODEL=nomic-embed-text
CHAT_AI_MEM0_SEARCH_PREWARM_ENABLED=true
CHAT_AI_MEMORY_HUB_ENABLED=true
CHAT_AI_MEMORY_HUB_URL=http://127.0.0.1:3218
CHAT_AI_MEMORY_HUB_NAMESPACE=rukalun
CHAT_AI_MEMORY_HUB_TIMEOUT_MS=1400
CHAT_AI_SEARCH_ENABLED=true
CHAT_AI_SEARCH_PROVIDER=searxng
CHAT_AI_SEARCH_ENDPOINT=https://search.example.test/
CHAT_AI_SEARCH_ENGINES=google
CHAT_AI_SEARCH_TIMEOUT_MS=1500
CHAT_AI_SEARCH_MAX_QUERY_CHARS=90
CHAT_AI_SEARCH_MAX_RESPONSE_BYTES=32768
CHAT_AI_SEARCH_MAX_RESULTS=2
CHAT_AI_AUTO_LEARN_ENABLED=true
CHAT_AI_AUTO_LEARN_MAX_KEY_CHARS=24
CHAT_AI_AUTO_LEARN_MAX_VALUE_CHARS=80
CHAT_AI_AUTO_LEARN_MAX_ITEMS=30
CHAT_AI_PROMPT_REPLY_LOG_ENABLED=true
CHAT_REPLY_EMOTES= rukkaHi, @rukkaGG, ＠rukkaHi, RukkaNice
BOT_REQUEST_NOTES_ENABLED=true
BOT_REQUEST_NOTES_DB_PATH=data/custom-bot-request-notes.sqlite
BOT_REQUEST_NOTES_DIGEST_ENABLED=true
BOT_REQUEST_NOTES_DIGEST_INTERVAL_HOURS=24
BOT_REQUEST_NOTES_DIGEST_MAX_ITEMS=5
BOT_REQUEST_NOTES_DISCORD_CHANNEL_ID=bot-request-channel
BOT_REQUEST_NOTES_DIGEST_FILE_PATH=data/custom-bot-request-notes-digest.md
BOT_REQUEST_NOTES_DIGEST_DISCORD_ENABLED=true
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(true);
    expect(config.chatAiBaseUrl).toBe("http://127.0.0.1:11435");
    expect(config.chatAiModel).toBe("qwen2.5:7b");
    expect(config.chatAiTimeoutMs).toBe(4500);
    expect(config.chatAiTimeoutFallbackReply).toBe("AIが混み合ってるD！");
    expect(config.chatAiKeepAlive).toBe("10m");
    expect(config.chatAiContextLength).toBe(2048);
    expect(config.chatAiPrewarmEnabled).toBe(true);
    expect(config.chatAiPrewarmPrimeEnabled).toBe(true);
    expect(config.chatAiPrewarmIntervalSeconds).toBe(300);
    expect(config.chatAiPrewarmTimeoutMs).toBe(90000);
    expect(config.chatAiMaxResponseChars).toBe(120);
    expect(config.chatAiConversationHistoryEnabled).toBe(false);
    expect(config.chatAiConversationHistoryMaxMessages).toBe(4);
    expect(config.chatAiConversationHistoryMaxChars).toBe(320);
    expect(config.chatAiConversationHistoryTtlSeconds).toBe(900);
    expect(config.chatAiCommentMemoryEnabled).toBe(true);
    expect(config.chatAiCommentMemoryMaxEntriesPerMessage).toBe(3);
    expect(config.chatAiCommentMemoryDedupTtlSeconds).toBe(120);
    expect(config.chatAiBotAliases).toEqual(["rukalunbot", "rukalun"]);
    expect(config.chatAiCooldownSeconds).toBe(30);
    expect(config.chatAiIgnoredUsers).toEqual(["rukalunbot", "nightbot"]);
    expect(config.chatAiStreamImageEnabled).toBe(true);
    expect(config.chatAiVisionModel).toBe("qwen2.5vl:7b");
    expect(config.chatAiMemoryEnabled).toBe(true);
    expect(config.chatAiMemoryStore).toBe("sqlite");
    expect(config.chatAiMemoryPath).toBe(
      path.resolve("data/custom-chat-ai-memory.json")
    );
    expect(config.chatAiMemoryDbPath).toBe(
      path.resolve("data/custom-chat-ai-memory.sqlite")
    );
    expect(config.chatAiMemoryMaxItems).toBe(12);
    expect(config.chatAiMemoryMaxChars).toBe(900);
    expect(config.chatAiMemoryPromotionMinObservations).toBe(3);
    expect(config.chatAiMemoryWriterUsers).toEqual(["rukalun", "nyme_ia"]);
    expect(config.chatAiMemoryRelevanceFilterEnabled).toBe(false);
    expect(config.chatAiImplicitMemoryEnabled).toBe(true);
    expect(config.chatAiMem0Enabled).toBe(true);
    expect(config.chatAiMem0Endpoint).toBe("http://mem0:8888");
    expect(config.chatAiMem0ApiKey).toBe("mem0-key");
    expect(config.chatAiMem0UserId).toBe("rukalun");
    expect(config.chatAiMem0AgentId).toBe("twitchRaid");
    expect(config.chatAiMem0AppId).toBe("chat");
    expect(config.chatAiMem0TimeoutMs).toBe(1700);
    expect(config.chatAiMem0MaxResults).toBe(4);
    expect(config.chatAiMem0MaxChars).toBe(700);
    expect(config.chatAiMem0MinScore).toBe(0.72);
    expect(config.chatAiMem0RecallGateEnabled).toBe(false);
    expect(config.chatAiMem0AllowMissingScore).toBe(true);
    expect(config.chatAiMem0EmbedPrewarmEnabled).toBe(true);
    expect(config.chatAiMem0EmbedModel).toBe("nomic-embed-text");
    expect(config.chatAiMem0SearchPrewarmEnabled).toBe(true);
    expect(config).not.toHaveProperty("chatAiMemoryHubEnabled");
    expect(config).not.toHaveProperty("chatAiMemoryHubUrl");
    expect(config).not.toHaveProperty("chatAiMemoryHubNamespace");
    expect(config).not.toHaveProperty("chatAiMemoryHubTimeoutMs");
    expect(config.chatAiSearchEnabled).toBe(true);
    expect(config.chatAiSearchProvider).toBe("searxng");
    expect(config.chatAiSearchEndpoint).toBe("https://search.example.test/");
    expect(config.chatAiSearchEngines).toBe("google");
    expect(config.chatAiSearchTimeoutMs).toBe(1500);
    expect(config.chatAiSearchMaxQueryChars).toBe(90);
    expect(config.chatAiSearchMaxResponseBytes).toBe(32768);
    expect(config.chatAiSearchMaxResults).toBe(2);
    expect(config.chatAiAutoLearnEnabled).toBe(true);
    expect(config.chatAiAutoLearnMaxKeyChars).toBe(24);
    expect(config.chatAiAutoLearnMaxValueChars).toBe(80);
    expect(config.chatAiAutoLearnMaxItems).toBe(30);
    expect(config.chatAiPromptReplyLogEnabled).toBe(true);
    expect(config.chatReplyEmotes).toEqual([
      "rukkaHi",
      "rukkaGG",
      "RukkaNice",
    ]);
    expect(config.botRequestNotesEnabled).toBe(true);
    expect(config.botRequestNotesDbPath).toBe(
      path.resolve("data/custom-bot-request-notes.sqlite")
    );
    expect(config.botRequestNotesDigestEnabled).toBe(true);
    expect(config.botRequestNotesDigestIntervalHours).toBe(24);
    expect(config.botRequestNotesDigestMaxItems).toBe(5);
    expect(config.botRequestNotesDiscordChannelId).toBe("bot-request-channel");
    expect(config.botRequestNotesDigestFilePath).toBe(
      path.resolve("data/custom-bot-request-notes-digest.md")
    );
    expect(config.botRequestNotesDigestDiscordEnabled).toBe(true);
  });

  it("keeps chat AI disabled by default", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
OLLAMA_MODEL=qwen2.5:7b
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(false);
    expect(config.chatAiBaseUrl).toBe("http://127.0.0.1:11434");
    expect(config.chatAiModel).toBe("qwen2.5:7b");
    expect(config.chatAiTimeoutMs).toBe(8000);
    expect(config.chatAiTimeoutFallbackReply).toBe(
      "今ちょっとAIが混み合ってるD！"
    );
    expect(config.chatAiKeepAlive).toBe("30m");
    expect(config.chatAiContextLength).toBe(4096);
    expect(config.chatAiPrewarmEnabled).toBe(false);
    expect(config.chatAiPrewarmPrimeEnabled).toBe(false);
    expect(config.chatAiPrewarmIntervalSeconds).toBe(600);
    expect(config.chatAiPrewarmTimeoutMs).toBe(180000);
    expect(config.chatAiMaxResponseChars).toBe(500);
    expect(config.chatAiConversationHistoryEnabled).toBe(true);
    expect(config.chatAiConversationHistoryMaxMessages).toBe(6);
    expect(config.chatAiConversationHistoryMaxChars).toBe(1000);
    expect(config.chatAiConversationHistoryTtlSeconds).toBe(1800);
    expect(config.chatAiCommentMemoryEnabled).toBe(false);
    expect(config.chatAiCommentMemoryMaxEntriesPerMessage).toBe(2);
    expect(config.chatAiCommentMemoryDedupTtlSeconds).toBe(21600);
    expect(config.botRequestNotesEnabled).toBe(false);
    expect(config.botRequestNotesDbPath).toBe(
      path.resolve("data/bot-request-notes.sqlite")
    );
    expect(config.botRequestNotesDigestEnabled).toBe(false);
    expect(config.botRequestNotesDigestIntervalHours).toBe(168);
    expect(config.botRequestNotesDigestMaxItems).toBe(10);
    expect(config.botRequestNotesDiscordChannelId).toBe("");
    expect(config.botRequestNotesDigestFilePath).toBe(
      path.resolve("data/bot-request-notes-digest.md")
    );
    expect(config.botRequestNotesDigestDiscordEnabled).toBe(false);
    expect(config.chatAiBotAliases).toEqual(["にめいやボットくん", "nyme_ia2"]);
    expect(config.chatAiCooldownSeconds).toBe(5);
    expect(config.chatAiIgnoredUsers).toEqual(["nyme_ia2"]);
    expect(config.chatAiStreamImageEnabled).toBe(false);
    expect(config.chatAiVisionModel).toBe("qwen2.5:7b");
    expect(config.chatAiMemoryEnabled).toBe(false);
    expect(config.chatAiMemoryStore).toBe("json");
    expect(config.chatAiMemoryPath).toBe(
      path.resolve("data/chat-ai-memory.json")
    );
    expect(config.chatAiMemoryDbPath).toBe(
      path.resolve("data/chat-ai-memory.sqlite")
    );
    expect(config.chatAiMemoryMaxItems).toBe(8);
    expect(config.chatAiMemoryMaxChars).toBe(600);
    expect(config.chatAiMemoryWriterUsers).toEqual(["rukalun"]);
    expect(config.chatAiMemoryRelevanceFilterEnabled).toBe(true);
    expect(config.chatAiImplicitMemoryEnabled).toBe(false);
    expect(config.chatAiMem0Enabled).toBe(false);
    expect(config.chatAiMem0Endpoint).toBe("");
    expect(config.chatAiMem0ApiKey).toBe("");
    expect(config.chatAiMem0UserId).toBe("rukalun");
    expect(config.chatAiMem0AgentId).toBe("twitchRaid");
    expect(config.chatAiMem0AppId).toBe("twitchRaid");
    expect(config.chatAiMem0TimeoutMs).toBe(1200);
    expect(config.chatAiMem0MaxResults).toBe(3);
    expect(config.chatAiMem0MaxChars).toBe(600);
    expect(config.chatAiMem0MinScore).toBe(0.5);
    expect(config.chatAiMem0RecallGateEnabled).toBe(true);
    expect(config.chatAiMem0AllowMissingScore).toBe(false);
    expect(config.chatAiMem0EmbedPrewarmEnabled).toBe(false);
    expect(config.chatAiMem0EmbedModel).toBe("");
    expect(config.chatAiMem0SearchPrewarmEnabled).toBe(false);
    expect(config).not.toHaveProperty("chatAiMemoryHubEnabled");
    expect(config).not.toHaveProperty("chatAiMemoryHubUrl");
    expect(config).not.toHaveProperty("chatAiMemoryHubNamespace");
    expect(config).not.toHaveProperty("chatAiMemoryHubTimeoutMs");
    expect(config.chatAiSearchEnabled).toBe(false);
    expect(config.chatAiSearchProvider).toBe("duckduckgo");
    expect(config.chatAiSearchEndpoint).toBe("https://api.duckduckgo.com/");
    expect(config.chatAiSearchEngines).toBe("");
    expect(config.chatAiSearchTimeoutMs).toBe(2500);
    expect(config.chatAiSearchMaxQueryChars).toBe(120);
    expect(config.chatAiSearchMaxResponseBytes).toBe(65536);
    expect(config.chatAiSearchMaxResults).toBe(3);
    expect(config.chatAiAutoLearnEnabled).toBe(false);
    expect(config.chatAiAutoLearnMaxKeyChars).toBe(40);
    expect(config.chatAiAutoLearnMaxValueChars).toBe(120);
    expect(config.chatAiAutoLearnMaxItems).toBe(50);
    expect(config.chatAiPromptReplyLogEnabled).toBe(false);
    expect(config.chatReplyEmotes).toEqual([]);
  });

  it.each(["511", "8193", "NaN"])(
    "falls back to context length 4096 when CHAT_AI_CONTEXT_LENGTH=%s",
    (rawContextLength) => {
      const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_AI_CONTEXT_LENGTH=${rawContextLength}
`);

      const config = new Config(envPath);

      expect(config.chatAiContextLength).toBe(4096);
    }
  );

  it.each(["-1", "1.1", "NaN"])(
    "falls back to mem0 score 0.5 when CHAT_AI_MEM0_MIN_SCORE=%s",
    (rawMinScore) => {
      const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_AI_MEM0_MIN_SCORE=${rawMinScore}
`);

      const config = new Config(envPath);

      expect(config.chatAiMem0MinScore).toBe(0.5);
    }
  );

  it.each([
    ["0", 0],
    ["1", 1],
  ])(
    "accepts CHAT_AI_MEM0_MIN_SCORE boundary %s",
    (rawMinScore, expected) => {
      const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_AI_MEM0_MIN_SCORE=${rawMinScore}
`);

      const config = new Config(envPath);

      expect(config.chatAiMem0MinScore).toBe(expected);
    }
  );

  it("falls back to shoutout Ollama settings for chat AI when chat AI toggle is unset", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
OLLAMA_SHOUTOUT_ENABLED=true
OLLAMA_SHOUTOUT_MODEL=qwen2.5:7b
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(true);
    expect(config.chatAiModel).toBe("qwen2.5:7b");
  });

  it("uses the chat AI model for raid shoutout Ollama when no explicit shoutout model is set", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
OLLAMA_SHOUTOUT_ENABLED=true
CHAT_AI_MODEL=qwen2.5:7b
OLLAMA_MODEL=qwen3.5:9b
`);

    const config = new Config(envPath);

    expect(config.chatAiModel).toBe("qwen2.5:7b");
    expect(config.ollamaShoutoutModel).toBe("qwen2.5:7b");
  });

  it("keeps chat AI disabled when explicitly disabled even if shoutout Ollama is enabled", () => {
    for (const disabledValue of ["false", "0"]) {
      const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CHAT_AI_ENABLED=${disabledValue}
OLLAMA_SHOUTOUT_ENABLED=true
OLLAMA_SHOUTOUT_MODEL=qwen2.5:7b
`);

      const config = new Config(envPath);

      expect(config.chatAiEnabled).toBe(false);
      expect(config.chatAiModel).toBe("qwen2.5:7b");
    }
  });

  it("does not enable chat AI from a shoutout model alone", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
OLLAMA_SHOUTOUT_ENABLED=false
OLLAMA_SHOUTOUT_MODEL=qwen2.5:7b
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(false);
    expect(config.chatAiModel).toBe("qwen2.5:7b");
  });

  it("does not enable chat AI from the shoutout toggle without an inherited model", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
OLLAMA_SHOUTOUT_ENABLED=true
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(false);
    expect(config.chatAiModel).toBe("");
  });
});
