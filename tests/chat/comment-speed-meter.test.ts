import { describe, it, expect, beforeEach } from "vitest";
import { CommentSpeedMeter } from "../../src/chat/comment-speed-meter";

describe("CommentSpeedMeter", () => {
  let meter: CommentSpeedMeter;
  const BASE_TIME = 1_000_000;

  beforeEach(() => {
    meter = new CommentSpeedMeter(60);
  });

  describe("record / count", () => {
    it("records a comment and count returns 1 within window", () => {
      meter.record(BASE_TIME);
      expect(meter.count(BASE_TIME)).toBe(1);
    });

    it("returns 0 count when no comments recorded", () => {
      expect(meter.count(BASE_TIME)).toBe(0);
    });

    it("excludes timestamps older than windowSeconds from count", () => {
      meter.record(BASE_TIME);
      expect(meter.count(BASE_TIME + 61)).toBe(0);
    });

    it("keeps timestamps within windowSeconds in count", () => {
      meter.record(BASE_TIME);
      expect(meter.count(BASE_TIME + 59)).toBe(1);
    });

    it("counts only comments within sliding window", () => {
      meter.record(BASE_TIME);       // 89秒前 → ウィンドウ外（>=60秒前）
      meter.record(BASE_TIME + 30);  // 59秒前 → ウィンドウ内
      meter.record(BASE_TIME + 50);  // 39秒前 → ウィンドウ内
      expect(meter.count(BASE_TIME + 89)).toBe(2);
    });

    it("keeps exact window boundaries after a high-volume rolling workload", () => {
      const highVolumeMeter = new CommentSpeedMeter(60);
      for (let index = 0; index < 200_000; index += 1) {
        highVolumeMeter.record(index / 1_000);
      }

      expect(highVolumeMeter.count(199.999)).toBe(60_001);
      expect(highVolumeMeter.count(260)).toBe(0);
      expect(highVolumeMeter.totalCount()).toBe(200_000);
    });
  });

  describe("totalCount", () => {
    it("increments totalCount on each record", () => {
      meter.record(BASE_TIME);
      meter.record(BASE_TIME + 70);
      expect(meter.totalCount()).toBe(2);
    });

    it("totalCount is not affected by sliding window pruning", () => {
      meter.record(BASE_TIME);
      meter.count(BASE_TIME + 3600);
      expect(meter.totalCount()).toBe(1);
    });
  });

  describe("ratePerMinute", () => {
    it("returns rate of 60 when 60 comments in 60-second window", () => {
      for (let i = 0; i < 60; i++) {
        meter.record(BASE_TIME + i);
      }
      expect(meter.ratePerMinute(BASE_TIME + 59)).toBe(60);
    });

    it("returns 0 when no comments in window", () => {
      expect(meter.ratePerMinute(BASE_TIME)).toBe(0);
    });
  });

  describe("totalRatePerMinute", () => {
    it("returns 0 when stream not started", () => {
      meter.record(BASE_TIME);
      expect(meter.totalRatePerMinute(BASE_TIME + 60)).toBe(0);
    });

    it("calculates correct rate after stream start", () => {
      meter.startStream(BASE_TIME);
      meter.record(BASE_TIME + 30);
      meter.record(BASE_TIME + 60);
      expect(meter.totalRatePerMinute(BASE_TIME + 120)).toBe(1);
    });

    it("returns 0 when elapsed is 0", () => {
      meter.startStream(BASE_TIME);
      meter.record(BASE_TIME);
      expect(meter.totalRatePerMinute(BASE_TIME)).toBe(0);
    });
  });

  describe("startStream / resetStream", () => {
    it("startStream resets totalCount and timestamps", () => {
      meter.record(BASE_TIME);
      meter.startStream(BASE_TIME + 100);
      expect(meter.totalCount()).toBe(0);
      expect(meter.count(BASE_TIME + 100)).toBe(0);
    });

    it("resetStream sets streamStartedAt to null", () => {
      meter.startStream(BASE_TIME);
      meter.resetStream();
      expect(meter.streamStartedAt()).toBeNull();
    });

    it("resetStream resets totalCount", () => {
      meter.record(BASE_TIME);
      meter.resetStream();
      expect(meter.totalCount()).toBe(0);
    });
  });

  describe("setState", () => {
    it("restores streamStartedAt and totalCount", () => {
      meter.setState(BASE_TIME, 42);
      expect(meter.streamStartedAt()).toBe(BASE_TIME);
      expect(meter.totalCount()).toBe(42);
    });

    it("treats streamStartedAt of 0 as null", () => {
      meter.setState(0, 0);
      expect(meter.streamStartedAt()).toBeNull();
    });
  });

  describe("ensureStreamStarted", () => {
    it("sets streamStartedAt when not started", () => {
      meter.ensureStreamStarted(BASE_TIME);
      expect(meter.streamStartedAt()).toBe(BASE_TIME);
    });

    it("does not overwrite an existing streamStartedAt", () => {
      meter.startStream(BASE_TIME);
      meter.ensureStreamStarted(BASE_TIME + 100);
      expect(meter.streamStartedAt()).toBe(BASE_TIME);
    });
  });
});
