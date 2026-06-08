import type { Config } from "../config";
import type { DiscordWebhookPayload } from "./discord-webhook";
import logger from "../utils/logger";

export interface StreamStartNotificationDetails {
  title: string;
  gameName?: string | null;
  viewers?: number | null;
  streamUrl?: string;
  thumbnailUrl?: string | null;
  getThumbnailUrl?: (width: number, height: number) => string;
  displayName?: string | null;
}

/**
 * 配信タイトル変更通知管理
 */
export class StreamTitleNotifier {
  private readonly config: Config;
  private readonly channelName: string;

  constructor(config: Config, channelName: string) {
    this.config = config;
    this.channelName = channelName;
  }

  /**
   * タイトル変更があれば通知する
   * sendFn は async 関数を渡せるよう Promise<void> を返す
   */
  async notifyIfNeeded(
    currentStream: string | StreamStartNotificationDetails,
    sendFn: (message: DiscordWebhookPayload) => Promise<void> | void
  ): Promise<void> {
    const streamDetails =
      typeof currentStream === "string"
        ? { title: currentStream }
        : currentStream;
    const currentTitle = streamDetails.title;
    const normalizedCurrent = this._normalizeTitle(currentTitle);
    const storedTitle = this._storedLastTitle();
    const normalizedStored = this._normalizeTitle(storedTitle);

    if (!normalizedCurrent) return;

    if (normalizedStored && normalizedStored === normalizedCurrent) {
      return; // タイトル未変更
    }

    const message = this.buildPayload({
      ...streamDetails,
      title: normalizedCurrent,
    });
    try {
      await sendFn(message);
      this.config.updateLastStreamTitle(normalizedCurrent);
    } catch (e) {
      logger.error(
        `❌ 配信タイトル通知の送信に失敗しました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  buildMessage(newTitle: string): string {
    return `@everyone\n${newTitle}\n🔴 配信URL: https://www.twitch.tv/${this.channelName}`;
  }

  buildPayload(stream: StreamStartNotificationDetails): DiscordWebhookPayload {
    const title = this._normalizeTitle(stream.title) || "配信開始";
    const streamUrl =
      stream.streamUrl ?? `https://www.twitch.tv/${this.channelName}`;
    const gameName = this._normalizeOptionalText(stream.gameName) || "未設定";
    const viewers =
      typeof stream.viewers === "number" && Number.isFinite(stream.viewers)
        ? Math.max(0, Math.floor(stream.viewers)).toString()
        : "不明";
    const thumbnailUrl = this._buildThumbnailUrl(stream);
    const embed = {
      author: {
        name: `${this._normalizeOptionalText(stream.displayName) || this.channelName} is now live on Twitch!`,
      },
      title,
      url: streamUrl,
      color: 0x9146ff,
      fields: [
        { name: "Game", value: gameName, inline: true },
        { name: "Viewers", value: viewers, inline: true },
      ],
      ...(thumbnailUrl ? { image: { url: thumbnailUrl } } : {}),
      footer: { text: "Watch Stream" },
    };

    return {
      content: "@everyone",
      allowed_mentions: { parse: ["everyone"] },
      embeds: [embed],
    };
  }

  private _storedLastTitle(): string {
    return this.config.getLastStreamTitle();
  }

  private _normalizeTitle(title: string | null | undefined): string {
    return (title ?? "").trim();
  }

  private _normalizeOptionalText(value: string | null | undefined): string {
    return (value ?? "").trim();
  }

  private _buildThumbnailUrl(
    stream: StreamStartNotificationDetails
  ): string | undefined {
    if (stream.getThumbnailUrl) {
      return stream.getThumbnailUrl(1280, 720);
    }

    const thumbnailUrl = this._normalizeOptionalText(stream.thumbnailUrl);
    if (!thumbnailUrl) return undefined;
    return thumbnailUrl
      .replace("{width}", "1280")
      .replace("{height}", "720");
  }
}
