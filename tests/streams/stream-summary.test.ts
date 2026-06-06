import { describe, expect, it, vi } from "vitest";
import {
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
    });
  });

  it("falls back to webhook when bot start notification is rejected", async () => {
    const sendBotMessage = vi
      .fn()
      .mockRejectedValue(new Error("Discord bot message failed: 403"));
    const sendWebhook = vi
      .fn()
      .mockResolvedValue({ id: "webhook-message-id", channelId: "webhook-channel" });
    const createThread = vi.fn();

    const started = await startStreamSummaryThread({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      title: "回変り金み",
      message: "回変り金み",
      sendBotMessage,
      sendWebhook,
      createThread,
    });

    expect(sendBotMessage).toHaveBeenCalledOnce();
    expect(sendWebhook).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      { content: "回変り金み" },
      { wait: true }
    );
    expect(createThread).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "webhook-message-id",
      threadId: undefined,
    });
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
    });
  });

  it("posts a replacement start notification when a saved message cannot create a thread", async () => {
    const sendBotMessage = vi
      .fn()
      .mockResolvedValueOnce({ id: "replacement-message-id", channelId: "channel-id" });
    const createThread = vi
      .fn()
      .mockRejectedValueOnce(new Error("Discord thread creation failed: 404"))
      .mockResolvedValueOnce({ id: "replacement-thread-id" });

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
    });
  });

  it("does not duplicate start notifications when the start thread already exists", async () => {
    const sendWebhook = vi.fn();
    const createThread = vi.fn();

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
    });

    expect(sendWebhook).not.toHaveBeenCalled();
    expect(createThread).not.toHaveBeenCalled();
    expect(started).toEqual({
      startMessageId: "start-message-id",
      threadId: "thread-id",
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

  it("closes the stream thread after posting the ending summary", async () => {
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
    expect(closeThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      threadId: "thread-id",
    });
    expect(posted.threadClosedAt).toBeDefined();
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
