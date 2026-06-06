import { describe, expect, it, vi } from "vitest";
import {
  StreamSummaryCountBuffer,
  type StreamSummaryCountBufferState,
} from "../../src/streams/stream-summary-count-buffer";

const activeState: StreamSummaryCountBufferState = {
  status: "active",
  commentCount: 10,
  raidCount: 2,
};

describe("StreamSummaryCountBuffer", () => {
  it("debounces comment count updates and preserves the current raid count", () => {
    vi.useFakeTimers();
    const updateCounts = vi.fn();
    const buffer = new StreamSummaryCountBuffer({
      debounceMs: 30_000,
      loadState: () => activeState,
      updateCounts,
    });

    buffer.recordCommentCount(11);
    buffer.recordCommentCount(12);
    buffer.recordCommentCount(13);

    expect(updateCounts).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(updateCounts).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(updateCounts).toHaveBeenCalledTimes(1);
    expect(updateCounts).toHaveBeenCalledWith(13, 2);

    vi.useRealTimers();
  });

  it("flushes a pending comment update immediately when requested", () => {
    vi.useFakeTimers();
    const updateCounts = vi.fn();
    const buffer = new StreamSummaryCountBuffer({
      debounceMs: 30_000,
      loadState: () => activeState,
      updateCounts,
    });

    buffer.recordCommentCount(14);
    buffer.flush();

    expect(updateCounts).toHaveBeenCalledTimes(1);
    expect(updateCounts).toHaveBeenCalledWith(14, 2);

    vi.advanceTimersByTime(30_000);
    expect(updateCounts).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("increments raid count immediately and includes pending comment count", () => {
    vi.useFakeTimers();
    let currentState = { ...activeState };
    const updateCounts = vi.fn((commentCount: number, raidCount: number) => {
      currentState = { ...currentState, commentCount, raidCount };
      return currentState;
    });
    const buffer = new StreamSummaryCountBuffer({
      debounceMs: 30_000,
      loadState: () => currentState,
      updateCounts,
    });

    buffer.recordCommentCount(15);
    buffer.incrementRaidCount(16);

    expect(updateCounts).toHaveBeenCalledTimes(1);
    expect(updateCounts).toHaveBeenCalledWith(16, 3);

    vi.advanceTimersByTime(30_000);
    expect(updateCounts).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("does not write when there is no active or pending state", () => {
    vi.useFakeTimers();
    const updateCounts = vi.fn();
    const buffer = new StreamSummaryCountBuffer({
      debounceMs: 30_000,
      loadState: () => null,
      updateCounts,
    });

    buffer.recordCommentCount(20);
    buffer.incrementRaidCount(20);
    buffer.flush();
    vi.advanceTimersByTime(30_000);

    expect(updateCounts).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("does not write posted state", () => {
    vi.useFakeTimers();
    const updateCounts = vi.fn();
    const buffer = new StreamSummaryCountBuffer({
      debounceMs: 30_000,
      loadState: () => ({
        ...activeState,
        status: "posted",
      }),
      updateCounts,
    });

    buffer.recordCommentCount(20);
    buffer.incrementRaidCount(20);
    buffer.flush();
    vi.advanceTimersByTime(30_000);

    expect(updateCounts).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
