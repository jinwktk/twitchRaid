import { describe, expect, it, vi } from "vitest";
import {
  isEventSubSubscriptionLimitError,
  reconcileStreamEventSubSubscriptions,
  type EventSubSubscriptionRecoveryApi,
  type EventSubSubscriptionRecoveryRecord,
} from "../../src/streams/eventsub-subscription-recovery";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function subscription(
  id: string,
  overrides: Partial<EventSubSubscriptionRecoveryRecord> = {}
): EventSubSubscriptionRecoveryRecord {
  return {
    id,
    type: "stream.online",
    status: "enabled",
    condition: { broadcaster_user_id: "broadcaster-id" },
    transportMethod: "websocket",
    ...overrides,
  };
}

describe("isEventSubSubscriptionLimitError", () => {
  it("accepts only the exact subscription-condition limit response", () => {
    expect(
      isEventSubSubscriptionLimitError({
        statusCode: 429,
        message:
          "Encountered HTTP status code 429: Too Many Requests\nBody: maximum subscriptions with type and condition exceeded",
      })
    ).toBe(true);

    expect(
      isEventSubSubscriptionLimitError({
        statusCode: 429,
        message: "Encountered HTTP status code 429: Too Many Requests",
      })
    ).toBe(false);
    expect(
      isEventSubSubscriptionLimitError({
        statusCode: 500,
        message: "maximum subscriptions with type and condition exceeded",
      })
    ).toBe(false);
    expect(
      isEventSubSubscriptionLimitError(
        new Error("maximum subscriptions with type and condition exceeded")
      )
    ).toBe(false);
    expect(isEventSubSubscriptionLimitError("429")).toBe(false);
  });
});

describe("reconcileStreamEventSubSubscriptions", () => {
  it("lists both types first and deletes each exact enabled WebSocket ID once", async () => {
    const calls: string[] = [];
    const responses: Record<string, EventSubSubscriptionRecoveryRecord[][]> = {
      "stream.online": [
        [
          subscription("shared-id"),
          subscription("other-broadcaster", {
            condition: { broadcaster_user_id: "another-id" },
          }),
          subscription("non-string-broadcaster", {
            condition: { broadcaster_user_id: 123 },
          }),
          subscription("disabled", { status: "websocket_disconnected" }),
          subscription("webhook", { transportMethod: "webhook" }),
          subscription("wrong-type", { type: "channel.update" }),
        ],
        [],
      ],
      "stream.offline": [
        [
          subscription("shared-id", { type: "stream.offline" }),
          subscription("offline-id", { type: "stream.offline" }),
          subscription("conduit", {
            type: "stream.offline",
            transportMethod: "conduit",
          }),
        ],
        [],
      ],
    };
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn(async (type) => {
        calls.push(`list:${type}`);
        return responses[type].shift() ?? [];
      }),
      deleteSubscription: vi.fn(async (id) => {
        calls.push(`delete:${id}`);
      }),
    };

    await expect(
      reconcileStreamEventSubSubscriptions(api, "broadcaster-id")
    ).resolves.toEqual({ deletedSubscriptionCount: 2 });

    expect(calls.slice(0, 2)).toEqual([
      "list:stream.online",
      "list:stream.offline",
    ]);
    expect(api.deleteSubscription).toHaveBeenCalledTimes(2);
    expect(api.deleteSubscription).toHaveBeenCalledWith("shared-id");
    expect(api.deleteSubscription).toHaveBeenCalledWith("offline-id");
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(4);
  });

  it("waits for both initial lists and performs no deletes when either list fails", async () => {
    const offline = deferred<readonly EventSubSubscriptionRecoveryRecord[]>();
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn((type) =>
        type === "stream.online"
          ? Promise.reject(new Error("online-list-failed"))
          : offline.promise
      ),
      deleteSubscription: vi.fn(),
    };
    const attempt = reconcileStreamEventSubSubscriptions(
      api,
      "broadcaster-id"
    );
    let settled = false;
    void attempt.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(api.deleteSubscription).not.toHaveBeenCalled();

    offline.resolve([]);
    await expect(attempt).rejects.toThrow("initial-list-failed");
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(2);
    expect(api.deleteSubscription).not.toHaveBeenCalled();
  });

  it("settles every delete before rejecting a non-404 failure", async () => {
    const secondDelete = deferred<void>();
    let listRound = 0;
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn(async () => {
        listRound++;
        return listRound <= 2
          ? [subscription(listRound === 1 ? "first-id" : "second-id")]
          : [];
      }),
      deleteSubscription: vi.fn((id) =>
        id === "first-id"
          ? Promise.reject(Object.assign(new Error("delete failed"), { statusCode: 500 }))
          : secondDelete.promise
      ),
    };
    const attempt = reconcileStreamEventSubSubscriptions(
      api,
      "broadcaster-id"
    );
    let settled = false;
    void attempt.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );

    await vi.waitFor(() => {
      expect(api.deleteSubscription).toHaveBeenCalledTimes(2);
    });
    expect(settled).toBe(false);

    secondDelete.resolve();
    await expect(attempt).rejects.toThrow("delete-failed");
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(2);
  });

  it("treats delete 404 as success and verifies the remote zero state", async () => {
    let listRound = 0;
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn(async () => {
        listRound++;
        return listRound === 1 ? [subscription("already-gone")] : [];
      }),
      deleteSubscription: vi.fn(async () => {
        throw Object.assign(new Error("not found"), { statusCode: 404 });
      }),
    };

    await expect(
      reconcileStreamEventSubSubscriptions(api, "broadcaster-id")
    ).resolves.toEqual({ deletedSubscriptionCount: 1 });
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(4);
  });

  it("rejects when exact subscriptions remain after deletion", async () => {
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn(async (type) => [
        subscription(`${type}-id`, { type }),
      ]),
      deleteSubscription: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      reconcileStreamEventSubSubscriptions(api, "broadcaster-id")
    ).rejects.toThrow("verification-not-empty");
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(4);
  });

  it("rejects when either verification list fails", async () => {
    let listRound = 0;
    const api: EventSubSubscriptionRecoveryApi = {
      getSubscriptionsForType: vi.fn(async () => {
        listRound++;
        if (listRound === 3) throw new Error("verification failed");
        return [];
      }),
      deleteSubscription: vi.fn(),
    };

    await expect(
      reconcileStreamEventSubSubscriptions(api, "broadcaster-id")
    ).rejects.toThrow("verification-list-failed");
    expect(api.getSubscriptionsForType).toHaveBeenCalledTimes(4);
    expect(api.deleteSubscription).not.toHaveBeenCalled();
  });
});
