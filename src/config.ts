import { config as dotenvConfig } from "dotenv";
import fs from "fs";
import path from "path";
import { updateEnvFile } from "./utils/env-store";
import { REQUIRED_AUTH_SCOPES } from "./auth/auth-scope-sets";
import { normalizeChatReplyEmotes } from "./chat/reply-emotes";

const BASE_DIR = path.resolve(__dirname, "..");
const DEFAULT_TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const DEFAULT_CLIP_RECENT_WINDOW_MINUTES = 6 * 60;
const DEFAULT_RUNTIME_ENV_FILE = path.resolve(BASE_DIR, "data/runtime.env");
const DEFAULT_CLIP_SEARCH_PUBLISH_REPO_DIR = path.resolve(
  BASE_DIR,
  "..",
  "RukalunPage"
);
const DEFAULT_CHAT_AI_TIMEOUT_MS = 8_000;
const DEFAULT_CHAT_AI_TIMEOUT_FALLBACK_REPLY =
  "今ちょっとAIが混み合ってるD！";
const DEFAULT_CHAT_AI_PREWARM_INTERVAL_SECONDS = 600;
const DEFAULT_CHAT_AI_PREWARM_TIMEOUT_MS = 90_000;
export const DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS = 500;
const DEFAULT_CHAT_AI_COOLDOWN_SECONDS = 5;
const DEFAULT_CHAT_AI_BOT_ALIASES = ["にめいやボットくん", "nyme_ia2"];
const DEFAULT_CHAT_AI_IGNORED_USERS = ["nyme_ia2"];
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_MESSAGES = 6;
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_CHARS = 1_000;
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_TTL_SECONDS = 1_800;
const DEFAULT_CHAT_AI_COMMENT_MEMORY_MAX_ENTRIES_PER_MESSAGE = 2;
const DEFAULT_CHAT_AI_COMMENT_MEMORY_DEDUP_TTL_SECONDS = 21_600;
const DEFAULT_CHAT_AI_MEMORY_MAX_ITEMS = 8;
const DEFAULT_CHAT_AI_MEMORY_MAX_CHARS = 600;
const DEFAULT_CHAT_AI_MEMORY_PROMOTION_MIN_OBSERVATIONS = 2;
const DEFAULT_CHAT_AI_MEM0_TIMEOUT_MS = 1_200;
const DEFAULT_CHAT_AI_MEM0_MAX_RESULTS = 3;
const DEFAULT_CHAT_AI_MEM0_MAX_CHARS = 600;
const DEFAULT_CHAT_AI_SEARCH_ENDPOINT = "https://api.duckduckgo.com/";
const DEFAULT_CHAT_AI_SEARCH_PROVIDER = "duckduckgo";
const DEFAULT_CHAT_AI_SEARCH_TIMEOUT_MS = 2_500;
const DEFAULT_CHAT_AI_SEARCH_MAX_QUERY_CHARS = 120;
const DEFAULT_CHAT_AI_SEARCH_MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_CHAT_AI_SEARCH_MAX_RESULTS = 3;
const DEFAULT_CHAT_AI_AUTO_LEARN_MAX_KEY_CHARS = 40;
const DEFAULT_CHAT_AI_AUTO_LEARN_MAX_VALUE_CHARS = 120;
const DEFAULT_CHAT_AI_AUTO_LEARN_MAX_ITEMS = 50;

type ChatAiSearchProvider = "duckduckgo" | "searxng";
type ChatAiMemoryStore = "json" | "sqlite";

function parseEnabledFlag(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseOptionalEnabledFlag(raw: string | undefined): boolean | null {
  if (raw === undefined || raw.trim() === "") return null;
  return parseEnabledFlag(raw);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toEnvFlag(enabled: boolean): string {
  return enabled ? "true" : "false";
}

function parseNameList(raw: string | undefined, fallback: string[]): string[] {
  const source = raw?.trim() ? raw : fallback.join(",");
  return source
    .split(",")
    .map((u) => u.trim().replace(/^[@＠]+/, "").toLowerCase())
    .filter(Boolean);
}

function parseChatAiSearchProvider(
  raw: string | undefined
): ChatAiSearchProvider {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "searxng"
    ? "searxng"
    : DEFAULT_CHAT_AI_SEARCH_PROVIDER;
}

function parseChatAiMemoryStore(raw: string | undefined): ChatAiMemoryStore {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "sqlite" ? "sqlite" : "json";
}

export class Config {
  readonly envFile: string;

  // Twitch設定
  readonly loginChannel: string;
  readonly commandPrefix: string;
  readonly twitchClientId: string;
  twitchAccessToken: string;
  twitchRefreshToken: string;
  readonly twitchSecretToken: string;
  readonly twitchBroadcasterId: string;
  readonly twitchModeratorId: string;
  readonly twitchGqlClientId: string;

  // Discord設定
  readonly discordWebhookUrl: string;
  readonly discordBotToken: string;
  readonly discordSummaryChannelId: string;
  readonly discordSummaryWebhookThreadEnabled: boolean;

  // システム設定
  lastClipTime: number;
  lastMyclipTime: number;
  lastStreamTitle: string;
  readonly restartInterval: number;
  readonly restartFile: string;
  readonly updateCheckInterval: number;
  readonly restartCheckInterval: number;
  readonly gitAutoUpdateEnabled: boolean;
  readonly clipCacheDbPath: string;
  readonly clipRecentWindowMinutes: number;
  readonly streamSummaryStatePath: string;
  readonly chatRecommendationEnabled: boolean;
  readonly chatRecommendationIntervalMinutes: number;
  readonly chatAiEnabled: boolean;
  readonly chatAiBaseUrl: string;
  readonly chatAiModel: string;
  readonly chatAiTimeoutMs: number;
  readonly chatAiTimeoutFallbackReply: string;
  readonly chatAiKeepAlive: string;
  readonly chatAiPrewarmEnabled: boolean;
  readonly chatAiPrewarmIntervalSeconds: number;
  readonly chatAiPrewarmTimeoutMs: number;
  readonly chatAiMaxResponseChars: number;
  readonly chatAiConversationHistoryEnabled: boolean;
  readonly chatAiConversationHistoryMaxMessages: number;
  readonly chatAiConversationHistoryMaxChars: number;
  readonly chatAiConversationHistoryTtlSeconds: number;
  readonly chatAiCommentMemoryEnabled: boolean;
  readonly chatAiCommentMemoryMaxEntriesPerMessage: number;
  readonly chatAiCommentMemoryDedupTtlSeconds: number;
  readonly chatAiBotAliases: string[];
  readonly chatAiCooldownSeconds: number;
  readonly chatAiIgnoredUsers: string[];
  readonly chatAiStreamImageEnabled: boolean;
  readonly chatAiVisionModel: string;
  readonly chatAiMemoryEnabled: boolean;
  readonly chatAiMemoryStore: ChatAiMemoryStore;
  readonly chatAiMemoryPath: string;
  readonly chatAiMemoryDbPath: string;
  readonly chatAiMemoryMaxItems: number;
  readonly chatAiMemoryMaxChars: number;
  readonly chatAiMemoryPromotionMinObservations: number;
  readonly chatAiMemoryWriterUsers: string[];
  readonly chatAiImplicitMemoryEnabled: boolean;
  readonly chatAiMem0Enabled: boolean;
  readonly chatAiMem0Endpoint: string;
  readonly chatAiMem0ApiKey: string;
  readonly chatAiMem0UserId: string;
  readonly chatAiMem0AgentId: string;
  readonly chatAiMem0AppId: string;
  readonly chatAiMem0TimeoutMs: number;
  readonly chatAiMem0MaxResults: number;
  readonly chatAiMem0MaxChars: number;
  readonly chatAiSearchEnabled: boolean;
  readonly chatAiSearchProvider: ChatAiSearchProvider;
  readonly chatAiSearchEndpoint: string;
  readonly chatAiSearchEngines: string;
  readonly chatAiSearchTimeoutMs: number;
  readonly chatAiSearchMaxQueryChars: number;
  readonly chatAiSearchMaxResponseBytes: number;
  readonly chatAiSearchMaxResults: number;
  readonly chatAiAutoLearnEnabled: boolean;
  readonly chatAiAutoLearnMaxKeyChars: number;
  readonly chatAiAutoLearnMaxValueChars: number;
  readonly chatAiAutoLearnMaxItems: number;
  readonly chatAiPromptReplyLogEnabled: boolean;
  readonly chatReplyEmotes: string[];
  readonly clipSearchAutoPublishEnabled: boolean;
  readonly clipSearchDataPath: string;
  readonly clipSearchPublishRepoDir: string;
  readonly clipSearchPublishMinIntervalMs: number;
  readonly clipSearchPublishRemote: string;
  readonly clipSearchPublishBranch: string;
  readonly clipSearchPublishGithubToken: string;
  readonly clipSearchPublishGithubUsername: string;
  readonly maxSummaryClipPosts: number;
  readonly ollamaShoutoutEnabled: boolean;
  readonly ollamaBaseUrl: string;
  readonly ollamaShoutoutModel: string;
  readonly ollamaShoutoutTimeoutMs: number;
  readonly ollamaShoutoutKeepAlive: string;

  // 特別ユーザー設定
  readonly clipSpecialUsers: string[];
  mangaCommandEnabled: boolean;
  readonly mangaAdminUsers: string[];
  readonly shoutoutAdminUsers: string[];

  // スコープ管理
  private _scopeReauthAttemptedForTokens = new Set<string>();
  private _scopeEchoedForTokens = new Set<string>();
  activeAuthScopes: string[];

  constructor(envFile = ".env") {
    const requestedEnvFile = path.resolve(BASE_DIR, envFile);
    const runtimeEnvFile = process.env["TWITCH_RUNTIME_ENV_FILE"]?.trim();
    this.envFile = runtimeEnvFile
      ? path.resolve(BASE_DIR, runtimeEnvFile)
      : envFile === ".env" && !fs.existsSync(requestedEnvFile)
        ? DEFAULT_RUNTIME_ENV_FILE
        : requestedEnvFile;

    const parsedEnv =
      dotenvConfig({ path: requestedEnvFile, processEnv: {} }).parsed ?? {};
    const runtimeEnv =
      this.envFile === requestedEnvFile
        ? {}
        : dotenvConfig({ path: this.envFile, processEnv: {} }).parsed ?? {};
    const env = {
      ...process.env,
      ...parsedEnv,
      ...runtimeEnv,
    };

    // Twitch設定
    this.loginChannel = "rukalun";
    this.commandPrefix = "!";
    this.twitchClientId = env["TWITCH_CLIENT_ID"] ?? "";
    this.twitchAccessToken = env["TWITCH_ACCESS_TOKEN"] ?? "";
    this.twitchRefreshToken = env["TWITCH_REFRESH_TOKEN"] ?? "";
    this.twitchSecretToken = env["TWITCH_SECRET_TOKEN"] ?? "";
    this.twitchBroadcasterId = env["TWITCH_BROADCASTER_ID"] ?? "";
    this.twitchModeratorId = env["TWITCH_MODERATOR_ID"] ?? "";
    this.twitchGqlClientId =
      env["TWITCH_GQL_CLIENT_ID"] ?? DEFAULT_TWITCH_GQL_CLIENT_ID;

    // Discord設定
    this.discordWebhookUrl = env["DISCORD_WEBHOOK_URL"] ?? "";
    this.discordBotToken = env["DISCORD_BOT_TOKEN"] ?? "";
    this.discordSummaryChannelId = env["DISCORD_SUMMARY_CHANNEL_ID"] ?? "";
    this.discordSummaryWebhookThreadEnabled = parseEnabledFlag(
      env["DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED"] ?? "0"
    );

    // システム設定
    this.lastClipTime = parseFloat(env["LAST_CLIP_TIME"] ?? "0") || 0;
    this.lastMyclipTime = parseFloat(env["LAST_MYCLIP_TIME"] ?? "0") || 0;
    this.lastStreamTitle = env["LAST_STREAM_TITLE"] ?? "";
    this.restartInterval = 60 * 60 * 24; // 24時間
    this.restartFile = path.resolve(BASE_DIR, "last_restart.txt");
    this.updateCheckInterval = 600; // 10分
    this.restartCheckInterval = 300; // 5分
    this.gitAutoUpdateEnabled = parseEnabledFlag(
      env["GIT_AUTO_UPDATE_ENABLED"] ?? "true"
    );
    this.clipCacheDbPath = path.resolve(
      BASE_DIR,
      env["TWITCH_CLIP_CACHE_DB_PATH"] ?? "data/clips.sqlite"
    );
    this.clipRecentWindowMinutes = parsePositiveInt(
      env["TWITCH_CLIP_RECENT_WINDOW_MINUTES"],
      DEFAULT_CLIP_RECENT_WINDOW_MINUTES
    );
    this.streamSummaryStatePath = path.resolve(
      BASE_DIR,
      env["STREAM_SUMMARY_STATE_PATH"] ?? "data/stream-summary-state.json"
    );
    this.chatRecommendationEnabled = parseEnabledFlag(
      env["CHAT_RECOMMENDATION_ENABLED"] ?? "true"
    );
    this.chatRecommendationIntervalMinutes = parsePositiveInt(
      env["CHAT_RECOMMENDATION_INTERVAL_MINUTES"],
      60
    );
    this.chatAiBaseUrl =
      env["CHAT_AI_BASE_URL"]?.trim() ||
      env["OLLAMA_BASE_URL"]?.trim() ||
      "http://127.0.0.1:11434";
    this.chatAiModel =
      env["CHAT_AI_MODEL"]?.trim() ||
      env["OLLAMA_MODEL"]?.trim() ||
      env["OLLAMA_SHOUTOUT_MODEL"]?.trim() ||
      "";
    const chatAiEnabled = parseOptionalEnabledFlag(env["CHAT_AI_ENABLED"]);
    this.chatAiEnabled =
      chatAiEnabled ??
      (this.chatAiModel !== "" &&
        parseEnabledFlag(env["OLLAMA_SHOUTOUT_ENABLED"] ?? "0"));
    this.chatAiTimeoutMs = parsePositiveInt(
      env["CHAT_AI_TIMEOUT_MS"],
      DEFAULT_CHAT_AI_TIMEOUT_MS
    );
    this.chatAiTimeoutFallbackReply =
      env["CHAT_AI_TIMEOUT_FALLBACK_REPLY"] === undefined
        ? DEFAULT_CHAT_AI_TIMEOUT_FALLBACK_REPLY
        : env["CHAT_AI_TIMEOUT_FALLBACK_REPLY"].trim();
    this.chatAiKeepAlive = env["CHAT_AI_KEEP_ALIVE"]?.trim() || "30m";
    this.chatAiPrewarmEnabled = parseEnabledFlag(
      env["CHAT_AI_PREWARM_ENABLED"] ?? "0"
    );
    this.chatAiPrewarmIntervalSeconds = parsePositiveInt(
      env["CHAT_AI_PREWARM_INTERVAL_SECONDS"],
      DEFAULT_CHAT_AI_PREWARM_INTERVAL_SECONDS
    );
    this.chatAiPrewarmTimeoutMs = parsePositiveInt(
      env["CHAT_AI_PREWARM_TIMEOUT_MS"],
      DEFAULT_CHAT_AI_PREWARM_TIMEOUT_MS
    );
    this.chatAiMaxResponseChars = parsePositiveInt(
      env["CHAT_AI_MAX_RESPONSE_CHARS"],
      DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS
    );
    this.chatAiConversationHistoryEnabled = parseEnabledFlag(
      env["CHAT_AI_CONVERSATION_HISTORY_ENABLED"] ?? "true"
    );
    this.chatAiConversationHistoryMaxMessages = parsePositiveInt(
      env["CHAT_AI_CONVERSATION_HISTORY_MAX_MESSAGES"],
      DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_MESSAGES
    );
    this.chatAiConversationHistoryMaxChars = parsePositiveInt(
      env["CHAT_AI_CONVERSATION_HISTORY_MAX_CHARS"],
      DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_CHARS
    );
    this.chatAiConversationHistoryTtlSeconds = parsePositiveInt(
      env["CHAT_AI_CONVERSATION_HISTORY_TTL_SECONDS"],
      DEFAULT_CHAT_AI_CONVERSATION_HISTORY_TTL_SECONDS
    );
    this.chatAiCommentMemoryEnabled = parseEnabledFlag(
      env["CHAT_AI_COMMENT_MEMORY_ENABLED"] ?? "0"
    );
    this.chatAiCommentMemoryMaxEntriesPerMessage = parsePositiveInt(
      env["CHAT_AI_COMMENT_MEMORY_MAX_ENTRIES_PER_MESSAGE"],
      DEFAULT_CHAT_AI_COMMENT_MEMORY_MAX_ENTRIES_PER_MESSAGE
    );
    this.chatAiCommentMemoryDedupTtlSeconds = parsePositiveInt(
      env["CHAT_AI_COMMENT_MEMORY_DEDUP_TTL_SECONDS"],
      DEFAULT_CHAT_AI_COMMENT_MEMORY_DEDUP_TTL_SECONDS
    );
    this.chatAiBotAliases = parseNameList(
      env["CHAT_AI_BOT_ALIASES"],
      DEFAULT_CHAT_AI_BOT_ALIASES
    );
    this.chatAiCooldownSeconds = parsePositiveInt(
      env["CHAT_AI_COOLDOWN_SECONDS"],
      DEFAULT_CHAT_AI_COOLDOWN_SECONDS
    );
    this.chatAiIgnoredUsers = parseNameList(
      env["CHAT_AI_IGNORED_USERS"],
      DEFAULT_CHAT_AI_IGNORED_USERS
    );
    this.chatAiStreamImageEnabled = parseEnabledFlag(
      env["CHAT_AI_STREAM_IMAGE_ENABLED"] ?? "0"
    );
    this.chatAiVisionModel =
      env["CHAT_AI_VISION_MODEL"]?.trim() || this.chatAiModel;
    this.chatAiMemoryEnabled = parseEnabledFlag(
      env["CHAT_AI_MEMORY_ENABLED"] ?? "0"
    );
    this.chatAiMemoryStore = parseChatAiMemoryStore(
      env["CHAT_AI_MEMORY_STORE"]
    );
    this.chatAiMemoryPath = path.resolve(
      BASE_DIR,
      env["CHAT_AI_MEMORY_PATH"] ?? "data/chat-ai-memory.json"
    );
    this.chatAiMemoryDbPath = path.resolve(
      BASE_DIR,
      env["CHAT_AI_MEMORY_DB_PATH"] ?? "data/chat-ai-memory.sqlite"
    );
    this.chatAiMemoryMaxItems = parsePositiveInt(
      env["CHAT_AI_MEMORY_MAX_ITEMS"],
      DEFAULT_CHAT_AI_MEMORY_MAX_ITEMS
    );
    this.chatAiMemoryMaxChars = parsePositiveInt(
      env["CHAT_AI_MEMORY_MAX_CHARS"],
      DEFAULT_CHAT_AI_MEMORY_MAX_CHARS
    );
    this.chatAiMemoryPromotionMinObservations = parsePositiveInt(
      env["CHAT_AI_MEMORY_PROMOTION_MIN_OBSERVATIONS"],
      DEFAULT_CHAT_AI_MEMORY_PROMOTION_MIN_OBSERVATIONS
    );
    this.chatAiMemoryWriterUsers = parseNameList(
      env["CHAT_AI_MEMORY_WRITER_USERS"],
      [this.loginChannel]
    );
    this.chatAiSearchEnabled = parseEnabledFlag(
      env["CHAT_AI_SEARCH_ENABLED"] ?? "0"
    );
    this.chatAiSearchProvider = parseChatAiSearchProvider(
      env["CHAT_AI_SEARCH_PROVIDER"]
    );
    this.chatAiSearchEndpoint =
      env["CHAT_AI_SEARCH_ENDPOINT"]?.trim() ||
      DEFAULT_CHAT_AI_SEARCH_ENDPOINT;
    this.chatAiSearchEngines = env["CHAT_AI_SEARCH_ENGINES"]?.trim() || "";
    this.chatAiSearchTimeoutMs = parsePositiveInt(
      env["CHAT_AI_SEARCH_TIMEOUT_MS"],
      DEFAULT_CHAT_AI_SEARCH_TIMEOUT_MS
    );
    this.chatAiSearchMaxQueryChars = parsePositiveInt(
      env["CHAT_AI_SEARCH_MAX_QUERY_CHARS"],
      DEFAULT_CHAT_AI_SEARCH_MAX_QUERY_CHARS
    );
    this.chatAiSearchMaxResponseBytes = parsePositiveInt(
      env["CHAT_AI_SEARCH_MAX_RESPONSE_BYTES"],
      DEFAULT_CHAT_AI_SEARCH_MAX_RESPONSE_BYTES
    );
    this.chatAiSearchMaxResults = parsePositiveInt(
      env["CHAT_AI_SEARCH_MAX_RESULTS"],
      DEFAULT_CHAT_AI_SEARCH_MAX_RESULTS
    );
    this.chatAiImplicitMemoryEnabled = parseEnabledFlag(
      env["CHAT_AI_IMPLICIT_MEMORY_ENABLED"] ?? "0"
    );
    this.chatAiMem0Enabled = parseEnabledFlag(
      env["CHAT_AI_MEM0_ENABLED"] ?? "0"
    );
    this.chatAiMem0Endpoint = env["CHAT_AI_MEM0_ENDPOINT"]?.trim() || "";
    this.chatAiMem0ApiKey =
      env["CHAT_AI_MEM0_API_KEY"]?.trim() || env["MEM0_API_KEY"]?.trim() || "";
    this.chatAiMem0UserId =
      env["CHAT_AI_MEM0_USER_ID"]?.trim() || this.loginChannel;
    this.chatAiMem0AgentId =
      env["CHAT_AI_MEM0_AGENT_ID"]?.trim() || "twitchRaid";
    this.chatAiMem0AppId =
      env["CHAT_AI_MEM0_APP_ID"]?.trim() || "twitchRaid";
    this.chatAiMem0TimeoutMs = parsePositiveInt(
      env["CHAT_AI_MEM0_TIMEOUT_MS"],
      DEFAULT_CHAT_AI_MEM0_TIMEOUT_MS
    );
    this.chatAiMem0MaxResults = parsePositiveInt(
      env["CHAT_AI_MEM0_MAX_RESULTS"],
      DEFAULT_CHAT_AI_MEM0_MAX_RESULTS
    );
    this.chatAiMem0MaxChars = parsePositiveInt(
      env["CHAT_AI_MEM0_MAX_CHARS"],
      DEFAULT_CHAT_AI_MEM0_MAX_CHARS
    );
    this.chatAiAutoLearnEnabled = parseEnabledFlag(
      env["CHAT_AI_AUTO_LEARN_ENABLED"] ?? "0"
    );
    this.chatAiAutoLearnMaxKeyChars = parsePositiveInt(
      env["CHAT_AI_AUTO_LEARN_MAX_KEY_CHARS"],
      DEFAULT_CHAT_AI_AUTO_LEARN_MAX_KEY_CHARS
    );
    this.chatAiAutoLearnMaxValueChars = parsePositiveInt(
      env["CHAT_AI_AUTO_LEARN_MAX_VALUE_CHARS"],
      DEFAULT_CHAT_AI_AUTO_LEARN_MAX_VALUE_CHARS
    );
    this.chatAiAutoLearnMaxItems = parsePositiveInt(
      env["CHAT_AI_AUTO_LEARN_MAX_ITEMS"],
      DEFAULT_CHAT_AI_AUTO_LEARN_MAX_ITEMS
    );
    this.chatAiPromptReplyLogEnabled = parseEnabledFlag(
      env["CHAT_AI_PROMPT_REPLY_LOG_ENABLED"] ?? "0"
    );
    this.chatReplyEmotes = normalizeChatReplyEmotes(env["CHAT_REPLY_EMOTES"]);
    this.clipSearchAutoPublishEnabled = parseEnabledFlag(
      env["CLIP_SEARCH_AUTO_PUBLISH_ENABLED"] ?? "0"
    );
    this.clipSearchPublishRepoDir = path.resolve(
      BASE_DIR,
      env["CLIP_SEARCH_PUBLISH_REPO_DIR"] ??
        DEFAULT_CLIP_SEARCH_PUBLISH_REPO_DIR
    );
    this.clipSearchDataPath = path.resolve(
      BASE_DIR,
      env["CLIP_SEARCH_DATA_PATH"] ??
        path.join(this.clipSearchPublishRepoDir, "clip-search-data.json")
    );
    this.clipSearchPublishMinIntervalMs = parsePositiveInt(
      env["CLIP_SEARCH_PUBLISH_MIN_INTERVAL_MS"],
      5 * 60 * 1000
    );
    this.clipSearchPublishRemote =
      env["CLIP_SEARCH_PUBLISH_REMOTE"]?.trim() || "origin";
    this.clipSearchPublishBranch =
      env["CLIP_SEARCH_PUBLISH_BRANCH"]?.trim() || "main";
    this.clipSearchPublishGithubToken =
      env["CLIP_SEARCH_PUBLISH_GITHUB_TOKEN"]?.trim() ||
      env["GITHUB_TOKEN"]?.trim() ||
      env["GH_TOKEN"]?.trim() ||
      "";
    this.clipSearchPublishGithubUsername =
      env["CLIP_SEARCH_PUBLISH_GITHUB_USERNAME"]?.trim() || "x-access-token";
    this.maxSummaryClipPosts =
      parseInt(env["STREAM_SUMMARY_MAX_CLIPS"] ?? "10", 10) || 10;
    this.ollamaShoutoutEnabled = parseEnabledFlag(
      env["OLLAMA_SHOUTOUT_ENABLED"] ?? "0"
    );
    this.ollamaBaseUrl =
      env["OLLAMA_BASE_URL"]?.trim() || "http://127.0.0.1:11434";
    this.ollamaShoutoutModel =
      env["OLLAMA_SHOUTOUT_MODEL"]?.trim() ||
      env["CHAT_AI_MODEL"]?.trim() ||
      env["OLLAMA_MODEL"]?.trim() ||
      "";
    this.ollamaShoutoutTimeoutMs = parsePositiveInt(
      env["OLLAMA_SHOUTOUT_TIMEOUT_MS"],
      15_000
    );
    this.ollamaShoutoutKeepAlive =
      env["OLLAMA_SHOUTOUT_KEEP_ALIVE"]?.trim() || "30m";

    // 特別ユーザー
    const specialUsersStr = env["CLIP_SPECIAL_USERS"] ?? "nyme_ia,rukalun";
    this.clipSpecialUsers = specialUsersStr
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);

    this.mangaCommandEnabled = parseEnabledFlag(
      env["MANGA_COMMAND_ENABLED"] ?? "0"
    );
    const mangaAdminStr = env["MANGA_ADMIN_USERS"] ?? "rukalun";
    this.mangaAdminUsers = mangaAdminStr
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);

    const shoutoutAdminStr = env["SHOUTOUT_ADMIN_USERS"] ?? "rukalun";
    this.shoutoutAdminUsers = shoutoutAdminStr
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);

    this.activeAuthScopes = [...REQUIRED_AUTH_SCOPES];
  }

  updateAccessToken(accessToken: string, refreshToken: string): void {
    this.twitchAccessToken = accessToken;
    this.twitchRefreshToken = refreshToken;
    this._scopeReauthAttemptedForTokens.clear();
    this._scopeEchoedForTokens.clear();

    process.env["TWITCH_ACCESS_TOKEN"] = accessToken;
    process.env["TWITCH_REFRESH_TOKEN"] = refreshToken;

    updateEnvFile(this.envFile, {
      TWITCH_ACCESS_TOKEN: accessToken,
      TWITCH_REFRESH_TOKEN: refreshToken,
    });
  }

  hasScopeReauthAttempted(token: string): boolean {
    return this._scopeReauthAttemptedForTokens.has(token);
  }

  markScopeReauthAttempted(token: string): void {
    this._scopeReauthAttemptedForTokens.add(token);
  }

  hasScopeEchoed(token: string): boolean {
    return this._scopeEchoedForTokens.has(token);
  }

  markScopeEchoed(token: string): void {
    this._scopeEchoedForTokens.add(token);
  }

  setActiveAuthScopes(scopes: string[]): void {
    this.activeAuthScopes = [...scopes];
  }

  updateLastClipTime(timestamp: number): void {
    this.lastClipTime = timestamp;
    process.env["LAST_CLIP_TIME"] = String(timestamp);
    updateEnvFile(this.envFile, { LAST_CLIP_TIME: String(timestamp) });
  }

  updateLastMyclipTime(timestamp: number): void {
    this.lastMyclipTime = timestamp;
    process.env["LAST_MYCLIP_TIME"] = String(timestamp);
    updateEnvFile(this.envFile, { LAST_MYCLIP_TIME: String(timestamp) });
  }

  updateLastStreamTitle(title: string): void {
    const normalized = title.trim();
    this.lastStreamTitle = normalized;
    process.env["LAST_STREAM_TITLE"] = normalized;
    updateEnvFile(this.envFile, { LAST_STREAM_TITLE: normalized });
  }

  updateMangaCommandEnabled(enabled: boolean): void {
    this.mangaCommandEnabled = enabled;
    const envValue = toEnvFlag(enabled);
    process.env["MANGA_COMMAND_ENABLED"] = envValue;
    updateEnvFile(this.envFile, { MANGA_COMMAND_ENABLED: envValue });
  }

  getLastStreamTitle(): string {
    return this.lastStreamTitle;
  }
}
