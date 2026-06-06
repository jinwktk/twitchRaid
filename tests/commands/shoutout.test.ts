import { describe, expect, it, vi } from "vitest";
import {
  ShoutoutQueue,
  isShoutoutRateLimitError,
  isShoutoutAdmin,
  normalizeShoutoutTarget,
  sendShoutout,
} from "../../src/commands/shoutout";

describe("sendShoutout", () => {
  it("executes shoutout in the moderator user context", async () => {
    const getUserByName = vi.fn().mockResolvedValue({ id: "raider-id" });
    const shoutoutUser = vi.fn().mockResolvedValue(undefined);
    const asUser = vi.fn(async (userId: string, runner: (ctx: unknown) => Promise<void>) => {
      await runner({
        chat: { shoutoutUser },
      });
      return undefined;
    });

    await sendShoutout(
      {
        users: { getUserByName },
        asUser,
      },
      {
        broadcasterId: "broadcaster-id",
        moderatorUserId: "bot-user-id",
        targetUsername: "yunma_flw",
      }
    );

    expect(getUserByName).toHaveBeenCalledWith("yunma_flw");
    expect(asUser).toHaveBeenCalledWith("bot-user-id", expect.any(Function));
    expect(shoutoutUser).toHaveBeenCalledWith("broadcaster-id", "raider-id");
  });

  it("skips API shoutout when the raid user cannot be resolved", async () => {
    const shoutoutUser = vi.fn();
    const asUser = vi.fn();

    await sendShoutout(
      {
        users: { getUserByName: vi.fn().mockResolvedValue(null) },
        asUser,
      },
      {
        broadcasterId: "broadcaster-id",
        moderatorUserId: "bot-user-id",
        targetUsername: "missing_user",
      }
    );

    expect(asUser).not.toHaveBeenCalled();
    expect(shoutoutUser).not.toHaveBeenCalled();
  });
});

describe("isShoutoutAdmin", () => {
  it("allows broadcaster", () => {
    expect(isShoutoutAdmin("viewer", [], false, true)).toBe(true);
  });

  it("allows moderators", () => {
    expect(isShoutoutAdmin("viewer", [], true, false)).toBe(true);
  });

  it("allows configured admin users case-insensitively", () => {
    expect(isShoutoutAdmin("RukaLun", ["rukalun"], false, false)).toBe(true);
  });

  it("denies regular users", () => {
    expect(isShoutoutAdmin("viewer", ["rukalun"], false, false)).toBe(false);
  });
});

describe("normalizeShoutoutTarget", () => {
  it("removes leading at mark and lowercases login names", () => {
    expect(normalizeShoutoutTarget("@YuriiChinya")).toBe("yuriichinya");
  });

  it("returns null for empty target", () => {
    expect(normalizeShoutoutTarget(" @ ")).toBeNull();
  });
});

describe("isShoutoutRateLimitError", () => {
  it("detects Twurple HTTP 429 errors", () => {
    expect(
      isShoutoutRateLimitError({
        statusCode: 429,
        message: "Encountered HTTP status code 429: Too Many Requests",
      })
    ).toBe(true);
  });

  it("does not treat non-429 errors as shoutout cooldown", () => {
    expect(
      isShoutoutRateLimitError({
        statusCode: 500,
        message: "Internal Server Error",
      })
    ).toBe(false);
  });
});

describe("ShoutoutQueue", () => {
  it("sends the first shoutout immediately and queues the next one for cooldown", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(true);
    const queue = new ShoutoutQueue({
      send,
      cooldownMs: 120_000,
    });

    queue.enqueue("raider_a");
    queue.enqueue("raider_b");
    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("raider_a");

    await vi.advanceTimersByTimeAsync(119_999);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("raider_b");
    vi.useRealTimers();
  });

  it("requeues the same shoutout two minutes later when Twitch returns 429", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Encountered HTTP status code 429: Too Many Requests")
      )
      .mockResolvedValueOnce(true);
    const events: string[] = [];
    const queue = new ShoutoutQueue({
      send,
      cooldownMs: 120_000,
      onEvent: (event) => events.push(event.type),
    });

    queue.enqueue("raider_a");
    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledTimes(1);
    expect(events).toContain("rate-limited");

    await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("raider_a");
    expect(events).toContain("sent");
    vi.useRealTimers();
  });

  it("does not retry non-rate-limit shoutout failures", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue(new Error("Forbidden"));
    const events: string[] = [];
    const queue = new ShoutoutQueue({
      send,
      cooldownMs: 120_000,
      onEvent: (event) => events.push(event.type),
    });

    queue.enqueue("raider_a");
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(events).toContain("failed");
    vi.useRealTimers();
  });
});
