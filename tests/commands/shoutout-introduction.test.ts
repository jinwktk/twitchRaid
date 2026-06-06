import { describe, expect, it, vi } from "vitest";
import {
  formatShoutoutIntroductionMessage,
  generateShoutoutIntroduction,
} from "../../src/commands/shoutout-introduction";
import type { RaidSourceInfo } from "../../src/commands/raid-info";

const raidInfo: RaidSourceInfo = {
  userName: "RaidUser",
  streamUrl: "https://www.twitch.tv/raiduser",
  title: "たのしい建築配信",
  gameName: "Minecraft",
};

describe("generateShoutoutIntroduction", () => {
  it("skips Ollama when the feature is disabled", async () => {
    const fetchImpl = vi.fn();

    await expect(
      generateShoutoutIntroduction({
        info: raidInfo,
        viewerCount: 12,
        enabled: false,
        baseUrl: "http://127.0.0.1:11434",
        model: "gemma3",
        timeoutMs: 3000,
        keepAlive: "5m",
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requests a short Japanese intro from Ollama", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: "のんびり建築を楽しむ、初見さんにもやさしい配信者さんD！",
        done: true,
      }),
    });

    const intro = await generateShoutoutIntroduction({
      info: raidInfo,
      viewerCount: 12,
      enabled: true,
      baseUrl: "http://127.0.0.1:11434/",
      model: "gemma3",
      timeoutMs: 3000,
      keepAlive: "5m",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining('"stream":false'),
      })
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      model: "gemma3",
      stream: false,
      keep_alive: "5m",
      options: {
        temperature: 0.8,
        num_predict: 80,
      },
    });
    expect(body.prompt).toContain("RaidUser");
    expect(body.prompt).toContain("Minecraft");
    expect(body.prompt).toContain("たのしい建築配信");
    expect(intro).toBe("のんびり建築を楽しむ、初見さんにもやさしい配信者さんD！");
  });

  it("returns null when Ollama rejects the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "model failed",
    });

    await expect(
      generateShoutoutIntroduction({
        info: raidInfo,
        viewerCount: 12,
        enabled: true,
        baseUrl: "http://127.0.0.1:11434",
        model: "gemma3",
        timeoutMs: 3000,
        keepAlive: "5m",
        fetchImpl,
      })
    ).resolves.toBeNull();
  });

  it("returns null when Ollama responds without Japanese kana", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: "A friendly Minecraft streamer who enjoys building.",
        done: true,
      }),
    });

    await expect(
      generateShoutoutIntroduction({
        info: raidInfo,
        viewerCount: 12,
        enabled: true,
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen2.5:7b",
        timeoutMs: 3000,
        keepAlive: "5m",
        fetchImpl,
      })
    ).resolves.toBeNull();
  });
});

describe("formatShoutoutIntroductionMessage", () => {
  it("keeps the generated intro single-line and under the Twitch chat limit", () => {
    const message = formatShoutoutIntroductionMessage(
      raidInfo,
      ` "すごく${"楽しい".repeat(120)}\n配信者さんD！" `
    );

    expect(message).not.toContain("\n");
    expect(message).toContain("@raiduser さん紹介D！");
    expect(message.length).toBeLessThanOrEqual(500);
    expect(message.endsWith("...")).toBe(true);
  });

  it("removes a duplicated leading user name from the generated intro", () => {
    expect(
      formatShoutoutIntroductionMessage(
        raidInfo,
        "raiduserのMinecraft建築配信に12人が参加！楽しむぞD！"
      )
    ).toBe("@raiduser さん紹介D！Minecraft建築配信に12人が参加！楽しむぞD！");
  });
});
