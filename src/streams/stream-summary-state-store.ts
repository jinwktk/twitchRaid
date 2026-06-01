import fs from "fs";
import path from "path";

export type StreamSummaryStatus = "active" | "pending" | "posted";

export interface StreamSummaryState {
  status: StreamSummaryStatus;
  streamId: string;
  title: string;
  gameName: string | null;
  startedAt: string;
  endedAt?: string;
  streamUrl: string;
  commentCount: number;
  raidCount: number;
  summaryMessageId?: string;
  threadId?: string;
  postedClipIds: string[];
  postedAt?: string;
}

export interface MarkPostedParams {
  summaryMessageId?: string;
  threadId?: string;
  postedClipIds: string[];
  postedAt: string;
}

export class StreamSummaryStateStore {
  constructor(private readonly filePath: string) {}

  load(): StreamSummaryState | null {
    if (!fs.existsSync(this.filePath)) return null;

    const raw = fs.readFileSync(this.filePath, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as StreamSummaryState;
  }

  save(state: StreamSummaryState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmpPath, this.filePath);
  }

  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.rmSync(this.filePath, { force: true });
    }
  }

  markPending(endedAt: string): StreamSummaryState | null {
    const state = this.load();
    if (!state) return null;

    const pending: StreamSummaryState = {
      ...state,
      status: "pending",
      endedAt,
      postedClipIds: state.postedClipIds ?? [],
    };
    this.save(pending);
    return pending;
  }

  markPosted(params: MarkPostedParams): StreamSummaryState | null {
    const state = this.load();
    if (!state) return null;

    const posted: StreamSummaryState = {
      ...state,
      status: "posted",
      summaryMessageId: params.summaryMessageId ?? state.summaryMessageId,
      threadId: params.threadId ?? state.threadId,
      postedClipIds: [...params.postedClipIds],
      postedAt: params.postedAt,
    };
    this.save(posted);
    return posted;
  }

  updateCounts(commentCount: number, raidCount: number): StreamSummaryState | null {
    const state = this.load();
    if (!state || state.status === "posted") return state;

    const updated = { ...state, commentCount, raidCount };
    this.save(updated);
    return updated;
  }
}
