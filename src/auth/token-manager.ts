import logger from "../utils/logger";
import { shouldTryFallback } from "./token-refresh-policy";
import { normalizeScopeValues } from "./scope-policy";
import type { Config } from "../config";

interface TokenValidationResult {
  login?: string;
  client_id?: string;
  scopes?: string[];
  expires_in?: number;
  status?: number;
}

/**
 * Twitch アクセストークンを検証する
 */
export async function validateAccessToken(
  config: Config
): Promise<string | null> {
  try {
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${config.twitchAccessToken}` },
    });

    if (response.status === 401) {
      logger.warn(
        "⚠️ アクセストークンが無効です（401 Unauthorized）。リフレッシュを試みます..."
      );
      return await refreshAccessTokenAdvanced(config);
    }

    const data = (await response.json()) as TokenValidationResult;
    logger.debug(`📝 validate_token() のレスポンス: ${JSON.stringify(data)}`);

    if (data.login) {
      const grantedScopes = data.scopes ?? [];
      const scopeValues = normalizeScopeValues(grantedScopes);
      config.setActiveAuthScopes(grantedScopes);

      const currentToken = config.twitchAccessToken;
      if (currentToken && !config.hasScopeEchoed(currentToken)) {
        logger.info(
          `[ECHO] 起動時トークンスコープ: ${
            scopeValues.length > 0 ? scopeValues.join(", ") : "(none)"
          }`
        );
        config.markScopeEchoed(currentToken);
      }

      logger.info(
        `✅ アクセストークンは有効: ${data.login} (Client ID: ${data.client_id}, active_scopes=${grantedScopes.length})`
      );
      return config.twitchAccessToken;
    }

    logger.warn(
      "⚠️ 'login' キーがレスポンスに存在しません。トークンが無効の可能性があります。"
    );
    return null;
  } catch (e) {
    logger.error(`❌ Twitchトークンの検証中にエラー: ${e}`);
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

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const newAccessToken = data.access_token as string | undefined;
      const newRefreshToken = data.refresh_token as string | undefined;

      if (newAccessToken) {
        logger.info("⚡ トークン更新成功！");
        config.updateAccessToken(
          newAccessToken,
          newRefreshToken ?? config.twitchRefreshToken
        );

        // トークン検証
        const validateResponse = await fetch(
          "https://id.twitch.tv/oauth2/validate",
          {
            headers: { Authorization: `OAuth ${newAccessToken}` },
          }
        );

        if (validateResponse.ok) {
          const validateData = (await validateResponse.json()) as TokenValidationResult;
          const scopeValues = normalizeScopeValues(
            validateData.scopes ?? []
          );
          logger.info(
            `[ECHO] 再取得トークンスコープ(advanced): ${
              scopeValues.length > 0 ? scopeValues.join(", ") : "(none)"
            }`
          );
          if (config.twitchAccessToken) {
            config.markScopeEchoed(config.twitchAccessToken);
          }
          logger.info(
            `✨ トークン検証完了: User=${validateData.login}, Expires=${validateData.expires_in}秒`
          );
          return newAccessToken;
        }
      }
    }

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
  } catch (e) {
    logger.error(`❌ 高度なトークンリフレッシュ中にエラー: ${e}`);
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
