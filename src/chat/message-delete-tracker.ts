/**
 * 削除予約メッセージの追跡
 */
export interface PendingDeleteMessage {
  content: string;
  channelName: string;
  deleteAfterSeconds: number;
  queuedAt: number;
}

export class PendingDeleteTracker {
  private readonly staleSeconds: number;
  private readonly queue: PendingDeleteMessage[] = [];

  constructor(staleSeconds = 90) {
    this.staleSeconds = staleSeconds;
  }

  add(
    content: string,
    channelName: string,
    deleteAfterSeconds: number,
    now: number
  ): void {
    this.queue.push({ content, channelName, deleteAfterSeconds, queuedAt: now });
  }

  popMatched(
    content: string,
    channelName: string,
    now: number
  ): PendingDeleteMessage | null {
    this._prune(now);
    const idx = this.queue.findIndex(
      (m) => m.content === content && m.channelName === channelName
    );
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }

  popFirstForChannel(
    channelName: string,
    now: number
  ): PendingDeleteMessage | null {
    this._prune(now);
    const idx = this.queue.findIndex((m) => m.channelName === channelName);
    if (idx === -1) return null;
    return this.queue.splice(idx, 1)[0];
  }

  private _prune(now: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (now - this.queue[i].queuedAt > this.staleSeconds) {
        this.queue.splice(i, 1);
      }
    }
  }
}
