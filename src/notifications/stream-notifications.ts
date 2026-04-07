import type { Config } from "../config";
import logger from "../utils/logger";

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
    currentTitle: string,
    sendFn: (message: string) => Promise<void> | void
  ): Promise<void> {
    const normalizedCurrent = this._normalizeTitle(currentTitle);
    const storedTitle = this._storedLastTitle();
    const normalizedStored = this._normalizeTitle(storedTitle);

    if (!normalizedCurrent) return;

    if (normalizedStored && normalizedStored === normalizedCurrent) {
      return; // タイトル未変更
    }

    const message = this.buildMessage(normalizedCurrent);
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
    return `${newTitle}\n🔴 配信URL: https://www.twitch.tv/${this.channelName}`;
  }

  private _storedLastTitle(): string {
    return this.config.getLastStreamTitle();
  }

  private _normalizeTitle(title: string): string {
    return (title ?? "").trim();
  }
}
