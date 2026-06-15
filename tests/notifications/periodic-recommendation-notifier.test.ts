import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RECOMMENDATION_TARGETS,
  PeriodicRecommendationNotifier,
} from "../../src/notifications/periodic-recommendation-notifier";

describe("PeriodicRecommendationNotifier", () => {
  it("keeps every default recommendation URL-backed", () => {
    expect(DEFAULT_RECOMMENDATION_TARGETS).toHaveLength(2);
    expect(DEFAULT_RECOMMENDATION_TARGETS[0]).toBe(
      "るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
    );
    expect(DEFAULT_RECOMMENDATION_TARGETS[1]).toBe(
      "るっかるんのグッズはこちら！→ https://rukalun.booth.pm"
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

    expect(sender).toHaveBeenNthCalledWith(
      1,
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
    );
    expect(sender).toHaveBeenNthCalledWith(
      2,
      "【定期】配信開始から2時間経過しました。るっかるんのグッズはこちら！→ https://rukalun.booth.pm"
    );
    for (const call of sender.mock.calls) {
      expect(call[0]).toMatch(/^【定期】/);
      expect(call[0]).not.toMatch(/^!/);
    }
  });

  it("does not advance the rotation when chat sending fails", async () => {
    const failingSender = vi.fn().mockRejectedValue(new Error("chat down"));
    const retrySender = vi.fn().mockResolvedValue(undefined);
    const notifier = new PeriodicRecommendationNotifier({
      enabled: true,
      intervalSeconds: 60,
      initialStreamStartedAt: 100,
    });

    await expect(notifier.notifyIfReady(160, failingSender)).rejects.toThrow(
      "chat down"
    );
    await expect(notifier.notifyIfReady(161, retrySender)).resolves.toBe(true);

    expect(retrySender).toHaveBeenCalledWith(
      expect.stringContaining("https://www.rukalun.mydns.jp")
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
    const secondSend = await notifier.notifyIfReady(220, sender);

    expect(secondSend).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);

    resolveSend?.();
    await expect(firstSend).resolves.toBe(true);
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
      "【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
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
      "【定期】配信開始から2時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp"
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
