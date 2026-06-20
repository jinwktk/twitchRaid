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
CHAT_AI_MAX_RESPONSE_CHARS=120
CHAT_AI_BOT_ALIASES=＠RukalunBot,@Rukalun
CHAT_AI_COOLDOWN_SECONDS=30
CHAT_AI_IGNORED_USERS=＠RukalunBot,nightbot
CHAT_AI_STREAM_IMAGE_ENABLED=true
CHAT_AI_VISION_MODEL=qwen2.5vl:7b
CHAT_AI_MEMORY_ENABLED=true
CHAT_AI_MEMORY_PATH=data/custom-chat-ai-memory.json
CHAT_AI_MEMORY_MAX_ITEMS=12
CHAT_AI_MEMORY_MAX_CHARS=900
CHAT_AI_MEMORY_WRITER_USERS=＠Rukalun,nyme_ia
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
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(true);
    expect(config.chatAiBaseUrl).toBe("http://127.0.0.1:11435");
    expect(config.chatAiModel).toBe("qwen2.5:7b");
    expect(config.chatAiTimeoutMs).toBe(4500);
    expect(config.chatAiTimeoutFallbackReply).toBe("AIが混み合ってるD！");
    expect(config.chatAiKeepAlive).toBe("10m");
    expect(config.chatAiMaxResponseChars).toBe(120);
    expect(config.chatAiBotAliases).toEqual(["rukalunbot", "rukalun"]);
    expect(config.chatAiCooldownSeconds).toBe(30);
    expect(config.chatAiIgnoredUsers).toEqual(["rukalunbot", "nightbot"]);
    expect(config.chatAiStreamImageEnabled).toBe(true);
    expect(config.chatAiVisionModel).toBe("qwen2.5vl:7b");
    expect(config.chatAiMemoryEnabled).toBe(true);
    expect(config.chatAiMemoryPath).toBe(
      path.resolve("data/custom-chat-ai-memory.json")
    );
    expect(config.chatAiMemoryMaxItems).toBe(12);
    expect(config.chatAiMemoryMaxChars).toBe(900);
    expect(config.chatAiMemoryWriterUsers).toEqual(["rukalun", "nyme_ia"]);
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
    expect(config.chatAiMaxResponseChars).toBe(200);
    expect(config.chatAiBotAliases).toEqual(["にめいやボットくん", "nyme_ia2"]);
    expect(config.chatAiCooldownSeconds).toBe(5);
    expect(config.chatAiIgnoredUsers).toEqual(["nyme_ia2"]);
    expect(config.chatAiStreamImageEnabled).toBe(false);
    expect(config.chatAiVisionModel).toBe("qwen2.5:7b");
    expect(config.chatAiMemoryEnabled).toBe(false);
    expect(config.chatAiMemoryPath).toBe(
      path.resolve("data/chat-ai-memory.json")
    );
    expect(config.chatAiMemoryMaxItems).toBe(8);
    expect(config.chatAiMemoryMaxChars).toBe(600);
    expect(config.chatAiMemoryWriterUsers).toEqual(["rukalun"]);
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
