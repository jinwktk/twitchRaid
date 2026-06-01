import { describe, expect, it, vi } from "vitest";
import {
  formatStreamSummary,
  postStreamSummary,
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
  });

  it("posts clips into a Discord thread and returns posted ids", async () => {
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });

    const posted = await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      sendWebhook,
      createThread,
    });

    expect(sendWebhook).toHaveBeenNthCalledWith(
      1,
      "https://discord.com/api/webhooks/123/token",
      expect.objectContaining({ content: expect.stringContaining("配信終了まとめ") }),
      { wait: true }
    );
    expect(createThread).toHaveBeenCalledWith({
      botToken: "bot-token",
      channelId: "channel-id",
      messageId: "message-id",
      name: "配信まとめ - 回変り金み",
    });
    expect(sendWebhook).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/webhooks/123/token",
      { content: clips[0].url },
      { threadId: "thread-id", wait: false }
    );
    expect(posted.threadId).toBe("thread-id");
    expect(posted.postedClipIds).toEqual(["clip-a", "clip-b"]);
  });

  it("persists progress after summary, thread, and each clip post", async () => {
    const sendWebhook = vi
      .fn()
      .mockResolvedValueOnce({ id: "message-id", channelId: "channel-id" })
      .mockResolvedValue({ id: "clip-message-id", channelId: "channel-id" });
    const createThread = vi.fn().mockResolvedValue({ id: "thread-id" });
    const persistProgress = vi.fn();

    await postStreamSummary({
      webhookUrl: "https://discord.com/api/webhooks/123/token",
      botToken: "bot-token",
      channelId: "channel-id",
      state,
      clips,
      sendWebhook,
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
});
