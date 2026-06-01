import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDiscordThreadFromMessage,
  executeDiscordWebhook,
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
});
