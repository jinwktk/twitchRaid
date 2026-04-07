import logger from "../utils/logger";
import { shouldTryFallback } from "./token-refresh-policy";
import { normalizeScopeValues } from "./scope-policy";
import type { Config } from "../config";

interface TokenValidationResult {
  login?: string;
  client_id?: string;
  scopes?: string[];
  expires_in?: number;
}

/**
 * トークン検証の in-memory キャッシュ（5分TTL）
 * 同一トークンの validateAccessToken 連続呼び出しに対する API 負荷を削減する。
 */
interface CachedValidation {
  token: string;
  validatedAt: number; // ms
}

const VALIDATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5分
let validationCache: CachedValidation | null = null;

/**
 * テスト・手動更新用にキャッシュをクリアする
 */
export function clearTokenValidationCache(): void {
  validationCache = null;
}

function getCachedValidation(token: string): boolean {
  if (!validationCache) return false;
  if (validationCache.token !== token) return false;
  if (Date.now() - validationCache.validatedAt > VALIDATION_CACHE_TTL_MS) {
    return false;
  }
  return true;
}

function setCachedValidation(token: string): void {
  validationCache = { token, validatedAt: Date.now() };
}

/**
 * Twitch アクセストークンを検証する
 *
 * 5分以内に同じトークンで validate に成功している場合はキャッシュを返し、
 * Twitch validate API への不要なリクエストを抑制する。
 */
export async function validateAccessToken(
  config: Config
): Promise<string | null> {
  // キャッシュヒット時は即返却
  const currentToken = config.twitchAccessToken;
  if (currentToken && getCachedValidation(currentToken)) {
    logger.debug("📦 トークン検証キャッシュヒット (TTL残あり)");
    return currentToken;
  }

  try {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${currentToken}` },
    });

    if (response.status === 401) {
      logger.warn(
        "⚠️ アクセストークンが無効です（401 Unauthorized）。リフレッシュを試みます..."
      );
      clearTokenValidationCache();
      return await refreshAccessTokenAdvanced(config);
    }

    const data = (await response.json()) as TokenValidationResult;
    // 秘匿情報（client_id, login, scopes本体）はログに出さず、メタデータのみ記録
    logger.debug(
      `📝 validate_token() OK: scope_count=${(data.scopes ?? []).length}, expires_in=${data.expires_in ?? "unknown"}`
    );

    if (data.login) {
      const grantedScopes = data.scopes ?? [];
      const scopeValues = normalizeScopeValues(grantedScopes);
      config.setActiveAuthScopes(grantedScopes);

      if (currentToken && !config.hasScopeEchoed(currentToken)) {
        logger.info(
          `[ECHO] 起動時トークンスコープ: ${
            scopeValues.length > 0 ? scopeValues.join(", ") : "(none)"
          }`
        );
        config.markScopeEchoed(currentToken);
      }

      logger.info(
        `✅ アクセストークンは有効: active_scopes=${grantedScopes.length}, expires_in=${data.expires_in ?? "unknown"}`
      );
      if (currentToken) setCachedValidation(currentToken);
      return currentToken;
    }

    logger.warn(
      "⚠️ 'login' キーがレスポンスに存在しません。トークンが無効の可能性があります。"
    );
    clearTokenValidationCache();
    return null;
  } catch (e) {
    logger.error(`❌ Twitchトークンの検証中にエラー: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 高度な自動トークンリフレッシュ（HTTP API直接リフレッシュ）
 */
export async function refreshAccessTokenAdvanced(
  config: Config
): Promise<string | null> {
  try {
    logger.info("🚀 高度な自動トークンリフレッシュを開始...");

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.twitchRefreshToken,
        client_id: config.twitchClientId,
        client_secret: config.twitchSecretToken,
      }),
    });

    if (!response.ok) {
      // 失敗時のみボディを読み取る（成功時の二重消費を防ぐ）
      const responseBody = await response.text().catch(() => "<取得失敗>");
      logger.error(
        `❌ トークンリフレッシュ失敗: ${response.status} body=${responseBody.substring(0, 500)}`
      );

      if (shouldTryFallback(response.status)) {
        logger.info(
          "🔄 高度リフレッシュ失敗。フォールバックは手動再認証が必要です。"
        );
      }

      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const newAccessToken = data["access_token"] as string | undefined;
    const newRefreshToken = data["refresh_token"] as string | undefined;

    if (!newAccessToken) {
      logger.error("❌ リフレッシュレスポンスに access_token が含まれません");
      return null;
    }

    logger.info("⚡ トークン更新成功！");
    config.updateAccessToken(
      newAccessToken,
      newRefreshToken ?? config.twitchRefreshToken
    );
    // トークンが変わったので検証キャッシュをクリア
    clearTokenValidationCache();

    // トークン検証
    const validateResponse = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      {
        headers: { Authorization: `OAuth ${newAccessToken}` },
      }
    );

    if (validateResponse.ok) {
      const validateData = (await validateResponse.json()) as TokenValidationResult;
      const scopeValues = normalizeScopeValues(validateData.scopes ?? []);
      logger.info(
        `[ECHO] 再取得トークンスコープ(advanced): ${
          scopeValues.length > 0 ? scopeValues.join(", ") : "(none)"
        }`
      );
      if (config.twitchAccessToken) {
        config.markScopeEchoed(config.twitchAccessToken);
      }
      logger.info(
        `✨ トークン検証完了: scope_count=${(validateData.scopes ?? []).length}, expires_in=${validateData.expires_in ?? "unknown"}`
      );
      setCachedValidation(newAccessToken);
    }

    return newAccessToken;
  } catch (e) {
    logger.error(`❌ 高度なトークンリフレッシュ中にエラー: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 有効なアクセストークンを取得（必要ならリフレッシュ）
 */
export async function getValidAccessToken(
  config: Config
): Promise<string | null> {
  const isValid = await validateAccessToken(config);
  if (isValid) return config.twitchAccessToken;

  logger.info("🔄 無効なトークンを検出。新しいトークンを取得します...");
  const newToken = await refreshAccessTokenAdvanced(config);

  if (!newToken) {
    logger.error(
      "❌ トークンの更新に失敗しました。手動で `.env` を修正してください。"
    );
    return null;
  }
  return newToken;
}
