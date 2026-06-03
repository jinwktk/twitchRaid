import {
  closeDiscordThread,
  createDiscordThreadFromMessage,
  executeDiscordWebhook,
  sendDiscordBotMessage,
  type CloseDiscordThreadOptions,
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

export interface PostStreamSummaryOptions {
  webhookUrl?: string;
  botToken?: string;
  channelId?: string;
  webhookThreadName?: string;
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
  message: string;
  sendWebhook?: SendWebhook;
  sendBotMessage?: SendBotMessage;
  createThread?: CreateThread;
}

export interface StartStreamSummaryThreadResult {
  startMessageId?: string;
  threadId?: string;
}

export interface EnsureStreamSummaryStartThreadOptions
  extends StartStreamSummaryThreadOptions {
  state: StreamSummaryState;
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
  state,
  clips,
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  createThread = createDiscordThreadFromMessage,
  closeThread = closeDiscordThread,
  closeThreadAfterPost = false,
  persistProgress,
}: PostStreamSummaryOptions): Promise<StreamSummaryState> {
  let summaryMessageId = state.summaryMessageId;
  let threadId = state.threadId;
  let threadClosedAt = state.threadClosedAt;
  const postedClipIds = new Set(state.postedClipIds ?? []);

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
    if (threadCreated) {
      threadId = message?.channelId;
    }
    persist();
  }

  if (!threadId && botToken && channelId && summaryMessageId) {
    try {
      const thread = await createThread({
        botToken,
        channelId,
        messageId: summaryMessageId,
        name: buildThreadName(state.title),
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

  if (closeThreadAfterPost && botToken && threadId && !threadClosedAt) {
    try {
      await closeThread({ botToken, threadId });
      threadClosedAt = new Date().toISOString();
      persist();
    } catch {
      threadClosedAt = undefined;
    }
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
}: StartStreamSummaryThreadOptions): Promise<StartStreamSummaryThreadResult> {
  let startMessage: DiscordWebhookMessage | null = null;
  let threadId: string | undefined;

  if (botToken && channelId) {
    startMessage = await sendBotMessage({
      botToken,
      channelId,
      content: message,
    });
  } else if (webhookThreadName) {
    try {
      if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
      startMessage = await sendWebhook(
        webhookUrl,
        { content: message, thread_name: webhookThreadName },
        { wait: true }
      );
      threadId = startMessage?.channelId;
    } catch {
      if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
      startMessage = await sendWebhook(webhookUrl, { content: message }, { wait: true });
    }
  } else {
    if (!webhookUrl) throw new Error("Discord webhook URL is not configured");
    startMessage = await sendWebhook(webhookUrl, { content: message }, { wait: true });
  }

  if (!threadId && botToken && channelId && startMessage?.id) {
    try {
      const thread = await createThread({
        botToken,
        channelId,
        messageId: startMessage.id,
        name: buildThreadName(title),
      });
      threadId = thread.id;
    } catch {
      threadId = undefined;
    }
  }

  return {
    startMessageId: startMessage?.id,
    threadId,
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
  sendWebhook = executeDiscordWebhook,
  sendBotMessage = sendDiscordBotMessage,
  createThread = createDiscordThreadFromMessage,
}: EnsureStreamSummaryStartThreadOptions): Promise<StartStreamSummaryThreadResult> {
  if (state.threadId) {
    return {
      startMessageId: state.startMessageId,
      threadId: state.threadId,
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
          name: buildThreadName(title),
        });
        threadId = thread.id;
      } catch {
        threadId = undefined;
      }
    }

    return {
      startMessageId: state.startMessageId,
      threadId,
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
  });
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
): Promise<{ message: DiscordWebhookMessage | null; threadCreated: boolean }> {
  if (botToken && (threadId || channelId)) {
    return {
      message: await sendBotMessage({
        botToken,
        channelId: threadId ?? channelId!,
        content: payload.content,
      }),
      threadCreated: false,
    };
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
  if (botToken && channelId) {
    return sendBotMessage({
      botToken,
      channelId,
      content,
    });
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

function buildThreadName(title: string): string {
  const safeTitle = title.trim() || "配信";
  return `配信まとめ - ${safeTitle}`.slice(0, 100);
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
