import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config";
import { StreamTitleNotifier } from "../../src/notifications/stream-notifications";

function fakeConfig(lastTitle = ""): Config {
  return {
    loginChannel: "rukalun",
    getLastStreamTitle: vi.fn(() => lastTitle),
    updateLastStreamTitle: vi.fn(),
  } as unknown as Config;
}

describe("StreamTitleNotifier", () => {
  it("builds stream-start embed payloads with everyone mention and stream details", () => {
    const notifier = new StreamTitleNotifier(fakeConfig(), "rukalun");

    expect(
      notifier.buildPayload({
        title: "新しいタイトル",
        displayName: "みいゆえたろ",
        gameName: "FINAL FANTASY XIV ONLINE",
        viewers: 12,
        thumbnailUrl: "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
      })
    ).toEqual({
      content: "@everyone",
      allowed_mentions: { parse: ["everyone"] },
      embeds: [
        {
          author: { name: "みいゆえたろ is now live on Twitch!" },
          title: "新しいタイトル",
          url: "https://www.twitch.tv/rukalun",
          color: 0x9146ff,
          fields: [
            { name: "Game", value: "FINAL FANTASY XIV ONLINE", inline: true },
            { name: "Viewers", value: "12", inline: true },
          ],
          image: {
            url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
          },
          footer: { text: "Watch Stream" },
        },
      ],
    });
  });

  it("cache-busts stream preview images with the stream id", () => {
    const notifier = new StreamTitleNotifier(fakeConfig(), "rukalun");

    const payload = notifier.buildPayload({
      title: "新しいタイトル",
      id: "stream-123",
      startDate: new Date("2026-06-06T01:05:28.000Z"),
      thumbnailUrl:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?quality=90",
    });

    expect(payload.embeds?.[0]?.image?.url).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?quality=90&stream_id=stream-123"
    );
    expect(payload.embeds?.[0]?.image?.url).not.toContain(
      "stream_started_at"
    );
  });

  it("falls back to the stream start time when there is no stream id", () => {
    const notifier = new StreamTitleNotifier(fakeConfig(), "rukalun");
    const getThumbnailUrl = vi.fn(
      (width: number, height: number) =>
        `https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-${width}x${height}.jpg`
    );

    const payload = notifier.buildPayload({
      title: "新しいタイトル",
      id: "  ",
      startDate: "2026-06-06T01:05:28.000Z",
      getThumbnailUrl,
    });

    expect(getThumbnailUrl).toHaveBeenCalledWith(1280, 720);
    expect(payload.embeds?.[0]?.image?.url).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?stream_started_at=2026-06-06T01%3A05%3A28.000Z"
    );
  });

  it("leaves preview image URLs unchanged without a valid stream key", () => {
    const notifier = new StreamTitleNotifier(fakeConfig(), "rukalun");

    const payload = notifier.buildPayload({
      title: "新しいタイトル",
      id: "",
      startDate: new Date("invalid"),
      thumbnailUrl:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
    });

    expect(payload.embeds?.[0]?.image?.url).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg"
    );
  });

  it("sends the embed payload while storing only the normalized title", async () => {
    const config = fakeConfig();
    const notifier = new StreamTitleNotifier(config, "rukalun");
    const sender = vi.fn();

    await notifier.notifyIfNeeded(
      {
        title: "  新しいタイトル  ",
        id: "stream-123",
        gameName: "FINAL FANTASY XIV ONLINE",
        viewers: 0,
        thumbnailUrl:
          "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg",
      },
      sender
    );

    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "@everyone",
        allowed_mentions: { parse: ["everyone"] },
        embeds: [
          expect.objectContaining({
            title: "新しいタイトル",
            url: "https://www.twitch.tv/rukalun",
            image: {
              url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_rukalun-1280x720.jpg?stream_id=stream-123",
            },
            fields: [
              { name: "Game", value: "FINAL FANTASY XIV ONLINE", inline: true },
              { name: "Viewers", value: "0", inline: true },
            ],
          }),
        ],
      })
    );
    expect(config.updateLastStreamTitle).toHaveBeenCalledWith("新しいタイトル");
  });
});
