import { config as dotenvConfig, parse as dotenvParse } from "dotenv";
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
const DEFAULT_ANYTHING_LLM_TIMEOUT_MS = 30_000;
const DEFAULT_ANYTHING_LLM_BATCH_MAX_COMMENTS = 200;
const DEFAULT_ANYTHING_LLM_CHAT_FLUSH_DEADLINE_MS = 1_500;
const DEFAULT_ANYTHING_LLM_QUEUE_HIGH_WATER_COMMENTS = 5_000;
const DEFAULT_ANYTHING_LLM_DISK_MIN_FREE_BYTES = 1_073_741_824;
const DEFAULT_ANYTHING_LLM_CLEANUP_INTERVAL_SECONDS = 3_600;
const DEFAULT_ANYTHING_LLM_RAW_RETENTION_DAYS = 365;
const DEFAULT_CHAT_AI_CONTEXT_LENGTH = 4_096;
const DEFAULT_CHAT_AI_TIMEOUT_FALLBACK_REPLY =
  "今ちょっとAIが混み合ってるD！";
const DEFAULT_CHAT_AI_PREWARM_INTERVAL_SECONDS = 600;
const DEFAULT_CHAT_AI_PREWARM_TIMEOUT_MS = 180_000;
export const DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS = 500;
const DEFAULT_CHAT_AI_COOLDOWN_SECONDS = 5;
const DEFAULT_CHAT_AI_BOT_ALIASES = ["にめいやボットくん", "nyme_ia2"];
const DEFAULT_CHAT_AI_IGNORED_USERS = ["nyme_ia2"];
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_MESSAGES = 6;
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_MAX_CHARS = 1_000;
const DEFAULT_CHAT_AI_CONVERSATION_HISTORY_TTL_SECONDS = 1_800;
const DEFAULT_BOT_REQUEST_NOTES_DIGEST_INTERVAL_HOURS = 168;
const DEFAULT_BOT_REQUEST_NOTES_DIGEST_MAX_ITEMS = 10;
const DEFAULT_BOT_REQUEST_NOTES_DIGEST_FILE_PATH =
  "data/bot-request-notes-digest.md";
const DEFAULT_CHAT_AI_SEARCH_ENDPOINT = "https://api.duckduckgo.com/";
const DEFAULT_CHAT_AI_SEARCH_PROVIDER = "duckduckgo";
const DEFAULT_CHAT_AI_SEARCH_TIMEOUT_MS = 2_500;
const DEFAULT_CHAT_AI_SEARCH_MAX_QUERY_CHARS = 120;
const DEFAULT_CHAT_AI_SEARCH_MAX_RESPONSE_BYTES = 65_536;
const DEFAULT_CHAT_AI_SEARCH_MAX_RESULTS = 3;

type ChatAiSearchProvider = "duckduckgo" | "searxng";

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

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
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

function restorePackedDokployEnvironment(
  processEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const packedClientId = processEnv["TWITCH_CLIENT_ID"];
  if (!packedClientId?.includes("\\n")) return processEnv;

  const [clientId, ...packedLines] = packedClientId.split("\\n");
  const restored = dotenvParse(packedLines.join("\n"));
  return {
    ...restored,
    ...processEnv,
    TWITCH_CLIENT_ID: clientId,
  };
}

function parseChatAiSearchProvider(
  raw: string | undefined
): ChatAiSearchProvider {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "searxng"
    ? "searxng"
    : DEFAULT_CHAT_AI_SEARCH_PROVIDER;
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
  readonly chatAiAnythingLlmEnabled: boolean;
  readonly anythingLlmCommentWriteEnabled: boolean;
  readonly anythingLlmBaseUrl: string;
  readonly anythingLlmApiKeyFile: string;
  readonly anythingLlmWorkspaceName: string;
  readonly anythingLlmWorkspaceSlug: string;
  readonly anythingLlmSessionId: string;
  readonly anythingLlmUtilityWorkspaceName: string;
  readonly anythingLlmUtilityWorkspaceSlug: string;
  readonly anythingLlmUtilitySessionId: string;
  readonly anythingLlmTimeoutMs: number;
  readonly anythingLlmLedgerDbPath: string;
  readonly anythingLlmStreamKnowledgeEnabled: boolean;
  readonly anythingLlmStreamKnowledgeDbPath: string;
  readonly anythingLlmBatchMaxComments: number;
  readonly anythingLlmChatFlushDeadlineMs: number;
  readonly anythingLlmQueueHighWaterComments: number;
  readonly anythingLlmDiskMinFreeBytes: number;
  readonly anythingLlmCleanupIntervalSeconds: number;
  readonly anythingLlmRawRetentionDays: number;
  readonly chatAiBaseUrl: string;
  readonly chatAiModel: string;
  readonly chatAiTimeoutMs: number;
  readonly chatAiTimeoutFallbackReply: string;
  readonly chatAiKeepAlive: string;
  readonly chatAiContextLength: number;
  readonly chatAiPrewarmEnabled: boolean;
  readonly chatAiPrewarmPrimeEnabled: boolean;
  readonly chatAiPrewarmIntervalSeconds: number;
  readonly chatAiPrewarmTimeoutMs: number;
  readonly chatAiMaxResponseChars: number;
  readonly chatAiConversationHistoryEnabled: boolean;
  readonly chatAiConversationHistoryMaxMessages: number;
  readonly chatAiConversationHistoryMaxChars: number;
  readonly chatAiConversationHistoryTtlSeconds: number;
  readonly botRequestNotesEnabled: boolean;
  readonly botRequestNotesDbPath: string;
  readonly botRequestNotesDigestEnabled: boolean;
  readonly botRequestNotesDigestIntervalHours: number;
  readonly botRequestNotesDigestMaxItems: number;
  readonly botRequestNotesDiscordChannelId: string;
  readonly botRequestNotesDigestFilePath: string;
  readonly botRequestNotesDigestDiscordEnabled: boolean;
  readonly chatAiBotAliases: string[];
  readonly chatAiCooldownSeconds: number;
  readonly chatAiIgnoredUsers: string[];
  readonly chatAiStreamImageEnabled: boolean;
  readonly chatAiVisionModel: string;
  readonly chatAiSearchEnabled: boolean;
  readonly chatAiSearchProvider: ChatAiSearchProvider;
  readonly chatAiSearchEndpoint: string;
  readonly chatAiSearchEngines: string;
  readonly chatAiSearchTimeoutMs: number;
  readonly chatAiSearchMaxQueryChars: number;
  readonly chatAiSearchMaxResponseBytes: number;
  readonly chatAiSearchMaxResults: number;
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
      ...restorePackedDokployEnvironment(process.env),
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
    this.chatAiAnythingLlmEnabled = parseEnabledFlag(
      env["CHAT_AI_ANYTHINGLLM_ENABLED"] ?? "false"
    );
    this.anythingLlmBaseUrl =
      env["ANYTHING_LLM_BASE_URL"]?.trim() || "http://anythingllm:3001";
    this.anythingLlmApiKeyFile = path.resolve(
      BASE_DIR,
      env["ANYTHING_LLM_API_KEY_FILE"] ??
        "/run/secrets/anythingllm-api-key"
    );
    this.anythingLlmWorkspaceName =
      env["ANYTHING_LLM_WORKSPACE_NAME"]?.trim() ||
      `Twitch ${this.loginChannel}`;
    this.anythingLlmWorkspaceSlug =
      env["ANYTHING_LLM_WORKSPACE_SLUG"]?.trim() ||
      `twitch-${this.loginChannel}`;
    const defaultAnythingLlmSessionSubject = (
      this.twitchBroadcasterId || this.loginChannel
    )
      .replace(/[^a-zA-Z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    this.anythingLlmSessionId =
      env["ANYTHING_LLM_SESSION_ID"]?.trim() ||
      `twitchraid-channel-${defaultAnythingLlmSessionSubject}-v1`;
    this.anythingLlmUtilityWorkspaceName =
      env["ANYTHING_LLM_UTILITY_WORKSPACE_NAME"]?.trim() ||
      `Twitch ${this.loginChannel} utility`;
    this.anythingLlmUtilityWorkspaceSlug =
      env["ANYTHING_LLM_UTILITY_WORKSPACE_SLUG"]?.trim() ||
      `twitch-${this.loginChannel}-utility`;
    this.anythingLlmUtilitySessionId =
      env["ANYTHING_LLM_UTILITY_SESSION_ID"]?.trim() ||
      `twitchraid-utility-${defaultAnythingLlmSessionSubject}-v1`;
    this.anythingLlmTimeoutMs = parsePositiveInt(
      env["ANYTHING_LLM_TIMEOUT_MS"],
      DEFAULT_ANYTHING_LLM_TIMEOUT_MS
    );
    this.anythingLlmLedgerDbPath = path.resolve(
      BASE_DIR,
      env["ANYTHING_LLM_LEDGER_DB_PATH"] ??
        "data/anythingllm-ledger.sqlite"
    );
    this.anythingLlmStreamKnowledgeEnabled =
      parseOptionalEnabledFlag(
        env["ANYTHING_LLM_STREAM_KNOWLEDGE_ENABLED"]
      ) ?? this.chatAiAnythingLlmEnabled;
    this.anythingLlmCommentWriteEnabled =
      this.chatAiAnythingLlmEnabled ||
      this.anythingLlmStreamKnowledgeEnabled ||
      parseEnabledFlag(
        env["ANYTHING_LLM_COMMENT_WRITE_ENABLED"] ?? "false"
      );
    this.anythingLlmStreamKnowledgeDbPath = path.resolve(
      BASE_DIR,
      env["ANYTHING_LLM_STREAM_KNOWLEDGE_DB_PATH"] ??
        "data/anythingllm-stream-knowledge.sqlite"
    );
    this.anythingLlmBatchMaxComments = parseBoundedInt(
      env["ANYTHING_LLM_BATCH_MAX_COMMENTS"],
      DEFAULT_ANYTHING_LLM_BATCH_MAX_COMMENTS,
      1,
      200
    );
    this.anythingLlmChatFlushDeadlineMs = parseBoundedInt(
      env["ANYTHING_LLM_CHAT_FLUSH_DEADLINE_MS"],
      DEFAULT_ANYTHING_LLM_CHAT_FLUSH_DEADLINE_MS,
      100,
      30_000
    );
    this.anythingLlmQueueHighWaterComments = parseBoundedInt(
      env["ANYTHING_LLM_QUEUE_HIGH_WATER_COMMENTS"],
      DEFAULT_ANYTHING_LLM_QUEUE_HIGH_WATER_COMMENTS,
      1,
      1_000_000
    );
    this.anythingLlmDiskMinFreeBytes = parseBoundedInt(
      env["ANYTHING_LLM_DISK_MIN_FREE_BYTES"],
      DEFAULT_ANYTHING_LLM_DISK_MIN_FREE_BYTES,
      0,
      Number.MAX_SAFE_INTEGER
    );
    this.anythingLlmCleanupIntervalSeconds = parseBoundedInt(
      env["ANYTHING_LLM_CLEANUP_INTERVAL_SECONDS"],
      DEFAULT_ANYTHING_LLM_CLEANUP_INTERVAL_SECONDS,
      60,
      86_400
    );
    this.anythingLlmRawRetentionDays = parseBoundedInt(
      env["ANYTHING_LLM_RAW_RETENTION_DAYS"],
      DEFAULT_ANYTHING_LLM_RAW_RETENTION_DAYS,
      1,
      3_650
    );
    const chatAiEnabled = parseOptionalEnabledFlag(env["CHAT_AI_ENABLED"]);
    this.chatAiEnabled =
      chatAiEnabled ??
      (this.chatAiAnythingLlmEnabled ||
        (this.chatAiModel !== "" &&
          parseEnabledFlag(env["OLLAMA_SHOUTOUT_ENABLED"] ?? "0")));
    this.chatAiTimeoutMs = parsePositiveInt(
      env["CHAT_AI_TIMEOUT_MS"],
      DEFAULT_CHAT_AI_TIMEOUT_MS
    );
    this.chatAiTimeoutFallbackReply =
      env["CHAT_AI_TIMEOUT_FALLBACK_REPLY"] === undefined
        ? DEFAULT_CHAT_AI_TIMEOUT_FALLBACK_REPLY
        : env["CHAT_AI_TIMEOUT_FALLBACK_REPLY"].trim();
    this.chatAiKeepAlive = env["CHAT_AI_KEEP_ALIVE"]?.trim() || "30m";
    this.chatAiContextLength = parseBoundedInt(
      env["CHAT_AI_CONTEXT_LENGTH"],
      DEFAULT_CHAT_AI_CONTEXT_LENGTH,
      512,
      8_192
    );
    this.chatAiPrewarmEnabled = parseEnabledFlag(
      env["CHAT_AI_PREWARM_ENABLED"] ?? "0"
    );
    this.chatAiPrewarmPrimeEnabled = parseEnabledFlag(
      env["CHAT_AI_PREWARM_PRIME_ENABLED"] ?? "false"
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
    this.botRequestNotesEnabled = parseEnabledFlag(
      env["BOT_REQUEST_NOTES_ENABLED"] ?? "0"
    );
    this.botRequestNotesDbPath = path.resolve(
      BASE_DIR,
      env["BOT_REQUEST_NOTES_DB_PATH"] ?? "data/bot-request-notes.sqlite"
    );
    this.botRequestNotesDigestEnabled = parseEnabledFlag(
      env["BOT_REQUEST_NOTES_DIGEST_ENABLED"] ?? "0"
    );
    this.botRequestNotesDigestIntervalHours = parsePositiveInt(
      env["BOT_REQUEST_NOTES_DIGEST_INTERVAL_HOURS"],
      DEFAULT_BOT_REQUEST_NOTES_DIGEST_INTERVAL_HOURS
    );
    this.botRequestNotesDigestMaxItems = parsePositiveInt(
      env["BOT_REQUEST_NOTES_DIGEST_MAX_ITEMS"],
      DEFAULT_BOT_REQUEST_NOTES_DIGEST_MAX_ITEMS
    );
    this.botRequestNotesDiscordChannelId =
      env["BOT_REQUEST_NOTES_DISCORD_CHANNEL_ID"]?.trim() ||
      this.discordSummaryChannelId;
    this.botRequestNotesDigestFilePath = path.resolve(
      BASE_DIR,
      env["BOT_REQUEST_NOTES_DIGEST_FILE_PATH"] ??
        DEFAULT_BOT_REQUEST_NOTES_DIGEST_FILE_PATH
    );
    this.botRequestNotesDigestDiscordEnabled = parseEnabledFlag(
      env["BOT_REQUEST_NOTES_DIGEST_DISCORD_ENABLED"] ?? "0"
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
