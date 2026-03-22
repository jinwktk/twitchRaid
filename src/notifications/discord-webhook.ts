import logger from "../utils/logger";

/**
 * Discord Webhookで通知を送信する
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  message: string
): Promise<void> {
  if (!webhookUrl) {
    logger.warn("⚠️ DISCORD_WEBHOOK_URL が設定されていません。");
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (response.ok) {
      logger.info(`✅ Discord に通知を送信しました: ${response.status}`);
    } else {
      logger.error(
        `❌ Discord Webhook の送信に失敗しました: ${response.status}`
      );
    }
  } catch (e) {
    logger.error(`❌ Discord Webhook の送信に失敗しました: ${e}`);
  }
}
