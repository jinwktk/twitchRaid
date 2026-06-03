import logger from "../utils/logger";

export interface DiscordWebhookPayload {
  content: string;
  thread_name?: string;
}

export interface DiscordWebhookMessage {
  id: string;
  channelId: string;
}

export interface DiscordThread {
  id: string;
}

export interface ExecuteDiscordWebhookOptions {
  wait?: boolean;
  threadId?: string;
}

export interface CreateDiscordThreadFromMessageOptions {
  botToken: string;
  channelId: string;
  messageId: string;
  name: string;
  autoArchiveDuration?: number;
}

export interface CloseDiscordThreadOptions {
  botToken: string;
  threadId: string;
}

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
    await executeDiscordWebhook(webhookUrl, { content: message });
    logger.info("✅ Discord に通知を送信しました");
  } catch (e) {
    logger.error(`❌ Discord Webhook の送信に失敗しました: ${e}`);
  }
}

export async function executeDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: ExecuteDiscordWebhookOptions = {}
): Promise<DiscordWebhookMessage | null> {
  const url = new URL(webhookUrl);
  if (options.wait !== undefined) {
    url.searchParams.set("wait", options.wait ? "true" : "false");
  }
  if (options.threadId) {
    url.searchParams.set("thread_id", options.threadId);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord Webhook failed: ${response.status}`);
  }

  if (!options.wait) return null;

  const body = (await response.json()) as { id?: string; channel_id?: string };
  if (!body.id || !body.channel_id) return null;

  return {
    id: body.id,
    channelId: body.channel_id,
  };
}

export async function createDiscordThreadFromMessage({
  botToken,
  channelId,
  messageId,
  name,
  autoArchiveDuration = 1440,
}: CreateDiscordThreadFromMessageOptions): Promise<DiscordThread> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        auto_archive_duration: autoArchiveDuration,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord thread creation failed: ${response.status}`);
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("Discord thread response did not include id");
  return { id: body.id };
}

export async function closeDiscordThread({
  botToken,
  threadId,
}: CloseDiscordThreadOptions): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${threadId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord thread close failed: ${response.status}`);
  }
}
