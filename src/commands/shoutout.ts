import type { ApiClient } from "@twurple/api";

interface SendShoutoutParams {
  broadcasterId: string;
  moderatorUserId: string;
  targetUsername: string;
}

type ShoutoutQueueEventType = "sent" | "not-found" | "rate-limited" | "failed";

export interface ShoutoutQueueEvent {
  type: ShoutoutQueueEventType;
  targetUsername: string;
  error?: unknown;
}

interface ShoutoutQueueItem {
  targetUsername: string;
}

export interface ShoutoutQueueOptions {
  send: (targetUsername: string) => Promise<boolean>;
  cooldownMs?: number;
  onEvent?: (event: ShoutoutQueueEvent) => void;
}

export interface ShoutoutQueueEnqueueResult {
  targetUsername: string;
  queueSize: number;
}

const DEFAULT_SHOUTOUT_COOLDOWN_MS = 120_000;

/**
 * shoutoutコマンドの管理者判定
 */
export function isShoutoutAdmin(
  userName: string | undefined,
  adminUsers: string[],
  isMod: boolean,
  isBroadcaster: boolean
): boolean {
  if (isBroadcaster) return true;
  if (isMod) return true;
  if (userName && adminUsers.includes(userName.toLowerCase())) return true;
  return false;
}

/**
 * `!shoutout @name` / `!shoutout name` の対象ログイン名を正規化する。
 */
export function normalizeShoutoutTarget(rawTarget: string | undefined): string | null {
  const normalized = (rawTarget ?? "").trim().replace(/^@+/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function isShoutoutRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return String(error).includes("429");
  }

  const record = error as Record<string, unknown>;
  const statusCode = record["statusCode"] ?? record["status"];
  if (statusCode === 429 || statusCode === "429") return true;

  const message = String(record["message"] ?? error);
  return message.includes("429") || message.includes("Too Many Requests");
}

export class ShoutoutQueue {
  private readonly send: (targetUsername: string) => Promise<boolean>;
  private readonly cooldownMs: number;
  private readonly onEvent?: (event: ShoutoutQueueEvent) => void;
  private readonly queue: ShoutoutQueueItem[] = [];
  private processing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ShoutoutQueueOptions) {
    this.send = options.send;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_SHOUTOUT_COOLDOWN_MS;
    this.onEvent = options.onEvent;
  }

  enqueue(rawTargetUsername: string): ShoutoutQueueEnqueueResult | null {
    const targetUsername = normalizeShoutoutTarget(rawTargetUsername);
    if (!targetUsername) return null;

    this.queue.push({ targetUsername });
    if (!this.processing && !this.timer) {
      this.scheduleNext(0);
    }

    return {
      targetUsername,
      queueSize: this.queue.length,
    };
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processNext();
    }, delayMs);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;

    const item = this.queue.shift();
    if (!item) return;

    this.processing = true;
    try {
      const sent = await this.send(item.targetUsername);
      this.emit({
        type: sent ? "sent" : "not-found",
        targetUsername: item.targetUsername,
      });
    } catch (error) {
      if (isShoutoutRateLimitError(error)) {
        this.queue.unshift(item);
        this.emit({
          type: "rate-limited",
          targetUsername: item.targetUsername,
          error,
        });
      } else {
        this.emit({
          type: "failed",
          targetUsername: item.targetUsername,
          error,
        });
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.scheduleNext(this.cooldownMs);
      }
    }
  }

  private emit(event: ShoutoutQueueEvent): void {
    this.onEvent?.(event);
  }
}

/**
 * レイド元ユーザーへシャウトアウトを送信する。
 *
 * Twurple の shoutoutUser はデフォルトで broadcaster のユーザーコンテキストを
 * 探すため、Bot/Moderator の登録済みコンテキストへ明示的に切り替えて実行する。
 */
export async function sendShoutout(
  apiClient: ApiClient,
  params: SendShoutoutParams
): Promise<boolean> {
  const user = await apiClient.users.getUserByName(params.targetUsername);
  if (!user) return false;

  await apiClient.asUser(params.moderatorUserId, async (ctx) => {
    await ctx.chat.shoutoutUser(params.broadcasterId, user.id);
  });

  return true;
}
