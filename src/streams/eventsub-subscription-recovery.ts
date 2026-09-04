const SUBSCRIPTION_CONDITION_LIMIT_MESSAGE =
  "maximum subscriptions with type and condition exceeded";
const TARGET_STREAM_EVENT_TYPES = ["stream.online", "stream.offline"] as const;

export interface EventSubSubscriptionRecoveryRecord {
  id: string;
  type: string;
  status: string;
  condition: Record<string, unknown>;
  transportMethod: string;
}

export interface EventSubSubscriptionRecoveryApi {
  getSubscriptionsForType(
    type: string
  ): Promise<readonly EventSubSubscriptionRecoveryRecord[]>;
  deleteSubscription(id: string): Promise<void>;
}

export interface EventSubSubscriptionRecoveryResult {
  deletedSubscriptionCount: number;
}

class EventSubSubscriptionRecoveryError extends Error {
  constructor(code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "EventSubSubscriptionRecoveryError";
  }
}

export function isEventSubSubscriptionLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const record = error as Record<string, unknown>;
  const statusCode = record["statusCode"] ?? record["status"];
  if (statusCode !== 429 && statusCode !== "429") return false;

  return String(record["message"] ?? "")
    .toLowerCase()
    .includes(SUBSCRIPTION_CONDITION_LIMIT_MESSAGE);
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const statusCode = record["statusCode"] ?? record["status"];
  return statusCode === 404 || statusCode === "404";
}

function isExactTargetSubscription(
  subscription: EventSubSubscriptionRecoveryRecord,
  broadcasterId: string
): boolean {
  return (
    (subscription.type === "stream.online" ||
      subscription.type === "stream.offline") &&
    subscription.status === "enabled" &&
    subscription.transportMethod === "websocket" &&
    subscription.condition["broadcaster_user_id"] === broadcasterId
  );
}

async function listTargetSubscriptions(
  api: EventSubSubscriptionRecoveryApi,
  broadcasterId: string,
  phase: "initial" | "verification"
): Promise<EventSubSubscriptionRecoveryRecord[]> {
  const results = await Promise.allSettled(
    TARGET_STREAM_EVENT_TYPES.map((type) => api.getSubscriptionsForType(type))
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failed) {
    throw new EventSubSubscriptionRecoveryError(
      `${phase}-list-failed`,
      failed.reason
    );
  }

  return results
    .flatMap((result) =>
      result.status === "fulfilled" ? [...result.value] : []
    )
    .filter((subscription) =>
      isExactTargetSubscription(subscription, broadcasterId)
    );
}

export async function reconcileStreamEventSubSubscriptions(
  api: EventSubSubscriptionRecoveryApi,
  broadcasterId: string
): Promise<EventSubSubscriptionRecoveryResult> {
  const subscriptions = await listTargetSubscriptions(
    api,
    broadcasterId,
    "initial"
  );
  const subscriptionIds = [
    ...new Set(
      subscriptions
        .map((subscription) => subscription.id)
        .filter((id) => id.length > 0)
    ),
  ];

  const deleteResults = await Promise.allSettled(
    subscriptionIds.map((id) => api.deleteSubscription(id))
  );
  const failedDelete = deleteResults.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected" && !isNotFoundError(result.reason)
  );
  if (failedDelete) {
    throw new EventSubSubscriptionRecoveryError(
      "delete-failed",
      failedDelete.reason
    );
  }

  const remainingSubscriptions = await listTargetSubscriptions(
    api,
    broadcasterId,
    "verification"
  );
  if (remainingSubscriptions.length > 0) {
    throw new EventSubSubscriptionRecoveryError("verification-not-empty");
  }

  return { deletedSubscriptionCount: subscriptionIds.length };
}
