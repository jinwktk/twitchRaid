import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDiscordThread,
  createDiscordThreadFromMessage,
  executeDiscordWebhook,
  sendDiscordBotMessage,
} from "../../src/notifications/discord-webhook";

describe("discord webhook helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes a webhook with wait=true and thread_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "message-id", channel_id: "channel-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const message = await executeDiscordWebhook(
      "https://discord.com/api/webhooks/123/token",
      { content: "clip url" },
      { wait: true, threadId: "thread-id" }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token?wait=true&thread_id=thread-id",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "clip url" }),
      })
    );
    expect(message).toEqual({ id: "message-id", channelId: "channel-id" });
  });

  it("passes thread_name in the webhook body for forum or media channel posts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "message-id", channel_id: "thread-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const message = await executeDiscordWebhook(
      "https://discord.com/api/webhooks/123/token",
      { content: "summary", thread_name: "配信まとめ" },
      { wait: true }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token?wait=true",
      expect.objectContaining({
        body: JSON.stringify({
          content: "summary",
          thread_name: "配信まとめ",
        }),
      })
    );
    expect(message).toEqual({ id: "message-id", channelId: "thread-id" });
  });

  it("creates a thread from a webhook summary message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "thread-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const thread = await createDiscordThreadFromMessage({
      botToken: "secret",
      channelId: "channel-id",
      messageId: "message-id",
      name: "配信まとめ",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-id/messages/message-id/threads",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bot secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "配信まとめ",
          auto_archive_duration: 1440,
        }),
      })
    );
    expect(thread).toEqual({ id: "thread-id" });
  });

  it("recovers an existing thread attached to the start message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: 160004, message: "Thread already exists" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "message-id",
          channel_id: "channel-id",
          thread: { id: "existing-thread-id" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const thread = await createDiscordThreadFromMessage({
      botToken: "secret",
      channelId: "channel-id",
      messageId: "message-id",
      name: "配信まとめ",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://discord.com/api/v10/channels/channel-id/messages/message-id",
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bot secret",
          "Content-Type": "application/json",
        },
      })
    );
    expect(thread).toEqual({ id: "existing-thread-id" });
  });

  it("sends a Discord message with a bot token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "message-id", channel_id: "channel-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const message = await sendDiscordBotMessage({
      botToken: "secret",
      channelId: "channel-id",
      content: "summary",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-id/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bot secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "summary" }),
      })
    );
    expect(message).toEqual({ id: "message-id", channelId: "channel-id" });
  });

  it("sends embeds and everyone mentions with a bot token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "message-id", channel_id: "channel-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const embed = {
      title: "配信タイトル",
      url: "https://www.twitch.tv/rukalun",
      fields: [{ name: "Game", value: "FINAL FANTASY XIV ONLINE", inline: true }],
    };

    await sendDiscordBotMessage({
      botToken: "secret",
      channelId: "channel-id",
      content: "@everyone",
      allowed_mentions: { parse: ["everyone"] },
      embeds: [embed],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-id/messages",
      expect.objectContaining({
        body: JSON.stringify({
          content: "@everyone",
          allowed_mentions: { parse: ["everyone"] },
          embeds: [embed],
        }),
      })
    );
  });

  it("closes a Discord thread by archiving it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "thread-id", archived: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await closeDiscordThread({
      botToken: "secret",
      threadId: "thread-id",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/thread-id",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          Authorization: "Bot secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archived: true }),
      })
    );
  });
});
