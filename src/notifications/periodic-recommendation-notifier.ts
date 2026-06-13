export const DEFAULT_RECOMMENDATION_TARGETS = [
  "るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp",
  "るっかるんのグッズはこちら！→ https://rukalun.booth.pm",
] as const;

type SendRecommendation = (message: string) => Promise<unknown>;

type PeriodicRecommendationNotifierOptions = {
  enabled: boolean;
  intervalSeconds: number;
  initialStreamStartedAt?: number;
};

export class PeriodicRecommendationNotifier {
  private readonly enabled: boolean;
  private readonly intervalSeconds: number;
  private streamStartedAt: number;
  private lastSentAt: number;
  private nextIndex = 0;
  private isSending = false;

  constructor(options: PeriodicRecommendationNotifierOptions) {
    this.enabled = options.enabled;
    this.intervalSeconds = Math.max(1, Math.floor(options.intervalSeconds));
    this.streamStartedAt = options.initialStreamStartedAt ?? 0;
    this.lastSentAt = this.streamStartedAt;
  }

  reset(streamStartedAt: number, currentTime = streamStartedAt): void {
    this.streamStartedAt = streamStartedAt;
    const elapsedIntervals = Math.max(
      0,
      Math.floor((currentTime - streamStartedAt) / this.intervalSeconds)
    );
    this.lastSentAt =
      streamStartedAt + elapsedIntervals * this.intervalSeconds;
  }

  async notifyIfReady(
    currentTime: number,
    send: SendRecommendation
  ): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.isSending) return false;
    if (currentTime - this.lastSentAt < this.intervalSeconds) return false;

    const elapsedHours = Math.max(
      1,
      Math.floor((currentTime - this.streamStartedAt) / 3600)
    );
    const target = DEFAULT_RECOMMENDATION_TARGETS[this.nextIndex];
    const message = `!【定期】配信開始から${elapsedHours}時間経過しました。${target}`;
    this.isSending = true;
    try {
      await send(message);
    } finally {
      this.isSending = false;
    }

    this.lastSentAt = currentTime;
    this.nextIndex =
      (this.nextIndex + 1) % DEFAULT_RECOMMENDATION_TARGETS.length;
    return true;
  }
}
