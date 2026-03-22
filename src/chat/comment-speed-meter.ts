/**
 * コメント速度計測（スライディングウィンドウ）
 */
export class CommentSpeedMeter {
  private readonly windowSeconds: number;
  private timestamps: number[] = [];
  private _totalCount = 0;
  private _streamStartedAt: number | null = null;

  constructor(windowSeconds = 60) {
    this.windowSeconds = windowSeconds;
  }

  setState(streamStartedAt: number, totalCount: number): void {
    this._streamStartedAt = streamStartedAt || null;
    this._totalCount = totalCount;
  }

  startStream(timestamp: number): void {
    this._streamStartedAt = timestamp;
    this._totalCount = 0;
    this.timestamps = [];
  }

  resetStream(): void {
    this._streamStartedAt = null;
    this._totalCount = 0;
    this.timestamps = [];
  }

  ensureStreamStarted(timestamp: number): void {
    if (this._streamStartedAt === null) {
      this._streamStartedAt = timestamp;
    }
  }

  record(timestamp: number): void {
    this.timestamps.push(timestamp);
    this._totalCount++;
    this._prune(timestamp);
  }

  count(currentTime: number): number {
    this._prune(currentTime);
    return this.timestamps.length;
  }

  ratePerMinute(currentTime: number): number {
    const c = this.count(currentTime);
    return Math.round((c / this.windowSeconds) * 60 * 10) / 10;
  }

  totalCount(): number {
    return this._totalCount;
  }

  totalRatePerMinute(currentTime: number): number {
    if (!this._streamStartedAt || this._totalCount === 0) return 0;
    const elapsed = currentTime - this._streamStartedAt;
    if (elapsed <= 0) return 0;
    return Math.round((this._totalCount / elapsed) * 60 * 10) / 10;
  }

  streamStartedAt(): number | null {
    return this._streamStartedAt;
  }

  private _prune(currentTime: number): void {
    const cutoff = currentTime - this.windowSeconds;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}
