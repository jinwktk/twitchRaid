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
`);

    const config = new Config(envPath);

    expect(config.chatAiEnabled).toBe(true);
    expect(config.chatAiBaseUrl).toBe("http://127.0.0.1:11435");
    expect(config.chatAiModel).toBe("qwen2.5:7b");
    expect(config.chatAiTimeoutMs).toBe(4500);
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
