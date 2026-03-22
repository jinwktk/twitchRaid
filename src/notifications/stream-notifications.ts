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
   */
  notifyIfNeeded(
    currentTitle: string,
    sendFn: (message: string) => void
  ): void {
    const normalizedCurrent = this._normalizeTitle(currentTitle);
    const storedTitle = this._storedLastTitle();
    const normalizedStored = this._normalizeTitle(storedTitle);

    if (!normalizedCurrent) return;

    if (normalizedStored && normalizedStored === normalizedCurrent) {
      return; // タイトル未変更
    }

    const message = this.buildMessage(normalizedStored, normalizedCurrent);
    sendFn(message);
    this.config.updateLastStreamTitle(normalizedCurrent);
  }

  buildMessage(oldTitle: string, newTitle: string): string {
    if (!oldTitle) {
      return `${newTitle}\n🔴配信URL: https://www.twitch.tv/${this.channelName}`;
    }
    return `🔄 タイトル変更！\n旧: ${oldTitle}\n新: ${newTitle}\n🔴配信URL: https://www.twitch.tv/${this.channelName}`;
  }

  private _storedLastTitle(): string {
    return this.config.getLastStreamTitle();
  }

  private _normalizeTitle(title: string): string {
    return (title ?? "").trim();
  }
}
