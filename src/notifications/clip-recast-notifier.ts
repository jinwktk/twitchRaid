import logger from "../utils/logger";

/**
 * クリップコマンドのリキャスト通知管理
 */
export class ClipRecastNotifier {
  readonly cooldownSeconds: number;
  private readonly readyMessage: string;
  private armed = false;
  private startedAt: number | null = null;
  private sendCoroutine: ((msg: string) => Promise<void>) | null = null;

  constructor(cooldownSeconds: number, readyMessage: string) {
    this.cooldownSeconds = cooldownSeconds;
    this.readyMessage = readyMessage;
  }

  arm(
    startedAt: number,
    sendCoroutine: (msg: string) => Promise<void>
  ): void {
    this.armed = true;
    this.startedAt = startedAt;
    this.sendCoroutine = sendCoroutine;
  }

  disarm(): void {
    this.armed = false;
    this.startedAt = null;
    this.sendCoroutine = null;
  }

  async notifyIfReady(currentTime: number): Promise<void> {
    if (!this.armed || this.startedAt === null || !this.sendCoroutine) return;

    const elapsed = currentTime - this.startedAt;
    if (elapsed >= this.cooldownSeconds) {
      try {
        await this.sendCoroutine(this.readyMessage);
        logger.info("⏱️ リキャスト通知を送信しました。");
      } catch (e) {
        logger.error(`❌ リキャスト通知送信失敗: ${e}`);
      }
      this.disarm();
    }
  }
}
