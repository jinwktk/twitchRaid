import { describe, expect, it, vi } from "vitest";
import { DiscordApiRequestError } from "../../src/notifications/discord-webhook";
import {
  buildStreamSummaryThreadName,
  ensureStreamSummaryStartThread,
  formatStreamSummary,
  mergeStreamStartThreadResult,
  postStreamSummaryClips,
  postStreamSummary,
  startStreamSummaryThread,
  type SummaryClip,
  type StreamSummaryState,
} from "../../src/streams/stream-summary";

const state: StreamSummaryState = {
  status: "pending",
  streamId: "stream-1",
  title: "回変り金み",
  gameName: "Just Chatting",
  startedAt: "2026-06-01T10:00:00.000Z",
  endedAt: "2026-06-01T11:14:00.000Z",
  streamUrl: "https://www.twitch.tv/rukalun",
  commentCount: 53,
  raidCount: 0,
  postedClipIds: [],
};

const clips: SummaryClip[] = [
  {
    id: "clip-a",
    title: "BadClearOstrich",
    url: "https://www.twitch.tv/rukalun/clip/BadClearOstrich",
    creatorDisplayName: "Nymesio",
    createdAt: "2026-06-01T10:30:00.000Z",
    views: 10,
  },
  {
    id: "clip-b",
    title: "Second",
    url: "https://www.twitch.tv/rukalun/clip/Second",
    creatorDisplayName: "viewer",
    createdAt: "2026-06-01T10:40:00.000Z",
    views: 3,
  },
];

describe("stream summary", () => {
  it("formats the summary like the Discord stream report", () => {
    expect(formatStreamSummary(state, clips)).toContain("📊 配信終了まとめ");
    expect(formatStreamSummary(state, clips)).toContain("タイトル: 回変り金み");
    expect(formatStreamSummary(state, clips)).toContain("配信時間: 1時間14分");
    expect(formatStreamSummary(state, clips)).toContain("ゲーム: Just Chatting");
    expect(formatStreamSummary(state, clips)).toContain("コメント: 53件");
    expect(formatStreamSummary(state, clips)).toContain("クリップ: 2件");
    expect(formatStreamSummary(state, clips)).toContain("ハイライト候補: BadClearOstrich");
    expect(formatStreamSummary(state, clips)).not.toContain("配信URL:");
  });

  it("posts clips into a Discord thread and returns posted ids", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });

    const posted = await postStreamSummary({
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      sendBotMessage,
      createThread,
    });

    expect(sendBotMessage).toHaveBeenNthCalledWith(1, {
      botToken: "bot-token",
      channelId: "channel-id",
      content: expect.stringContaining("配信終了まとめ"),
    });
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(sendBotMessage).toHaveBeenNthCalledWith(2, {
      botToken: "bot-token",
      channelId: "thread-id",
      content: clips[0].url,
    });
    expect(posted.threadId).toBe("thread-id");
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("starts a thread from the stream-start notification with bot credentials", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "start-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });

    const started = await startStreamSummaryThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      sendBotMessage,
      createThread,
    });

    expect(sendBotMessage).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      content: "回変り金み",
    });
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(started).toEqual({
      startMessageId: "start-message-id",
      threadId: "thread-id",
      postedStartNotification: true,
    });
  });

  it("persists a new start message before attempting to create its thread", async () => {
    let releasePersist: (() => void) | undefined;
    const persistBlocked = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    const events: string[] = [];
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "start-message-id",
      channelId: "channel-id",
    });
    const persistStartMessage = vi.fn(async (messageId: string) => {
      events.push(`persist:${messageId}`);
      await persistBlocked;
      events.push("persisted");
    });
    const createThread = vi.fn(async ({ messageId }: { messageId: string }) => {
      events.push(`create:${messageId}`);
      return { id: "thread-id" };
    });

    const pending = startStreamSummaryThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      sendBotMessage,
      createThread,
      persistStartMessage,
    });

    await vi.waitFor(() =>
      expect(persistStartMessage).toHaveBeenCalledWith("start-message-id")
    );
    expect(createThread).not.toHaveBeenCalled();

    releasePersist?.();
    await expect(pending).resolves.toMatchObject({ threadId: "thread-id" });
    expect(events).toEqual([
      "persist:start-message-id",
      "persisted",
      "create:start-message-id",
    ]);
  });

  it("does not create a thread when persisting the new start message fails", async () => {
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "start-message-id",
      channelId: "channel-id",
    });
    const createThread = vi.fn();
    const persistStartMessage = vi
      .fn()
      .mockRejectedValue(new Error("state persistence failed"));

    await expect(
      startStreamSummaryThread({
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        sendBotMessage,
        createThread,
        persistStartMessage,
      })
    ).rejects.toThrow("state persistence failed");
    expect(createThread).not.toHaveBeenCalled();
  });

  it("starts a thread from an embed stream-start notification", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "start-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });
    const payload = {
      content: "@everyone",
      allowed_mentions: { parse: ["everyone" as const] },
      embeds: [
        {
          title: "回変り金み",
          url: "https://www.twitch.tv/rukalun",
        },
      ],
    };

    await startStreamSummaryThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: payload,
      sendBotMessage,
      createThread,
    });

    expect(sendBotMessage).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      ...payload,
    });
  });

  it("falls back to webhook when bot start notification is rejected", async () => {
    const sendBotMessage = vi
      .fn()
      .mockRejectedValue(
        new DiscordApiRequestError("bot_message", "request_failed", {
          status: 403,
        })
      );
    const sendWebhook = vi
      .fn()
      .mockResolvedValue({ id: "webhook-message-id", channelId: "webhook-channel" });
    const createThread = vi.fn().mockResolvedValue({ id: "webhook-thread-id" });
    const persistStartMessage = vi.fn();

    const started = await startStreamSummaryThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      sendBotMessage,
      sendWebhook,
      createThread,
      persistStartMessage,
    });

    expect(sendBotMessage).toHaveBeenCalledOnce();
    expect(sendWebhook).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      { content: "回変り金み" },
      { wait: true }
    );
    expect(persistStartMessage).toHaveBeenCalledWith("webhook-message-id");
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "webhook-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(started).toEqual({
      startMessageId: "webhook-message-id",
      threadId: "webhook-thread-id",
      postedStartNotification: true,
    });
  });

  it("does not post a webhook duplicate when the bot message outcome is ambiguous", async () => {
    const sendBotMessage = vi
      .fn()
      .mockRejectedValue(new TypeError("network response was lost"));
    const sendWebhook = vi.fn().mockResolvedValue({
      id: "duplicate-webhook-message-id",
      channelId: "channel-id",
    });
    const createThread = vi.fn();
    const persistStartMessage = vi.fn();

    await expect(
      startStreamSummaryThread({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        sendBotMessage,
        sendWebhook,
        createThread,
        persistStartMessage,
      })
    ).rejects.toThrow("network response was lost");

    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(persistStartMessage).not.toHaveBeenCalled();
  });

  it("recovers a trimmed-title orphan after an ambiguous bot response without reposting", async () => {
    const rawTitle = "  回変り金み  ";
    const normalizedTitle = rawTitle.trim();
    const startPayload = {
      content: "@everyone",
      embeds: [
        {
          title: normalizedTitle,
          url: state.streamUrl,
        },
      ],
    };
    const sendBotMessage = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network response was lost"))
      .mockResolvedValueOnce({
        id: "duplicate-start-message-id",
        channelId: "channel-id",
      });
    const sendWebhook = vi.fn();
    const findHistory = vi.fn(
      async ({ expectedEmbedTitle }: { expectedEmbedTitle: string }) =>
        expectedEmbedTitle === normalizedTitle
          ? { startMessageId: "orphan-start-message-id" }
          : null
    );
    const createThread = vi.fn().mockResolvedValue({
      id: "orphan-start-message-id",
    });
    const persistStartMessage = vi.fn();

    await expect(
      startStreamSummaryThread({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        botToken: "bot-token",
        channelId: "channel-id",
        title: rawTitle,
        message: startPayload,
        sendBotMessage,
        sendWebhook,
        createThread,
        persistStartMessage,
      })
    ).rejects.toThrow("network response was lost");

    const recovered = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: rawTitle,
      message: startPayload,
      state: {
        ...state,
        status: "active",
        title: rawTitle,
      },
      findHistory,
      sendBotMessage,
      sendWebhook,
      createThread,
      persistStartMessage,
    });

    expect(findHistory).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      expectedThreadName: `配信まとめ - ${normalizedTitle}`,
      expectedEmbedTitle: normalizedTitle,
      expectedStreamUrl: state.streamUrl,
      webhookUrl: "https://discord.com/api/webhooks/123/token",
    });
    expect(sendBotMessage).toHaveBeenCalledTimes(1);
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(persistStartMessage).toHaveBeenCalledOnce();
    expect(persistStartMessage).toHaveBeenCalledWith("orphan-start-message-id");
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "orphan-start-message-id",
      name: `配信まとめ - ${normalizedTitle}`,
    });
    expect(recovered).toEqual({
      startMessageId: "orphan-start-message-id",
      threadId: "orphan-start-message-id",
      postedStartNotification: false,
    });
  });

  it("truncates stream summary thread names by Unicode code point", () => {
    const prefix = "配信まとめ - ";
    const title = `${"a".repeat(91)}😀${"b".repeat(20)}`;
    const threadName = buildStreamSummaryThreadName(title);

    expect(threadName).toBe(`${prefix}${"a".repeat(91)}😀`);
    expect(Array.from(threadName)).toHaveLength(100);
    expect(() => encodeURIComponent(threadName)).not.toThrow();
  });

  it("propagates a typed thread-create failure after the start id is persisted", async () => {
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "start-message-id",
      channelId: "channel-id",
    });
    const createThread = vi.fn().mockRejectedValue(
      new DiscordApiRequestError("thread_create", "rate_limited", {
        status: 429,
        retryAfterMs: 120_000,
      })
    );
    const persistStartMessage = vi.fn();

    await expect(
      startStreamSummaryThread({
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        sendBotMessage,
        createThread,
        persistStartMessage,
      })
    ).rejects.toMatchObject({
      operation: "thread_create",
      status: 429,
      retryAfterMs: 120_000,
    });
    expect(persistStartMessage).toHaveBeenCalledWith("start-message-id");
    expect(createThread).toHaveBeenCalledOnce();
  });

  it("reuses an exact same-title thread found in Discord history without posting", async () => {
    const findHistory = vi.fn().mockResolvedValue({
      startMessageId: "history-start-message-id",
      threadId: "history-thread-id",
    });
    const sendBotMessage = vi.fn();
    const sendWebhook = vi.fn();
    const createThread = vi.fn();

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: { ...state, status: "active" },
      findHistory,
      sendBotMessage,
      sendWebhook,
      createThread,
    });

    expect(findHistory).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      expectedThreadName: "配信まとめ - 回変り金み",
      expectedEmbedTitle: "回変り金み",
      expectedStreamUrl: "https://www.twitch.tv/rukalun",
      webhookUrl: "https://discord.com/api/webhooks/123/token",
    });
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "history-start-message-id",
      threadId: "history-thread-id",
      postedStartNotification: false,
    });
  });

  it("creates a thread from an exact orphan start notification found in history", async () => {
    const findHistory = vi
      .fn()
      .mockResolvedValue({ startMessageId: "orphan-start-message-id" });
    const sendBotMessage = vi.fn();
    const createThread = vi.fn().mockResolvedValue({ id: "recovered-thread-id" });
    const persistStartMessage = vi.fn();

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: { ...state, status: "active" },
      findHistory,
      sendBotMessage,
      createThread,
      persistStartMessage,
    });

    expect(persistStartMessage).toHaveBeenCalledWith("orphan-start-message-id");
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "orphan-start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "orphan-start-message-id",
      threadId: "recovered-thread-id",
      postedStartNotification: false,
    });
  });

  it("posts a new start notification only after a complete history scan finds no match", async () => {
    const events: string[] = [];
    const findHistory = vi.fn(async () => {
      events.push("history");
      return null;
    });
    const sendBotMessage = vi.fn(async () => {
      events.push("send");
      return { id: "new-start-message-id", channelId: "channel-id" };
    });
    const createThread = vi.fn().mockResolvedValue({ id: "new-thread-id" });

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: { ...state, status: "active" },
      findHistory,
      sendBotMessage,
      createThread,
    });

    expect(events).toEqual(["history", "send"]);
    expect(started).toMatchObject({
      startMessageId: "new-start-message-id",
      threadId: "new-thread-id",
      postedStartNotification: true,
    });
  });

  it("rechecks the live-state gate after history before posting a new start notification", async () => {
    const events: string[] = [];
    const findHistory = vi.fn(async () => {
      events.push("history");
      return null;
    });
    const canPostStartNotification = vi.fn(() => {
      events.push("gate");
      return false;
    });
    const sendBotMessage = vi.fn(async () => {
      events.push("send");
      return { id: "new-start-message-id", channelId: "channel-id" };
    });
    const createThread = vi.fn();

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "終了済み配信",
      message: "終了済み配信",
      state: { ...state, status: "active" },
      allowStartNotificationRepost: true,
      canPostStartNotification,
      findHistory,
      sendBotMessage,
      createThread,
    });

    expect(events).toEqual(["history", "gate"]);
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: undefined,
      postedStartNotification: false,
    });
  });

  it("fails closed without Discord writes when the history scan is incomplete", async () => {
    const findHistory = vi
      .fn()
      .mockRejectedValue(new Error("Discord history lookup incomplete"));
    const sendBotMessage = vi.fn();
    const sendWebhook = vi.fn();
    const createThread = vi.fn();

    await expect(
      ensureStreamSummaryStartThread({
        webhookUrl: "https://discord.com/api/webhooks/123/token",
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        state: { ...state, status: "active" },
        findHistory,
        sendBotMessage,
        sendWebhook,
        createThread,
      })
    ).rejects.toThrow("Discord history lookup incomplete");
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
  });

  it("creates a missing start thread from a saved start notification message", async () => {
    const sendWebhook = vi.fn();
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "start-message-id",
      },
      sendWebhook,
      createThread,
    });

    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(started).toEqual({
      startMessageId: "start-message-id",
      threadId: "thread-id",
      postedStartNotification: false,
    });
  });

  it("posts a replacement start notification when a saved message cannot create a thread", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "replacement-message-id", channelId: "channel-id" });
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordApiRequestError("thread_create", "request_failed", {
          status: 404,
        })
      )
      .mockResolvedValueOnce({ id: "replacement-thread-id" });
    const findHistory = vi.fn().mockResolvedValue(null);

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "stale-start-message-id",
      },
      sendBotMessage,
      createThread,
      findHistory,
    });

    expect(createThread).toHaveBeenNthCalledWith(1, {
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "stale-start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(sendBotMessage).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      content: "回変り金み",
    });
    expect(createThread).toHaveBeenNthCalledWith(2, {
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "replacement-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(started).toEqual({
      startMessageId: "replacement-message-id",
      threadId: "replacement-thread-id",
      postedStartNotification: true,
    });
  });

  it("recovers an exact same-title history thread after a saved start message returns a typed 404", async () => {
    const sendBotMessage = vi.fn();
    const createThread = vi.fn().mockRejectedValueOnce(
      new DiscordApiRequestError("thread_create", "request_failed", {
        status: 404,
      })
    );
    const findHistory = vi.fn().mockResolvedValue({
      startMessageId: "history-start-message-id",
      threadId: "history-thread-id",
    });

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "stale-start-message-id",
      },
      sendBotMessage,
      createThread,
      findHistory,
    });

    expect(findHistory).toHaveBeenCalledOnce();
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "history-start-message-id",
      threadId: "history-thread-id",
      postedStartNotification: false,
    });
  });

  it("recovers an exact orphan after a saved start message returns a typed 404", async () => {
    const sendBotMessage = vi.fn();
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordApiRequestError("thread_create", "request_failed", {
          status: 404,
        })
      )
      .mockResolvedValueOnce({ id: "history-thread-id" });
    const findHistory = vi.fn().mockResolvedValue({
      startMessageId: "orphan-start-message-id",
    });
    const persistStartMessage = vi.fn();

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "stale-start-message-id",
      },
      sendBotMessage,
      createThread,
      findHistory,
      persistStartMessage,
    });

    expect(persistStartMessage).toHaveBeenCalledWith("orphan-start-message-id");
    expect(createThread).toHaveBeenNthCalledWith(2, {
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "orphan-start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "orphan-start-message-id",
      threadId: "history-thread-id",
      postedStartNotification: false,
    });
  });

  it.each([
    [
      "typed 500",
      () =>
        new DiscordApiRequestError("thread_create", "request_failed", {
          status: 500,
        }),
    ],
    ["generic error", () => new Error("thread creation transport failed")],
  ])(
    "propagates a %s from a saved start message without scanning history or reposting",
    async (_label, createError) => {
      const error = createError();
      const sendBotMessage = vi.fn();
      const createThread = vi.fn().mockRejectedValue(error);
      const findHistory = vi.fn().mockResolvedValue(null);

      await expect(
        ensureStreamSummaryStartThread({
          botToken: "bot-token",
          channelId: "channel-id",
          title: "回変り金み",
          message: "回変り金み",
          state: {
            ...state,
            status: "active",
            startMessageId: "saved-start-message-id",
          },
          sendBotMessage,
          createThread,
          findHistory,
        })
      ).rejects.toBe(error);

      expect(createThread).toHaveBeenCalledOnce();
      expect(findHistory).not.toHaveBeenCalled();
      expect(sendBotMessage).not.toHaveBeenCalled();
    }
  );

  it("keeps a newly posted start id after a typed 500 and retries that message without reposting", async () => {
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "start-message-id",
      channelId: "channel-id",
    });
    const findHistory = vi.fn().mockResolvedValue(null);
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordApiRequestError("thread_create", "request_failed", {
          status: 500,
        })
      )
      .mockResolvedValueOnce({ id: "thread-id" });
    const persistStartMessage = vi.fn();

    await expect(
      ensureStreamSummaryStartThread({
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        state: { ...state, status: "active" },
        findHistory,
        sendBotMessage,
        createThread,
        persistStartMessage,
      })
    ).rejects.toMatchObject({
      operation: "thread_create",
      status: 500,
    });

    expect(persistStartMessage).toHaveBeenCalledWith("start-message-id");

    const second = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "start-message-id",
      },
      findHistory,
      sendBotMessage,
      createThread,
      persistStartMessage,
    });

    expect(sendBotMessage).toHaveBeenCalledTimes(1);
    expect(findHistory).toHaveBeenCalledTimes(1);
    expect(createThread).toHaveBeenCalledTimes(2);
    expect(second).toEqual({
      startMessageId: "start-message-id",
      threadId: "thread-id",
      postedStartNotification: false,
    });
  });

  it("persists a newly posted start id before propagating a generic thread creation failure", async () => {
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "start-message-id",
      channelId: "channel-id",
    });
    const findHistory = vi.fn().mockResolvedValue(null);
    const createThread = vi
      .fn()
      .mockRejectedValue(new Error("thread creation transport failed"));
    const persistStartMessage = vi.fn();

    await expect(
      ensureStreamSummaryStartThread({
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        state: { ...state, status: "active" },
        findHistory,
        sendBotMessage,
        createThread,
        persistStartMessage,
      })
    ).rejects.toThrow("thread creation transport failed");

    expect(persistStartMessage).toHaveBeenCalledWith("start-message-id");
    expect(sendBotMessage).toHaveBeenCalledTimes(1);
    expect(findHistory).toHaveBeenCalledTimes(1);
    expect(createThread).toHaveBeenCalledOnce();
  });

  it("persists a recovered orphan id before propagating a generic thread creation failure", async () => {
    const findHistory = vi.fn().mockResolvedValue({
      startMessageId: "orphan-start-message-id",
    });
    const sendBotMessage = vi.fn();
    const createThread = vi
      .fn()
      .mockRejectedValue(new Error("thread creation transport failed"));
    const persistStartMessage = vi.fn();

    await expect(
      ensureStreamSummaryStartThread({
        botToken: "bot-token",
        channelId: "channel-id",
        title: "回変り金み",
        message: "回変り金み",
        state: { ...state, status: "active" },
        findHistory,
        sendBotMessage,
        createThread,
        persistStartMessage,
      })
    ).rejects.toThrow("thread creation transport failed");

    expect(persistStartMessage).toHaveBeenCalledWith("orphan-start-message-id");
    expect(createThread).toHaveBeenCalledOnce();
    expect(sendBotMessage).not.toHaveBeenCalled();
  });

  it("does not post a replacement start notification when reposting is disabled", async () => {
    const sendBotMessage = vi.fn();
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(
        new DiscordApiRequestError("thread_create", "request_failed", {
          status: 404,
        })
      );
    const findHistory = vi.fn().mockResolvedValue(null);

    const started = await ensureStreamSummaryStartThread({
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "stale-start-message-id",
      },
      allowStartNotificationRepost: false,
      sendBotMessage,
      createThread,
      findHistory,
    });

    expect(createThread).toHaveBeenCalledOnce();
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "stale-start-message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(findHistory).toHaveBeenCalledOnce();
    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "stale-start-message-id",
      threadId: undefined,
      postedStartNotification: false,
    });
  });

  it("does not post a start notification without a saved message when reposting is disabled", async () => {
    const sendBotMessage = vi.fn();
    const sendWebhook = vi.fn();
    const createThread = vi.fn();
    const findHistory = vi.fn().mockResolvedValue(null);

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
      },
      allowStartNotificationRepost: false,
      sendBotMessage,
      sendWebhook,
      createThread,
      findHistory,
    });

    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(findHistory).toHaveBeenCalledOnce();
    expect(started).toEqual({ postedStartNotification: false });
  });

  it("does not duplicate start notifications when the start thread already exists", async () => {
    const sendWebhook = vi.fn();
    const createThread = vi.fn();
    const findHistory = vi.fn();

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      state: {
        ...state,
        status: "active",
        startMessageId: "start-message-id",
        threadId: "thread-id",
      },
      sendWebhook,
      createThread,
      findHistory,
    });

    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(findHistory).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "start-message-id",
      threadId: "thread-id",
      postedStartNotification: false,
    });
  });

  it("prefers the manually posted start notification thread when requested", () => {
    const merged = mergeStreamStartThreadResult(
      {
        ...state,
        status: "active",
        startMessageId: "old-start-message-id",
        threadId: "old-thread-id",
      },
      {
        startMessageId: "manual-start-message-id",
        threadId: "manual-thread-id",
      },
      { preferStartedThread: true }
    );

    expect(merged.startMessageId).toBe("manual-start-message-id");
    expect(merged.threadId).toBe("manual-thread-id");
  });

  it("clears a stale thread when a manual notification has no created thread yet", () => {
    const merged = mergeStreamStartThreadResult(
      {
        ...state,
        status: "active",
        startMessageId: "old-start-message-id",
        threadId: "old-thread-id",
      },
      {
        startMessageId: "manual-start-message-id",
      },
      { preferStartedThread: true }
    );

    expect(merged.startMessageId).toBe("manual-start-message-id");
    expect(merged.threadId).toBeUndefined();
  });

  it("clears a stale thread when a new automatic start notification has no thread", () => {
    const merged = mergeStreamStartThreadResult(
      {
        ...state,
        status: "active",
        startMessageId: "old-start-message-id",
        threadId: "old-thread-id",
      },
      {
        startMessageId: "new-start-message-id",
      }
    );

    expect(merged.startMessageId).toBe("new-start-message-id");
    expect(merged.threadId).toBeUndefined();
  });

  it("posts the ending summary into an existing start-notification thread", async () => {
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "summary-message-id", channelId: "thread-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "thread-id" });

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      state: {
        ...state,
        threadId: "thread-id",
      },
      clips,
      sendWebhook,
    });

    expect(sendWebhook).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/webhooks/123/token",
      expect.objectContaining({ content: expect.stringContaining("配信終了まとめ") }),
      { threadId: "thread-id", wait: true }
    );
    expect(sendWebhook).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/webhooks/123/token",
      { content: clips[0].url },
      { threadId: "thread-id", wait: false }
    );
    expect(posted.summaryMessageId).toBe("summary-message-id");
    expect(posted.threadId).toBe("thread-id");
  });

  it("does not post the ending summary or clips outside a required existing thread", async () => {
    const sendBotMessage = vi.fn();
    const sendWebhook = vi.fn();

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      requireExistingThread: true,
      sendBotMessage,
      sendWebhook,
    });

    expect(sendBotMessage).not.toHaveBeenCalled();
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(posted.status).toBe("pending");
    expect(posted.summaryMessageId).toBeUndefined();
    expect(posted.threadId).toBeUndefined();
    expect(posted.postedClipIds).toEqual([]);
  });

  it("keeps the stream thread visible after posting the ending summary", async () => {
    const sendBotMessage = vi.fn().mockResolvedValue({
      id: "summary-message-id",
      channelId: "thread-id",
    });
    const closeThread = vi.fn().mockResolvedValue(undefined);

    const posted = await postStreamSummary({
      botToken: "bot-token",
      state: {
        ...state,
        threadId: "thread-id",
        postedClipIds: ["clip-a", "clip-b"],
      },
      clips,
      sendBotMessage,
      closeThread,
      closeThreadAfterPost: true,
    });

    expect(sendBotMessage).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "thread-id",
      content: expect.stringContaining("配信終了まとめ"),
    });
    expect(closeThread).not.toHaveBeenCalled();
    expect(posted.threadClosedAt).toBeUndefined();
  });

  it("creates a forum/media thread using only webhook thread_name", async () => {
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "thread-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "thread-id" });

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      webhookThreadName: "配信まとめ - 回変り金み",
      state,
      clips,
      sendWebhook,
    });

    expect(sendWebhook).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/webhooks/123/token",
      expect.objectContaining({
        content: expect.stringContaining("配信終了まとめ"),
        thread_name: "配信まとめ - 回変り金み",
      }),
      { wait: true }
    );
    expect(sendWebhook).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/webhooks/123/token",
      { content: clips[0].url },
      { threadId: "thread-id", wait: false }
    );
    expect(posted.threadId).toBe("thread-id");
  });

  it("falls back to a normal webhook summary if thread_name is rejected", async () => {
    const sendWebhook = vi
      .fn()
      .mockRejectedValueOnce(new Error("Discord Webhook failed: 400"))
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      webhookThreadName: "配信まとめ - 回変り金み",
      state,
      clips,
      sendWebhook,
    });

    expect(sendWebhook).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/webhooks/123/token",
      expect.not.objectContaining({ thread_name: expect.any(String) }),
      { wait: true }
    );
    expect(posted.threadId).toBeUndefined();
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("falls back to webhook when bot summary and clip posts are rejected", async () => {
    const sendBotMessage = vi
      .fn()
      .mockRejectedValue(new Error("Discord bot message failed: 403"));
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "summary-message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });
    const createThread = vi
      .fn()
      .mockRejectedValue(new Error("Discord thread creation failed: 403"));

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      sendBotMessage,
      sendWebhook,
      createThread,
    });

    expect(sendBotMessage).toHaveBeenCalledTimes(3);
    expect(sendWebhook).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/webhooks/123/token",
      expect.objectContaining({ content: expect.stringContaining("配信終了まとめ") }),
      { wait: true }
    );
    expect(sendWebhook).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/webhooks/123/token",
      { content: clips[0].url },
      { threadId: undefined, wait: false }
    );
    expect(sendWebhook).toHaveBeenNthCalledWith(
      3,
      "https://discord.com/api/webhooks/123/token",
      { content: clips[1].url },
      { threadId: undefined, wait: false }
    );
    expect(posted.summaryMessageId).toBe("summary-message-id");
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("persists progress after summary, thread, and each clip post", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });
    const persistProgress = vi.fn();

    await postStreamSummary({
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      sendBotMessage,
      createThread,
      persistProgress,
    });

    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ summaryMessageId: "message-id" })
    );
    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-id" })
    );
    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ postedClipIds: ["clip-a"] })
    );
    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ postedClipIds: ["clip-a", "clip-b"] })
    );
  });

  it("resumes clip posting without duplicating already posted clips", async () => {
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" });

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      state: {
        ...state,
        summaryMessageId: "message-id",
        threadId: "thread-id",
        postedClipIds: ["clip-a"],
      },
      clips,
      sendWebhook,
    });

    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect(sendWebhook).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      { content: clips[1].url },
      { threadId: "thread-id", wait: false }
    );
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("posts live clips into the existing stream thread without a summary", async () => {
    const sendWebhook = vi.fn().mockResolvedValue({ id: "clip-message-id" });
    const persistProgress = vi.fn();

    const posted = await postStreamSummaryClips({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      state: {
        ...state,
        status: "active",
        threadId: "thread-id",
        postedClipIds: ["clip-a"],
      },
      clips,
      sendWebhook,
      persistProgress,
    });

    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect(sendWebhook).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      { content: clips[1].url },
      { threadId: "thread-id", wait: false }
    );
    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ postedClipIds: ["clip-a", "clip-b"] })
    );
    expect(posted.summaryMessageId).toBeUndefined();
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("falls back to webhook when bot live clip posting is rejected", async () => {
    const sendBotMessage = vi
      .fn()
      .mockRejectedValue(new Error("Discord bot message failed: 403"));
    const sendWebhook = vi.fn().mockResolvedValue({ id: "clip-message-id" });
    const persistProgress = vi.fn();

    const posted = await postStreamSummaryClips({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      state: {
        ...state,
        status: "active",
        threadId: "thread-id",
        postedClipIds: ["clip-a"],
      },
      clips,
      sendBotMessage,
      sendWebhook,
      persistProgress,
    });

    expect(sendBotMessage).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "thread-id",
      content: clips[1].url,
    });
    expect(sendWebhook).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      { content: clips[1].url },
      { threadId: "thread-id", wait: false }
    );
    expect(persistProgress).toHaveBeenCalledWith(
      expect.objectContaining({ postedClipIds: ["clip-a", "clip-b"] })
    );
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("does not post live clips outside a thread", async () => {
    const sendWebhook = vi.fn();

    const posted = await postStreamSummaryClips({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      state,
      clips,
      sendWebhook,
    });

    expect(sendWebhook).not.toHaveBeenCalled();
    expect(posted.postedClipIds).toEqual([]);
  });
});
