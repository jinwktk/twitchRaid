import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StreamSummaryStateStore,
  type StreamSummaryState,
} from "../../src/streams/stream-summary-state-store";

const activeState: StreamSummaryState = {
  status: "active",
  streamId: "stream-1",
  title: "回変り金み",
  gameName: "Just Chatting",
  startedAt: "2026-06-01T10:00:00.000Z",
  streamUrl: "https://www.twitch.tv/rukalun",
  commentCount: 12,
  raidCount: 1,
  postedClipIds: [],
};

describe("StreamSummaryStateStore", () => {
  let tmpDir: string;
  let store: StreamSummaryStateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stream-summary-"));
    store = new StreamSummaryStateStore(path.join(tmpDir, "summary.json"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads active stream summary state", () => {
    store.save(activeState);

    expect(store.load()).toEqual(activeState);
  });

  it("marks an active stream as pending after restart-safe end detection", () => {
    store.save(activeState);

    const pending = store.markPending("2026-06-01T11:14:00.000Z");

    expect(pending?.status).toBe("pending");
    expect(pending?.endedAt).toBe("2026-06-01T11:14:00.000Z");
    expect(store.load()).toEqual(pending);
  });

  it("keeps posted clip ids when marking summary posted", () => {
    store.save({
      ...activeState,
      status: "pending",
      endedAt: "2026-06-01T11:14:00.000Z",
    });

    const posted = store.markPosted({
      summaryMessageId: "message-id",
      threadId: "thread-id",
      postedClipIds: ["clip-a", "clip-b"],
      postedAt: "2026-06-01T11:15:00.000Z",
    });

    expect(posted?.status).toBe("posted");
    expect(posted?.summaryMessageId).toBe("message-id");
    expect(posted?.threadId).toBe("thread-id");
    expect(posted?.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });
});
