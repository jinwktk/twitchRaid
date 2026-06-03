import {
  createDiscordThreadFromMessage,
  executeDiscordWebhook,
  type DiscordThread,
  type DiscordWebhookMessage,
  type DiscordWebhookPayload,
  type ExecuteDiscordWebhookOptions,
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

type CreateThread = (options: {
  botToken: string;
  channelId: string;
  messageId: string;
  name: string;
}) => Promise<DiscordThread>;

export interface PostStreamSummaryOptions {
  webhookUrl: string;
  botToken?: string;
  channelId?: string;
  webhookThreadName?: string;
  state: StreamSummaryState;
  clips: SummaryClip[];
  sendWebhook?: SendWebhook;
  createThread?: CreateThread;
  persistProgress?: (state: StreamSummaryState) => void;
}

export interface StartStreamSummaryThreadOptions {
  webhookUrl: string;
  botToken?: string;
  channelId?: string;
  webhookThreadName?: string;
  title: string;
  message: string;
  sendWebhook?: SendWebhook;
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
    `配信URL: ${state.streamUrl}`,
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
  createThread = createDiscordThreadFromMessage,
  persistProgress,
}: PostStreamSummaryOptions): Promise<StreamSummaryState> {
  let summaryMessageId = state.summaryMessageId;
  let threadId = state.threadId;
  const postedClipIds = new Set(state.postedClipIds ?? []);

  const persist = (status: StreamSummaryState["status"] = "pending") => {
    persistProgress?.({
      ...state,
      status,
      summaryMessageId,
      threadId,
      postedClipIds: [...postedClipIds],
    });
  };

  if (!summaryMessageId) {
    const summaryPayload = { content: formatStreamSummary(state, clips) };
    const { message, threadCreated } = await sendInitialSummaryWebhook(
      sendWebhook,
      webhookUrl,
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

  for (const clip of clips) {
    if (postedClipIds.has(clip.id)) continue;
    await sendWebhook(
      webhookUrl,
      { content: clip.url },
      { threadId, wait: false }
    );
    postedClipIds.add(clip.id);
    persist();
  }

  const postedState: StreamSummaryState = {
    ...state,
    status: "posted",
    summaryMessageId,
    threadId,
    postedClipIds: [...postedClipIds],
    postedAt: new Date().toISOString(),
  };
  persistProgress?.(postedState);
  return postedState;
}

export async function startStreamSummaryThread({
  webhookUrl,
  botToken,
  channelId,
  webhookThreadName,
  title,
  message,
  sendWebhook = executeDiscordWebhook,
  createThread = createDiscordThreadFromMessage,
}: StartStreamSummaryThreadOptions): Promise<StartStreamSummaryThreadResult> {
  let startMessage: DiscordWebhookMessage | null = null;
  let threadId: string | undefined;

  if (webhookThreadName) {
    try {
      startMessage = await sendWebhook(
        webhookUrl,
        { content: message, thread_name: webhookThreadName },
        { wait: true }
      );
      threadId = startMessage?.channelId;
    } catch {
      startMessage = await sendWebhook(webhookUrl, { content: message }, { wait: true });
    }
  } else {
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
    createThread,
  });
}

async function sendInitialSummaryWebhook(
  sendWebhook: SendWebhook,
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  webhookThreadName?: string,
  threadId?: string
): Promise<{ message: DiscordWebhookMessage | null; threadCreated: boolean }> {
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
