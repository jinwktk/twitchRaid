import {
  createDiscordThreadFromMessage,
  DiscordApiRequestError,
  executeDiscordWebhook,
  findDiscordStreamSummaryHistory,
  sendDiscordBotMessage,
  type CloseDiscordThreadOptions,
  type DiscordMessagePayload,
  type DiscordThread,
  type DiscordWebhookMessage,
  type DiscordWebhookPayload,
  type ExecuteDiscordWebhookOptions,
  type SendDiscordBotMessageOptions,
} from "../notifications/discord-webhook";
import type { StreamSummaryState } from "./stream-summary-state-store";

export type { StreamSummaryState } from "./stream-summary-state-store";

export interface SummaryClip {
  id: string;
  title: string;
  url: string;
  creatorDisplayName: string;
  createdAt: string | null;
  views: number | null;
}

type SendWebhook = (
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  options?: ExecuteDiscordWebhookOptions
) => Promise<DiscordWebhookMessage | null>;

type SendBotMessage = (
  options: SendDiscordBotMessageOptions
) => Promise<DiscordWebhookMessage>;

type CreateThread = (options: {
  botToken: string;
  channelId: string;
  messageId: string;
  name: string;
}) => Promise<DiscordThread>;

type CloseThread = (options: CloseDiscordThreadOptions) => Promise<void>;

type FindHistory = typeof findDiscordStreamSummaryHistory;

type PersistStartMessage = (
  startMessageId: string
) => void | Promise<void>;

export interface PostStreamSummaryOptions {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  webhookThreadName?: string;
  requireExistingThread?: boolean;
  state: StreamSummaryState;
  clips: SummaryClip[];
  sendWebhook?: SendWebhook;
  sendBotMessage?: SendBotMessage;
  createThread?: CreateThread;
  closeThread?: CloseThread;
  closeThreadAfterPost?: boolean;
  persistProgress?: (state: StreamSummaryState) => void;
}

export interface PostStreamSummaryClipsOptions {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  state: StreamSummaryState;
  clips: SummaryClip[];
  allowWithoutThread?: boolean;
  sendWebhook?: SendWebhook;
  sendBotMessage?: SendBotMessage;
  persistProgress?: (state: StreamSummaryState) => void;
}

export interface StartStreamSummaryThreadOptions {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  webhookThreadName?: string;
  title: string;
  message: string | DiscordMessagePayload;
  sendWebhook?: SendWebhook;
  sendBotMessage?: SendBotMessage;
  createThread?: CreateThread;
  persistStartMessage?: PersistStartMessage;
}

export interface StartStreamSummaryThreadResult {
  startMessageId?: string;
  threadId?: string;
  postedStartNotification?: boolean;
}

export interface MergeStreamStartThreadResultOptions {
  preferStartedThread?: boolean;
}

export interface EnsureStreamSummaryStartThreadOptions
  extends StartStreamSummaryThreadOptions {
  state: StreamSummaryState;
  allowStartNotificationRepost?: boolean;
  findHistory?: FindHistory;
}

export function mergeStreamStartThreadResult(
  state: StreamSummaryState,
  started: StartStreamSummaryThreadResult,
  options: MergeStreamStartThreadResultOptions = {}
): StreamSummaryState {
  if (options.preferStartedThread && started.startMessageId) {
    return {
      ...state,
      startMessageId: started.startMessageId,
      threadId: started.threadId,
    };
  }

  if (
    started.startMessageId &&
    started.startMessageId !== state.startMessageId
  ) {
    return {
      ...state,
      startMessageId: started.startMessageId,
      threadId: started.threadId,
    };
  }

  return {
    ...state,
    startMessageId: started.startMessageId ?? state.startMessageId,
    threadId: started.threadId ?? state.threadId,
  };
}

export function formatStreamSummary(
  state: StreamSummaryState,
  clips: SummaryClip[]
): string {
  const duration = formatDuration(state.startedAt, state.endedAt);
  const highlight = clips[0]?.title ?? "なし";

  return [
    "📊 配信終了まとめ",
    `タイトル: ${state.title}`,
    `配信時間: ${duration}`,
    `ゲーム: ${state.gameName || "なし"}`,
    `コメント: ${state.commentCount}件`,
    `レイド: ${state.raidCount}件`,
    `クリップ: ${clips.length}件`,
    `ハイライト候補: ${highlight}`,
  ].join("\n");
}

export async function postStreamSummary({
  webhookUrl,
  botToken,
  channelId,
  webhookThreadName,
  requireExistingThread = false,
  state,
  clips,
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  createThread = createDiscordThreadFromMessage,
  persistProgress,
}: PostStreamSummaryOptions): Promise<StreamSummaryState> {
  let summaryMessageId = state.summaryMessageId;
  let threadId = state.threadId;
  const threadClosedAt = state.threadClosedAt;
  let summaryPostedWithBot = Boolean(state.summaryMessageId);
  const postedClipIds = new Set(state.postedClipIds ?? []);

  if (requireExistingThread && !threadId) {
    return {
      ...state,
      summaryMessageId,
      threadId,
      threadClosedAt,
      postedClipIds: [...postedClipIds],
    };
  }

  const persist = (status: StreamSummaryState["status"] = "pending") => {
    persistProgress?.({
      ...state,
      status,
      summaryMessageId,
      threadId,
      threadClosedAt,
      postedClipIds: [...postedClipIds],
    });
  };

  if (!summaryMessageId) {
    const summaryPayload = { content: formatStreamSummary(state, clips) };
    const { message, threadCreated } = await sendInitialSummaryMessage(
      sendWebhook,
      sendBotMessage,
      webhookUrl,
      botToken,
      channelId,
      summaryPayload,
      webhookThreadName,
      threadId
    );
    summaryMessageId = message?.id;
    summaryPostedWithBot = message?.postedWithBot ?? false;
    if (threadCreated) {
      threadId = message?.channelId;
    }
    persist();
  }

  if (!threadId && botToken && channelId && summaryMessageId && summaryPostedWithBot) {
    try {
      const thread = await createThread({
        botToken,
        channelId,
        messageId: summaryMessageId,
        name: buildStreamSummaryThreadName(state.title),
      });
      threadId = thread.id;
      persist();
    } catch {
      threadId = undefined;
    }
  }

  const clipPostedState = await postStreamSummaryClips({
    webhookUrl,
    botToken,
    channelId,
    state: {
      ...state,
      summaryMessageId,
      threadId,
      postedClipIds: [...postedClipIds],
    },
    clips,
    allowWithoutThread: true,
    sendWebhook,
    sendBotMessage,
    persistProgress: (nextState) => {
      summaryMessageId = nextState.summaryMessageId;
      threadId = nextState.threadId;
      postedClipIds.clear();
      for (const clipId of nextState.postedClipIds) {
        postedClipIds.add(clipId);
      }
      persistProgress?.(nextState);
    },
  });
  summaryMessageId = clipPostedState.summaryMessageId;
  threadId = clipPostedState.threadId;
  postedClipIds.clear();
  for (const clipId of clipPostedState.postedClipIds) {
    postedClipIds.add(clipId);
  }

  const postedState: StreamSummaryState = {
    ...state,
    status: "posted",
    summaryMessageId,
    threadId,
    threadClosedAt,
    postedClipIds: [...postedClipIds],
    postedAt: new Date().toISOString(),
  };
  persistProgress?.(postedState);
  return postedState;
}

export async function postStreamSummaryClips({
  webhookUrl,
  botToken,
  channelId,
  state,
  clips,
  allowWithoutThread = false,
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  persistProgress,
}: PostStreamSummaryClipsOptions): Promise<StreamSummaryState> {
  if ((!state.threadId && !allowWithoutThread) || state.status === "posted") {
    return state;
  }

  const postedClipIds = new Set(state.postedClipIds ?? []);
  for (const clip of clips) {
    if (postedClipIds.has(clip.id)) continue;
    await sendSummaryMessage({
      webhookUrl,
      botToken,
      channelId: state.threadId ?? channelId,
      content: clip.url,
      threadId: state.threadId,
      wait: false,
      sendWebhook,
      sendBotMessage,
    });
    postedClipIds.add(clip.id);
    persistProgress?.({
      ...state,
      postedClipIds: [...postedClipIds],
    });
  }

  return {
    ...state,
    postedClipIds: [...postedClipIds],
  };
}

export async function startStreamSummaryThread({
  webhookUrl,
  botToken,
  channelId,
  webhookThreadName,
  title,
  message,
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  createThread = createDiscordThreadFromMessage,
  persistStartMessage,
}: StartStreamSummaryThreadOptions): Promise<StartStreamSummaryThreadResult> {
  const payload = toDiscordMessagePayload(message);
  let startMessage: DiscordWebhookMessage | null = null;
  let threadId: string | undefined;

  if (botToken && channelId) {
    try {
      startMessage = await sendBotMessage({
        botToken,
        channelId,
        ...payload,
      });
    } catch (error) {
      const isConfirmedBotMessageRejection =
        error instanceof DiscordApiRequestError &&
        error.operation === "bot_message" &&
        error.status === 403;
      if (!webhookUrl || !isConfirmedBotMessageRejection) throw error;
      startMessage = await sendWebhook(webhookUrl, payload, { wait: true });
    }
  } else if (webhookThreadName) {
    try {
      if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
      startMessage = await sendWebhook(
        webhookUrl,
        { ...payload, thread_name: webhookThreadName },
        { wait: true }
      );
      threadId = startMessage?.channelId;
    } catch {
      if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
      startMessage = await sendWebhook(webhookUrl, payload, { wait: true });
    }
  } else {
    if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
    startMessage = await sendWebhook(webhookUrl, payload, { wait: true });
  }

  if (startMessage?.id) {
    await persistStartMessage?.(startMessage.id);
  }

  if (!threadId && botToken && channelId && startMessage?.id) {
    const thread = await createThread({
      botToken,
      channelId,
      messageId: startMessage.id,
      name: buildStreamSummaryThreadName(title),
    });
    threadId = thread.id;
  }

  return {
    startMessageId: startMessage?.id,
    threadId,
    postedStartNotification: Boolean(startMessage?.id),
  };
}

export async function ensureStreamSummaryStartThread({
  webhookUrl,
  botToken,
  channelId,
  webhookThreadName,
  title,
  message,
  state,
  allowStartNotificationRepost = true,
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  createThread = createDiscordThreadFromMessage,
  persistStartMessage,
  findHistory = findDiscordStreamSummaryHistory,
}: EnsureStreamSummaryStartThreadOptions): Promise<StartStreamSummaryThreadResult> {
  if (state.threadId) {
    return {
      startMessageId: state.startMessageId,
      threadId: state.threadId,
      postedStartNotification: false,
    };
  }

  if (state.startMessageId) {
    let threadId: string | undefined;
    if (botToken && channelId) {
      try {
        const thread = await createThread({
          botToken,
          channelId,
          messageId: state.startMessageId,
          name: buildStreamSummaryThreadName(title),
        });
        threadId = thread.id;
      } catch (error) {
        if (!isMissingDiscordStartMessage(error)) throw error;
        threadId = undefined;
      }
    }

    if (threadId) {
      return {
        startMessageId: state.startMessageId,
        threadId,
        postedStartNotification: false,
      };
    }
  }

  if (botToken && channelId) {
    const startPayload = toDiscordMessagePayload(message);
    const startEmbed = startPayload.embeds?.[0];
    const recovered = await findHistory({
      botToken,
      channelId,
      expectedThreadName: buildStreamSummaryThreadName(title),
      expectedEmbedTitle: startEmbed?.title ?? (title.trim() || "配信開始"),
      expectedStreamUrl: startEmbed?.url ?? state.streamUrl,
      webhookUrl,
    });

    if (recovered?.threadId) {
      return {
        startMessageId: recovered.startMessageId,
        threadId: recovered.threadId,
        postedStartNotification: false,
      };
    }

    if (recovered?.startMessageId) {
      await persistStartMessage?.(recovered.startMessageId);

      const thread = await createThread({
        botToken,
        channelId,
        messageId: recovered.startMessageId,
        name: buildStreamSummaryThreadName(title),
      });

      return {
        startMessageId: recovered.startMessageId,
        threadId: thread.id,
        postedStartNotification: false,
      };
    }
  }

  if (!allowStartNotificationRepost) {
    return {
      startMessageId: state.startMessageId,
      postedStartNotification: false,
    };
  }

  return startStreamSummaryThread({
    webhookUrl,
    botToken,
    channelId,
    webhookThreadName,
    title,
    message,
    sendWebhook,
    sendBotMessage,
    createThread,
    persistStartMessage,
  });
}

function toDiscordMessagePayload(
  message: string | DiscordMessagePayload
): DiscordMessagePayload {
  return typeof message === "string" ? { content: message } : message;
}

function isMissingDiscordStartMessage(error: unknown): boolean {
  return (
    error instanceof DiscordApiRequestError &&
    error.operation === "thread_create" &&
    error.reason === "request_failed" &&
    error.status === 404
  );
}

async function sendInitialSummaryMessage(
  sendWebhook: SendWebhook,
  sendBotMessage: SendBotMessage,
  webhookUrl: string | undefined,
  botToken: string | undefined,
  channelId: string | undefined,
  payload: DiscordWebhookPayload,
  webhookThreadName?: string,
  threadId?: string
): Promise<{
  message: (DiscordWebhookMessage & { postedWithBot?: boolean }) | null;
  threadCreated: boolean;
}> {
  if (botToken && (threadId || channelId)) {
    try {
      const message = await sendBotMessage({
        botToken,
        channelId: threadId ?? channelId!,
        content: payload.content,
      });
      return {
        message: { ...message, postedWithBot: true },
        threadCreated: false,
      };
    } catch (error) {
      if (!webhookUrl) throw error;
      return {
        message: await sendWebhook(webhookUrl, payload, { threadId, wait: true }),
        threadCreated: false,
      };
    }
  }

  if (!webhookUrl) {
    throw new Error("Discord webhook URL is not configured");
  }

  if (threadId) {
    return {
      message: await sendWebhook(webhookUrl, payload, { threadId, wait: true }),
      threadCreated: false,
    };
  }

  if (!webhookThreadName) {
    return {
      message: await sendWebhook(webhookUrl, payload, { wait: true }),
      threadCreated: false,
    };
  }

  try {
    return {
      message: await sendWebhook(
        webhookUrl,
        { ...payload, thread_name: webhookThreadName },
        { wait: true }
      ),
      threadCreated: true,
    };
  } catch {
    return {
      message: await sendWebhook(webhookUrl, payload, { wait: true }),
      threadCreated: false,
    };
  }
}

async function sendSummaryMessage({
  webhookUrl,
  botToken,
  channelId,
  content,
  threadId,
  wait,
  sendWebhook,
  sendBotMessage,
}: {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  content: string;
  threadId?: string;
  wait: boolean;
  sendWebhook: SendWebhook;
  sendBotMessage: SendBotMessage;
}): Promise<DiscordWebhookMessage | null> {
  if (botToken && (threadId || channelId)) {
    try {
      return await sendBotMessage({
        botToken,
        channelId: threadId ?? channelId!,
        content,
      });
    } catch (error) {
      if (!webhookUrl) throw error;
      return sendWebhook(
        webhookUrl,
        { content },
        { threadId, wait }
      );
    }
  }

  if (!webhookUrl) {
    throw new Error("Discord webhook URL is not configured");
  }

  return sendWebhook(
    webhookUrl,
    { content },
    { threadId, wait }
  );
}

export function buildStreamSummaryThreadName(title: string): string {
  const safeTitle = title.trim() || "配信";
  return Array.from(`配信まとめ - ${safeTitle}`).slice(0, 100).join("");
}

function formatDuration(startedAt: string, endedAt?: string): string {
  if (!endedAt) return "不明";

  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  const totalMinutes = Math.max(1, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}分`;
  return `${hours}時間${minutes}分`;
}
