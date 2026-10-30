import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RECOMMENDATION_TARGETS,
  PeriodicRecommendationNotifier,
} from "../../src/notifications/periodic-recommendation-notifier";

describe("PeriodicRecommendationNotifier", () => {
  it("keeps every default recommendation URL-backed", () => {
    expect(DEFAULT_RECOMMENDATION_TARGETS).toHaveLength(3);
    expect(DEFAULT_RECOMMENDATION_TARGETS[0]).toBe(
      "るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
    expect(DEFAULT_RECOMMENDATION_TARGETS[1]).toBe(
      "るっかるんのグッズはこちら！→ https://rukalun.booth.pm"
    );
    expect(DEFAULT_RECOMMENDATION_TARGETS[2]).toBe(
      "るっかるんのYouTubeもチャンネル登録してね！→ https://is.gd/rukalunyt"
    );
    for (const target of DEFAULT_RECOMMENDATION_TARGETS) {
      expect(target).toMatch(/^るっかるん/);
    }
  });

  it("waits for the configured interval before sending", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 3600,
      initialStreamStartedAt: 100,
    });

    const sent = await notifier.notifyIfReady(3699, sender);

    expect(sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });

  it("adds elapsed stream hours and rotates recommendations after each successful send", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 3600,
      initialStreamStartedAt: 100,
    });

    await expect(notifier.notifyIfReady(3700, sender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(7300, sender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(10900, sender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(14500, sender)).resolves.toBe(true);

    expect(sender).toHaveBeenNthCalledWith(
      1,
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
    expect(sender).toHaveBeenNthCalledWith(
      2,
      "【定期】配信開始から2時間経過しました。るっかるんのグッズはこちら！→ https://rukalun.booth.pm"
    );
    expect(sender).toHaveBeenNthCalledWith(
      3,
      "【定期】配信開始から3時間経過しました。るっかるんのYouTubeもチャンネル登録してね！→ https://is.gd/rukalunyt"
    );
    expect(sender).toHaveBeenNthCalledWith(
      4,
      "【定期】配信開始から4時間経過しました。るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
    for (const call of sender.mock.calls) {
      expect(call[0]).toMatch(/^【定期】/);
      expect(call[0]).not.toMatch(/^!/);
    }
  });

  it("does not advance the rotation when chat sending fails", async () => {
    const sender = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("chat down"));
    const retrySender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    await expect(notifier.notifyIfReady(160, sender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(220, sender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(280, sender)).rejects.toThrow("chat down");
    await expect(notifier.notifyIfReady(281, retrySender)).resolves.toBe(true);

    expect(retrySender).toHaveBeenCalledWith(
      expect.stringContaining(
        "YouTubeもチャンネル登録してね！→ https://is.gd/rukalunyt"
      )
    );
  });

  it("does not start another send while the previous send is still pending", async () => {
    let resolveSend: (() => void) | null = null;
    const sender = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    const firstSend = notifier.notifyIfReady(160, sender);
    await Promise.resolve();
    const testSend = await notifier.sendTest(vi.fn());
    const secondSend = await notifier.notifyIfReady(220, sender);

    expect(testSend).toBe(false);
    expect(secondSend).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);

    resolveSend?.();
    await expect(firstSend).resolves.toBe(true);
  });

  it("sends every recommendation immediately for an admin test without changing the schedule", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: false,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    await expect(notifier.sendTest(sender)).resolves.toBe(true);

    expect(sender.mock.calls.map((call) => call[0])).toEqual([
      "【定期】るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/",
      "【定期】るっかるんのグッズはこちら！→ https://rukalun.booth.pm",
      "【定期】るっかるんのYouTubeもチャンネル登録してね！→ https://is.gd/rukalunyt",
    ]);

    const scheduledSender = vi.fn().mockResolvedValue(undefined);
    await expect(notifier.notifyIfReady(160, scheduledSender)).resolves.toBe(
      false
    );
    notifier.reset(100);
    await expect(notifier.notifyIfReady(160, scheduledSender)).resolves.toBe(
      false
    );
  });

  it("keeps the regular rotation and next send time unchanged after a test", async () => {
    const testSender = vi.fn().mockResolvedValue(undefined);
    const scheduledSender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    await expect(notifier.sendTest(testSender)).resolves.toBe(true);
    await expect(notifier.notifyIfReady(159, scheduledSender)).resolves.toBe(
      false
    );
    await expect(notifier.notifyIfReady(160, scheduledSender)).resolves.toBe(
      true
    );

    expect(scheduledSender).toHaveBeenCalledWith(
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
  });

  it("prevents overlapping regular and test sends and unlocks after a failure", async () => {
    let resolveSend: (() => void) | null = null;
    const pendingSender = vi
      .fn()
      .mockImplementationOnce(
        () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
      )
      .mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    const pendingTest = notifier.sendTest(pendingSender);
    await Promise.resolve();
    await expect(notifier.sendTest(vi.fn())).resolves.toBe(false);
    await expect(notifier.notifyIfReady(160, vi.fn())).resolves.toBe(false);
    resolveSend?.();
    await expect(pendingTest).resolves.toBe(true);

    const failingSender = vi.fn().mockRejectedValue(new Error("chat down"));
    await expect(notifier.sendTest(failingSender)).rejects.toThrow("chat down");

    const retrySender = vi.fn().mockResolvedValue(undefined);
    await expect(notifier.sendTest(retrySender)).resolves.toBe(true);
    expect(retrySender).toHaveBeenCalledTimes(3);
  });

  it("can reset the stream baseline without changing the next message", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 0,
    });

    notifier.reset(300);
    expect(await notifier.notifyIfReady(359, sender)).toBe(false);
    expect(await notifier.notifyIfReady(360, sender)).toBe(true);

    expect(sender).toHaveBeenCalledWith(
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
  });

  it("realigns a resumed stream without sending catch-up recommendations", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 3600,
      initialStreamStartedAt: 0,
    });

    notifier.reset(100, 5500);
    expect(await notifier.notifyIfReady(7299, sender)).toBe(false);
    expect(await notifier.notifyIfReady(7300, sender)).toBe(true);

    expect(sender).toHaveBeenCalledWith(
      "【定期】配信開始から2時間経過しました。るっかるんのClip検索サイトはこちら！→ https://rukalun-page.vercel.app/"
    );
  });

  it("does not send when disabled", async () => {
    const sender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: false,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    const sent = await notifier.notifyIfReady(999, sender);

    expect(sent).toBe(false);
    expect(sender).not.toHaveBeenCalled();
  });
});
