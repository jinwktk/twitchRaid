import logger from "../utils/logger";

export interface DiscordAllowedMentions {
  parse?: Array<"roles" | "users" | "everyone">;
  users?: string[];
  roles?: string[];
  replied_user?: boolean;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  author?: {
    name: string;
    icon_url?: string;
    url?: string;
  };
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: {
    text: string;
    icon_url?: string;
  };
}

export interface DiscordMessagePayload {
  content: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
}

export interface DiscordWebhookPayload extends DiscordMessagePayload {
  thread_name?: string;
}

export interface DiscordWebhookMessage {
  id: string;
  channelId: string;
}

export interface DiscordThread {
  id: string;
}

export interface ExecuteDiscordWebhookOptions {
  wait?: boolean;
  threadId?: string;
}

export interface CreateDiscordThreadFromMessageOptions {
  botToken: string;
  channelId: string;
  messageId: string;
  name: string;
  autoArchiveDuration?: number;
}

export interface CloseDiscordThreadOptions {
  botToken: string;
  threadId: string;
}

export interface SendDiscordBotMessageOptions {
  botToken: string;
  channelId: string;
  content: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
}

export interface FindDiscordStreamSummaryHistoryOptions {
  botToken: string;
  channelId: string;
  expectedThreadName: string;
  expectedEmbedTitle: string;
  expectedStreamUrl: string;
  webhookUrl?: string;
}

export interface DiscordStreamSummaryHistoryMatch {
  startMessageId: string;
  threadId?: string;
}

export type DiscordApiRequestOperation = "bot_message" | "thread_create";

export type DiscordApiRequestErrorReason =
  | "rate_limited"
  | "request_failed"
  | "invalid_response";

export interface DiscordApiRequestErrorOptions {
  status?: number;
  retryAfterMs?: number;
}

/**
 * Discord Bot APIの書き込み失敗を、秘密値や応答本文を保持せず上位へ渡す。
 */
export class DiscordApiRequestError extends Error {
  readonly operation: DiscordApiRequestOperation;
  readonly reason: DiscordApiRequestErrorReason;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    operation: DiscordApiRequestOperation,
    reason: DiscordApiRequestErrorReason,
    options: DiscordApiRequestErrorOptions = {}
  ) {
    const statusSuffix = options.status === undefined ? "" : ` (${options.status})`;
    super(`Discord API request failed: ${operation}/${reason}${statusSuffix}`);
    this.name = "DiscordApiRequestError";
    this.operation = operation;
    this.reason = reason;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export type DiscordHistoryLookupErrorReason =
  | "rate_limited"
  | "request_failed"
  | "invalid_response"
  | "pagination_incomplete";

export interface DiscordHistoryLookupErrorOptions {
  status?: number;
  retryAfterMs?: number;
}

export class DiscordHistoryLookupError extends Error {
  readonly reason: DiscordHistoryLookupErrorReason;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    reason: DiscordHistoryLookupErrorReason,
    options: DiscordHistoryLookupErrorOptions = {}
  ) {
    const statusSuffix = options.status === undefined ? "" : ` (${options.status})`;
    super(`Discord history lookup failed: ${reason}${statusSuffix}`);
    this.name = "DiscordHistoryLookupError";
    this.reason = reason;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

interface DiscordHistoryThread {
  id: string;
  parentId: string | null;
  name: string;
  archiveTimestamp?: string;
}

interface DiscordHistoryMessage {
  id: string;
  authorId?: string;
  webhookId?: string;
  embeds: Array<{ title?: string; url?: string }>;
  threadId?: string;
  flags?: number;
}

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_HISTORY_PAGE_SIZE = 100;
const DISCORD_HISTORY_MAX_PAGES = 20;
const DISCORD_MESSAGE_FLAG_HAS_THREAD = 1 << 5;
const DISCORD_NOT_FOUND = Symbol("discord-not-found");

export const DISCORD_API_REQUEST_TIMEOUT_MS = 15_000;
export const DISCORD_HISTORY_LOOKUP_TIMEOUT_MS =
  DISCORD_API_REQUEST_TIMEOUT_MS;

type DiscordJsonResult = unknown | typeof DISCORD_NOT_FOUND;

/**
 * Discord Webhookで通知を送信する
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  message: string
): Promise<void> {
  if (!webhookUrl) {
    logger.warn("⚠️ DISCORD_WEBHOOK_URL が設定されていません。");
    return;
  }

  try {
    await executeDiscordWebhook(webhookUrl, { content: message });
    logger.info("✅ Discord に通知を送信しました");
  } catch (e) {
    logger.error(`❌ Discord Webhook の送信に失敗しました: ${e}`);
  }
}

export async function executeDiscordWebhook(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options: ExecuteDiscordWebhookOptions = {}
): Promise<DiscordWebhookMessage | null> {
  const url = new URL(webhookUrl);
  if (options.wait !== undefined) {
    url.searchParams.set("wait", options.wait ? "true" : "false");
  }
  if (options.threadId) {
    url.searchParams.set("thread_id", options.threadId);
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord Webhook failed: ${response.status}`);
  }

  if (!options.wait) return null;

  const body = (await response.json()) as { id?: string; channel_id?: string };
  if (!body.id || !body.channel_id) return null;

  return {
    id: body.id,
    channelId: body.channel_id,
  };
}

/**
 * 配信開始通知に紐づく既存スレッド、またはスレッド未作成の開始通知を探す。
 * 履歴を最後まで確認できない場合は、重複投稿を避けるため必ず失敗として扱う。
 */
export async function findDiscordStreamSummaryHistory({
  botToken,
  channelId,
  expectedThreadName,
  expectedEmbedTitle,
  expectedStreamUrl,
  webhookUrl,
}: FindDiscordStreamSummaryHistoryOptions): Promise<DiscordStreamSummaryHistoryMatch | null> {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    DISCORD_HISTORY_LOOKUP_TIMEOUT_MS
  );

  try {
    const signal = abortController.signal;
    const encodedChannelId = encodeURIComponent(channelId);
    const channelBody = await fetchDiscordJson(
      `${DISCORD_API_BASE_URL}/channels/${encodedChannelId}`,
      botToken,
      { signal }
    );
    const guildId = readRequiredString(channelBody, "guild_id");

    const activeBody = await fetchDiscordJson(
      `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/threads/active`,
      botToken,
      { signal }
    );
    const activeThreads = readDiscordThreads(activeBody);
    const archivedThreads = await fetchAllPublicArchivedThreads({
      botToken,
      encodedChannelId,
      signal,
    });

    const matchingThreads = deduplicateThreads([
      ...activeThreads,
      ...archivedThreads,
    ])
      .filter(
        (thread) =>
          thread.parentId === channelId && thread.name === expectedThreadName
      )
      .sort(compareDiscordSnowflakesNewestFirst);

    for (const thread of matchingThreads) {
      const starterBody = await fetchDiscordJson(
        `${DISCORD_API_BASE_URL}/channels/${encodedChannelId}/messages/${encodeURIComponent(thread.id)}`,
        botToken,
        { allowNotFound: true, signal }
      );
      if (starterBody === DISCORD_NOT_FOUND) continue;

      const starter = readRecord(starterBody);
      const starterId = readRequiredString(starter, "id");
      const attachedThread = readRecord(starter.thread);
      const attachedThreadId = readRequiredString(attachedThread, "id");
      if (starterId !== thread.id || attachedThreadId !== thread.id) {
        throw new DiscordHistoryLookupError("invalid_response");
      }

      return {
        startMessageId: starterId,
        threadId: attachedThreadId,
      };
    }

    const currentUserBody = await fetchDiscordJson(
      `${DISCORD_API_BASE_URL}/users/@me`,
      botToken,
      { signal }
    );
    const botUserId = readRequiredString(currentUserBody, "id");
    const configuredWebhookId = readConfiguredWebhookId(webhookUrl);

    return await findOrphanStreamStartMessage({
      botToken,
      encodedChannelId,
      botUserId,
      configuredWebhookId,
      expectedEmbedTitle,
      expectedStreamUrl,
      signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllPublicArchivedThreads({
  botToken,
  encodedChannelId,
  signal,
}: {
  botToken: string;
  encodedChannelId: string;
  signal: AbortSignal;
}): Promise<DiscordHistoryThread[]> {
  const threads: DiscordHistoryThread[] = [];
  const seenCursors = new Set<string>();
  let before: string | undefined;

  for (let page = 0; page < DISCORD_HISTORY_MAX_PAGES; page += 1) {
    const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : "";
    const body = await fetchDiscordJson(
      `${DISCORD_API_BASE_URL}/channels/${encodedChannelId}/threads/archived/public?limit=${DISCORD_HISTORY_PAGE_SIZE}${beforeQuery}`,
      botToken,
      { signal }
    );
    const response = readRecord(body);
    const pageThreads = readDiscordThreads(response);
    const hasMore = response.has_more;
    if (typeof hasMore !== "boolean") {
      throw new DiscordHistoryLookupError("invalid_response");
    }

    threads.push(...pageThreads);
    if (!hasMore) return threads;
    if (page === DISCORD_HISTORY_MAX_PAGES - 1) {
      throw new DiscordHistoryLookupError("pagination_incomplete");
    }

    const nextBefore = pageThreads.at(-1)?.archiveTimestamp;
    if (!nextBefore) {
      throw new DiscordHistoryLookupError("pagination_incomplete");
    }
    if (seenCursors.has(nextBefore)) {
      throw new DiscordHistoryLookupError("pagination_incomplete");
    }
    seenCursors.add(nextBefore);
    before = nextBefore;
  }

  throw new DiscordHistoryLookupError("pagination_incomplete");
}

async function findOrphanStreamStartMessage({
  botToken,
  encodedChannelId,
  botUserId,
  configuredWebhookId,
  expectedEmbedTitle,
  expectedStreamUrl,
  signal,
}: {
  botToken: string;
  encodedChannelId: string;
  botUserId: string;
  configuredWebhookId?: string;
  expectedEmbedTitle: string;
  expectedStreamUrl: string;
  signal: AbortSignal;
}): Promise<DiscordStreamSummaryHistoryMatch | null> {
  const seenCursors = new Set<string>();
  let before: string | undefined;

  for (let page = 0; page < DISCORD_HISTORY_MAX_PAGES; page += 1) {
    const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : "";
    const body = await fetchDiscordJson(
      `${DISCORD_API_BASE_URL}/channels/${encodedChannelId}/messages?limit=${DISCORD_HISTORY_PAGE_SIZE}${beforeQuery}`,
      botToken,
      { signal }
    );
    const messages = readDiscordMessages(body);
    const matchingMessage = messages.find((message) => {
      const isOwnedMessage =
        message.authorId === botUserId ||
        (configuredWebhookId !== undefined &&
          message.webhookId === configuredWebhookId);
      const alreadyHasThread =
        Boolean(message.threadId) ||
        ((message.flags ?? 0) & DISCORD_MESSAGE_FLAG_HAS_THREAD) !== 0;
      const hasExactEmbed = message.embeds.some(
        (embed) =>
          embed.title === expectedEmbedTitle && embed.url === expectedStreamUrl
      );
      return isOwnedMessage && !alreadyHasThread && hasExactEmbed;
    });
    if (matchingMessage) {
      return { startMessageId: matchingMessage.id };
    }

    if (messages.length < DISCORD_HISTORY_PAGE_SIZE) return null;
    if (page === DISCORD_HISTORY_MAX_PAGES - 1) {
      throw new DiscordHistoryLookupError("pagination_incomplete");
    }
    const nextBefore = messages.at(-1)?.id;
    if (!nextBefore || seenCursors.has(nextBefore)) {
      throw new DiscordHistoryLookupError("pagination_incomplete");
    }
    seenCursors.add(nextBefore);
    before = nextBefore;
  }

  throw new DiscordHistoryLookupError("pagination_incomplete");
}

function readDiscordThreads(body: unknown): DiscordHistoryThread[] {
  const response = readRecord(body);
  if (!Array.isArray(response.threads)) {
    throw new DiscordHistoryLookupError("invalid_response");
  }

  return response.threads.map((value) => {
    const thread = readRecord(value);
    const id = readRequiredString(thread, "id");
    if (!/^\d+$/.test(id)) {
      throw new DiscordHistoryLookupError("invalid_response");
    }

    const parentId = thread.parent_id;
    if (parentId !== null && typeof parentId !== "string") {
      throw new DiscordHistoryLookupError("invalid_response");
    }
    const name = readRequiredString(thread, "name");

    let archiveTimestamp: string | undefined;
    if (thread.thread_metadata !== undefined) {
      const metadata = readRecord(thread.thread_metadata);
      if (metadata.archive_timestamp !== undefined) {
        if (typeof metadata.archive_timestamp !== "string") {
          throw new DiscordHistoryLookupError("invalid_response");
        }
        archiveTimestamp = metadata.archive_timestamp;
      }
    }

    return { id, parentId, name, archiveTimestamp };
  });
}

function readDiscordMessages(body: unknown): DiscordHistoryMessage[] {
  if (!Array.isArray(body) || body.length > DISCORD_HISTORY_PAGE_SIZE) {
    throw new DiscordHistoryLookupError("invalid_response");
  }

  return body.map((value) => {
    const message = readRecord(value);
    const id = readRequiredString(message, "id");

    let authorId: string | undefined;
    if (message.author !== undefined) {
      const author = readRecord(message.author);
      authorId = readRequiredString(author, "id");
    }

    let webhookId: string | undefined;
    if (message.webhook_id !== undefined) {
      if (typeof message.webhook_id !== "string" || !message.webhook_id) {
        throw new DiscordHistoryLookupError("invalid_response");
      }
      webhookId = message.webhook_id;
    }

    let threadId: string | undefined;
    if (message.thread !== undefined) {
      const thread = readRecord(message.thread);
      threadId = readRequiredString(thread, "id");
    }

    let flags: number | undefined;
    if (message.flags !== undefined) {
      if (
        typeof message.flags !== "number" ||
        !Number.isSafeInteger(message.flags) ||
        message.flags < 0
      ) {
        throw new DiscordHistoryLookupError("invalid_response");
      }
      flags = message.flags;
    }

    if (message.embeds !== undefined && !Array.isArray(message.embeds)) {
      throw new DiscordHistoryLookupError("invalid_response");
    }
    const embeds = (message.embeds ?? []).map((embedValue) => {
      const embed = readRecord(embedValue);
      if (embed.title !== undefined && typeof embed.title !== "string") {
        throw new DiscordHistoryLookupError("invalid_response");
      }
      if (embed.url !== undefined && typeof embed.url !== "string") {
        throw new DiscordHistoryLookupError("invalid_response");
      }
      return {
        title: embed.title as string | undefined,
        url: embed.url as string | undefined,
      };
    });

    return { id, authorId, webhookId, embeds, threadId, flags };
  });
}

function deduplicateThreads(
  threads: DiscordHistoryThread[]
): DiscordHistoryThread[] {
  return [...new Map(threads.map((thread) => [thread.id, thread])).values()];
}

function compareDiscordSnowflakesNewestFirst(
  left: DiscordHistoryThread,
  right: DiscordHistoryThread
): number {
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  if (leftId === rightId) return 0;
  return leftId > rightId ? -1 : 1;
}

function readConfiguredWebhookId(webhookUrl?: string): string | undefined {
  if (!webhookUrl) return undefined;

  let segments: string[];
  try {
    segments = new URL(webhookUrl).pathname.split("/").filter(Boolean);
  } catch {
    throw new DiscordHistoryLookupError("invalid_response");
  }

  const webhooksIndex = segments.lastIndexOf("webhooks");
  const webhookId = segments[webhooksIndex + 1];
  const webhookToken = segments[webhooksIndex + 2];
  if (webhooksIndex < 0 || !webhookId || !webhookToken) {
    throw new DiscordHistoryLookupError("invalid_response");
  }
  return webhookId;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DiscordHistoryLookupError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, key: string): string {
  const record = readRecord(value);
  const result = record[key];
  if (typeof result !== "string" || !result) {
    throw new DiscordHistoryLookupError("invalid_response");
  }
  return result;
}

async function fetchDiscordJson(
  url: string,
  botToken: string,
  options: { allowNotFound?: boolean; signal: AbortSignal }
): Promise<DiscordJsonResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
    });
  } catch {
    throw new DiscordHistoryLookupError("request_failed");
  }

  if (response.status === 429) {
    throw new DiscordHistoryLookupError("rate_limited", {
      status: response.status,
      retryAfterMs: await readDiscordRetryAfterMs(response),
    });
  }
  if (response.status === 404 && options.allowNotFound) {
    return DISCORD_NOT_FOUND;
  }
  if (!response.ok) {
    throw new DiscordHistoryLookupError("request_failed", {
      status: response.status,
    });
  }

  try {
    return await response.json();
  } catch {
    throw new DiscordHistoryLookupError("invalid_response", {
      status: response.status,
    });
  }
}

async function readDiscordRetryAfterMs(
  response: Response
): Promise<number | undefined> {
  let bodyRetryAfterMs: number | undefined;
  try {
    const body = await response.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      bodyRetryAfterMs = secondsToMilliseconds(
        (body as Record<string, unknown>).retry_after
      );
    }
  } catch {
    // Retry-Afterヘッダーを使うため、本文の解析失敗はここでは無視する。
  }
  if (bodyRetryAfterMs !== undefined) return bodyRetryAfterMs;

  return secondsToMilliseconds(response.headers?.get?.("Retry-After"));
}

function secondsToMilliseconds(value: unknown): number | undefined {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(Math.ceil(seconds * 1000), Number.MAX_SAFE_INTEGER);
}

function readOptionalResponseId(
  body: unknown,
  key = "id"
): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

export async function createDiscordThreadFromMessage({
  botToken,
  channelId,
  messageId,
  name,
  autoArchiveDuration = 1440,
}: CreateDiscordThreadFromMessageOptions): Promise<DiscordThread> {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    DISCORD_API_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await fetch(
        `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/threads`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            auto_archive_duration: autoArchiveDuration,
          }),
          signal: abortController.signal,
        }
      );
    } catch {
      throw new DiscordApiRequestError("thread_create", "request_failed");
    }

    if (response.status === 429) {
      throw new DiscordApiRequestError("thread_create", "rate_limited", {
        status: response.status,
        retryAfterMs: await readDiscordRetryAfterMs(response),
      });
    }

    if (!response.ok) {
      const existingThread = await fetchDiscordMessageThread({
        botToken,
        channelId,
        messageId,
        signal: abortController.signal,
      });
      if (existingThread) return existingThread;
      throw new DiscordApiRequestError("thread_create", "request_failed", {
        status: response.status,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new DiscordApiRequestError("thread_create", "invalid_response", {
        status: response.status,
      });
    }
    const threadId = readOptionalResponseId(body);
    if (threadId !== messageId) {
      throw new DiscordApiRequestError("thread_create", "invalid_response", {
        status: response.status,
      });
    }
    return { id: threadId };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDiscordMessageThread({
  botToken,
  channelId,
  messageId,
  signal,
}: Pick<
  CreateDiscordThreadFromMessageOptions,
  "botToken" | "channelId" | "messageId"
> & { signal: AbortSignal }): Promise<DiscordThread | null> {
  let response: Response;
  try {
    response = await fetch(
      `${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        signal,
      }
    );
  } catch {
    throw new DiscordApiRequestError("thread_create", "request_failed");
  }

  if (response.status === 429) {
    throw new DiscordApiRequestError("thread_create", "rate_limited", {
      status: response.status,
      retryAfterMs: await readDiscordRetryAfterMs(response),
    });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DiscordApiRequestError("thread_create", "request_failed", {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DiscordApiRequestError("thread_create", "invalid_response", {
      status: response.status,
    });
  }

  const responseMessageId = readOptionalResponseId(body);
  if (responseMessageId !== messageId) {
    throw new DiscordApiRequestError("thread_create", "invalid_response", {
      status: response.status,
    });
  }

  const record = body as Record<string, unknown>;
  if (record.thread === undefined) return null;
  const threadId = readOptionalResponseId(record.thread);
  if (threadId !== messageId) {
    throw new DiscordApiRequestError("thread_create", "invalid_response", {
      status: response.status,
    });
  }
  return { id: threadId };
}

export async function sendDiscordBotMessage({
  botToken,
  channelId,
  content,
  embeds,
  allowed_mentions,
}: SendDiscordBotMessageOptions): Promise<DiscordWebhookMessage> {
  const payload: DiscordMessagePayload = { content };
  if (allowed_mentions) payload.allowed_mentions = allowed_mentions;
  if (embeds) payload.embeds = embeds;

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    DISCORD_API_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await fetch(
        `${DISCORD_API_BASE_URL}/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        }
      );
    } catch {
      throw new DiscordApiRequestError("bot_message", "request_failed");
    }

    if (response.status === 429) {
      throw new DiscordApiRequestError("bot_message", "rate_limited", {
        status: response.status,
        retryAfterMs: await readDiscordRetryAfterMs(response),
      });
    }

    if (!response.ok) {
      throw new DiscordApiRequestError("bot_message", "request_failed", {
        status: response.status,
      });
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new DiscordApiRequestError("bot_message", "invalid_response", {
        status: response.status,
      });
    }
    const messageId = readOptionalResponseId(body);
    const responseChannelId = readOptionalResponseId(body, "channel_id");
    if (!messageId || !responseChannelId) {
      throw new DiscordApiRequestError("bot_message", "invalid_response", {
        status: response.status,
      });
    }

    return {
      id: messageId,
      channelId: responseChannelId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function closeDiscordThread({
  botToken,
  threadId,
}: CloseDiscordThreadOptions): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${threadId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    }
  );

  if (!response.ok) {
    throw new Error(`Discord thread close failed: ${response.status}`);
  }
}
