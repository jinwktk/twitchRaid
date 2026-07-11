import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeDiscordThread,
  createDiscordThreadFromMessage,
  DiscordHistoryLookupError,
  executeDiscordWebhook,
  findDiscordStreamSummaryHistory,
  sendDiscordBotMessage,
} from "../../src/notifications/discord-webhook";

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function historyOptions() {
  return {
    botToken: "bot-secret-token",
    channelId: "channel-id",
    expectedThreadName: "配信まとめ - 同じ配信タイトル",
    expectedEmbedTitle: "同じ配信タイトル",
    expectedStreamUrl: "https://www.twitch.tv/rukalun",
    webhookUrl: "https://discord.com/api/webhooks/webhook-id/webhook-secret-token",
  };
}

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

  it("searches active and all public archived pages before reusing the newest valid same-title thread", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/channels/channel-id")) {
        return jsonResponse({ id: "channel-id", guild_id: "guild-id" });
      }
      if (url.endsWith("/guilds/guild-id/threads/active")) {
        return jsonResponse({
          threads: [
            {
              id: "300",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
            },
            {
              id: "900",
              parent_id: "other-channel",
              name: "配信まとめ - 同じ配信タイトル",
            },
          ],
        });
      }
      if (
        url.endsWith(
          "/channels/channel-id/threads/archived/public?limit=100"
        )
      ) {
        return jsonResponse({
          threads: [
            {
              id: "500",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
              thread_metadata: { archive_timestamp: "2026-07-11T01:00:00.000Z" },
            },
          ],
          has_more: true,
        });
      }
      if (
        url.includes(
          "/channels/channel-id/threads/archived/public?limit=100&before="
        )
      ) {
        return jsonResponse({
          threads: [
            {
              id: "400",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
              thread_metadata: { archive_timestamp: "2026-07-10T23:00:00.000Z" },
            },
          ],
          has_more: false,
        });
      }
      if (url.endsWith("/channels/channel-id/messages/500")) {
        return jsonResponse({ message: "starter was deleted" }, 404);
      }
      if (url.endsWith("/channels/channel-id/messages/400")) {
        return jsonResponse({ id: "400", thread: { id: "400" } });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).resolves.toEqual({ startMessageId: "400", threadId: "400" });

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain(
      "https://discord.com/api/v10/channels/channel-id/messages/500"
    );
    expect(urls).toContain(
      "https://discord.com/api/v10/channels/channel-id/messages/400"
    );
    expect(urls).not.toContain("https://discord.com/api/v10/users/@me");
    expect(urls.some((url) => url.includes("/channels/channel-id/messages?"))).toBe(
      false
    );
  });

  it("rejects an invalid same-title thread starter instead of treating it as no match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ guild_id: "guild-id" }))
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [
            {
              id: "500",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ threads: [], has_more: false }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "different-message", thread: { id: "500" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).rejects.toMatchObject({
      name: "DiscordHistoryLookupError",
      reason: "invalid_response",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("fails closed on an incomplete archived-thread scan and preserves a safe 429 retry delay", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ guild_id: "guild-id" }))
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [
            {
              id: "500",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { retry_after: 2.25, sentinel: "response-body-secret" },
          429,
          { "Retry-After": "1.5" }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await findDiscordStreamSummaryHistory(historyOptions());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DiscordHistoryLookupError);
    expect(caught).toMatchObject({
      reason: "rate_limited",
      status: 429,
      retryAfterMs: 2250,
    });
    const serialized = `${String(caught)}\n${JSON.stringify(caught)}`;
    expect(serialized).not.toContain("bot-secret-token");
    expect(serialized).not.toContain("webhook-secret-token");
    expect(serialized).not.toContain("response-body-secret");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("finds only an exact orphan start notification posted by this bot or configured webhook", async () => {
    const exactEmbed = {
      title: "同じ配信タイトル",
      url: "https://www.twitch.tv/rukalun",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ guild_id: "guild-id" }))
      .mockResolvedValueOnce(jsonResponse({ threads: [] }))
      .mockResolvedValueOnce(jsonResponse({ threads: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: "bot-id" }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "900",
            author: { id: "other-bot" },
            embeds: [exactEmbed],
          },
          {
            id: "800",
            webhook_id: "other-webhook",
            embeds: [exactEmbed],
          },
          {
            id: "700",
            webhook_id: "webhook-id",
            embeds: [
              { title: exactEmbed.title, url: "https://example.com/wrong" },
              { title: "wrong", url: exactEmbed.url },
            ],
          },
          {
            id: "600",
            webhook_id: "webhook-id",
            thread: { id: "600" },
            embeds: [exactEmbed],
          },
          {
            id: "500",
            webhook_id: "webhook-id",
            embeds: [exactEmbed],
          },
          {
            id: "400",
            author: { id: "bot-id" },
            embeds: [exactEmbed],
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).resolves.toEqual({ startMessageId: "500" });
  });

  it("returns null only after the parent-message history is completely scanned", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(1000 - index),
      author: { id: "other-bot" },
      embeds: [],
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ guild_id: "guild-id" }))
      .mockResolvedValueOnce(jsonResponse({ threads: [] }))
      .mockResolvedValueOnce(jsonResponse({ threads: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ id: "bot-id" }))
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).resolves.toBeNull();
    expect(String(fetchMock.mock.calls[5][0])).toContain(
      "/channels/channel-id/messages?limit=100&before=901"
    );
  });

  it("rejects when the message-history page cap prevents proving that no match exists", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: String(1000 - index),
      author: { id: "other-bot" },
      embeds: [],
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/channels/channel-id")) {
        return jsonResponse({ guild_id: "guild-id" });
      }
      if (url.endsWith("/guilds/guild-id/threads/active")) {
        return jsonResponse({ threads: [] });
      }
      if (url.includes("/threads/archived/public")) {
        return jsonResponse({ threads: [], has_more: false });
      }
      if (url.endsWith("/users/@me")) {
        return jsonResponse({ id: "bot-id" });
      }
      if (url.includes("/channels/channel-id/messages?")) {
        return jsonResponse(fullPage);
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).rejects.toMatchObject({
      name: "DiscordHistoryLookupError",
      reason: "pagination_incomplete",
    });
    expect(fetchMock).toHaveBeenCalledTimes(24);
  });

  it("fails closed when a matching thread starter request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ guild_id: "guild-id" }))
      .mockResolvedValueOnce(
        jsonResponse({
          threads: [
            {
              id: "500",
              parent_id: "channel-id",
              name: "配信まとめ - 同じ配信タイトル",
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ threads: [], has_more: false }))
      .mockResolvedValueOnce(jsonResponse({ message: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findDiscordStreamSummaryHistory(historyOptions())
    ).rejects.toMatchObject({
      name: "DiscordHistoryLookupError",
      reason: "request_failed",
      status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
