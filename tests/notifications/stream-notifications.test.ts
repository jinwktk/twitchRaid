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

  it("sends the embed payload while storing only the normalized title", async () => {
    const config = fakeConfig();
    const notifier = new StreamTitleNotifier(config, "rukalun");
    const sender = vi.fn();

    await notifier.notifyIfNeeded(
      {
        title: "  新しいタイトル  ",
        gameName: "FINAL FANTASY XIV ONLINE",
        viewers: 0,
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
