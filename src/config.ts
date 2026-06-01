import { config as dotenvConfig } from "dotenv";
import path from "path";
import { updateEnvFile } from "./utils/env-store";
import { REQUIRED_AUTH_SCOPES } from "./auth/auth-scope-sets";

const BASE_DIR = path.resolve(__dirname, "..");
const DEFAULT_TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

function parseEnabledFlag(raw: string): boolean {
  return raw.toLowerCase() === "true" || raw === "1";
}

function toEnvFlag(enabled: boolean): string {
  return enabled ? "true" : "false";
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

  // システム設定
  lastClipTime: number;
  lastMyclipTime: number;
  lastStreamTitle: string;
  readonly restartInterval: number;
  readonly restartFile: string;
  readonly updateCheckInterval: number;
  readonly restartCheckInterval: number;
  readonly clipCacheDbPath: string;
  readonly streamSummaryStatePath: string;
  readonly maxSummaryClipPosts: number;

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
    this.envFile = path.resolve(BASE_DIR, envFile);
    const env = dotenvConfig({ path: this.envFile }).parsed ?? {};

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

    // システム設定
    this.lastClipTime = parseFloat(env["LAST_CLIP_TIME"] ?? "0") || 0;
    this.lastMyclipTime = parseFloat(env["LAST_MYCLIP_TIME"] ?? "0") || 0;
    this.lastStreamTitle = env["LAST_STREAM_TITLE"] ?? "";
    this.restartInterval = 60 * 60 * 24; // 24時間
    this.restartFile = path.resolve(BASE_DIR, "last_restart.txt");
    this.updateCheckInterval = 600; // 10分
    this.restartCheckInterval = 300; // 5分
    this.clipCacheDbPath = path.resolve(
      BASE_DIR,
      env["TWITCH_CLIP_CACHE_DB_PATH"] ?? "data/clips.sqlite"
    );
    this.streamSummaryStatePath = path.resolve(
      BASE_DIR,
      env["STREAM_SUMMARY_STATE_PATH"] ?? "data/stream-summary-state.json"
    );
    this.maxSummaryClipPosts =
      parseInt(env["STREAM_SUMMARY_MAX_CLIPS"] ?? "10", 10) || 10;

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
