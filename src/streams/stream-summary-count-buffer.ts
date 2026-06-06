export interface StreamSummaryCountBufferState {
  status: "active" | "pending" | "posted";
  commentCount: number;
  raidCount: number;
}

interface StreamSummaryCountBufferOptions<TState extends StreamSummaryCountBufferState> {
  debounceMs: number;
  loadState: () => TState | null;
  updateCounts: (commentCount: number, raidCount: number) => TState | null;
}

export class StreamSummaryCountBuffer<TState extends StreamSummaryCountBufferState> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingCommentCount: number | null = null;

  constructor(private readonly options: StreamSummaryCountBufferOptions<TState>) {}

  recordCommentCount(commentCount: number): void {
    this.pendingCommentCount = commentCount;
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.options.debounceMs);
  }

  incrementRaidCount(commentCount: number): TState | null {
    this.clearTimer();
    const state = this.loadWritableState();
    if (!state) return state;

    this.pendingCommentCount = null;
    return this.options.updateCounts(commentCount, state.raidCount + 1);
  }

  flush(): TState | null {
    this.clearTimer();
    if (this.pendingCommentCount === null) return null;

    const commentCount = this.pendingCommentCount;
    this.pendingCommentCount = null;

    const state = this.loadWritableState();
    if (!state) return state;
    if (state.commentCount === commentCount) return state;

    return this.options.updateCounts(commentCount, state.raidCount);
  }

  cancel(): void {
    this.clearTimer();
    this.pendingCommentCount = null;
  }

  private loadWritableState(): TState | null {
    const state = this.options.loadState();
    if (!state || state.status === "posted") return null;
    return state;
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
