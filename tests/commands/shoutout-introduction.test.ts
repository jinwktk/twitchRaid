import { describe, expect, it, vi } from "vitest";
import {
  buildRaidGreetingMessage,
  formatGeneratedRaidGreetingMessage,
  generateRaidGreetingMessage,
} from "../../src/commands/shoutout-introduction";
import type { RaidSourceInfo } from "../../src/commands/raid-info";

const raidInfo: RaidSourceInfo = {
  userName: "RaidUser",
  streamUrl: "https://www.twitch.tv/raiduser",
  title: "たのしい建築配信",
  gameName: "Minecraft",
};

describe("buildRaidGreetingMessage", () => {
  it("uses the static raid greeting when Ollama is disabled", async () => {
    const fetchImpl = vi.fn();

    await expect(
      buildRaidGreetingMessage({
        info: raidInfo,
        viewerCount: 12,
        enabled: false,
        baseUrl: "http://127.0.0.1:11434",
        model: "gemma3",
        timeoutMs: 3000,
        keepAlive: "5m",
        fetchImpl,
      })
    ).resolves.toBe(
      "レイドありがとうD！！ @raiduser さんは、「Minecraft」で「たのしい建築配信」をしてたD！お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("generateRaidGreetingMessage", () => {
  it("requests a single Japanese raid greeting from Ollama", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response:
          "レイドありがとうD！！ @raiduser さんは、Minecraftでたのしい建築配信をしてたD！チャンネルはこD→https://www.twitch.tv/raiduser",
        done: true,
      }),
    });

    const message = await generateRaidGreetingMessage({
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
    expect(body.prompt).toContain("https://www.twitch.tv/raiduser");
    expect(body.prompt).toContain("1通のRaid挨拶文");
    expect(body.prompt).not.toContain("250文字");
    expect(body.prompt).not.toContain("Raid人数");
    expect(body.prompt).not.toContain("12人");
    expect(body.prompt).toContain("人数の多い少ないには触れない");
    expect(message).toBe(
      "レイドありがとうD！！ @raiduser さんは、Minecraftでたのしい建築配信をしてたD！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("returns null when Ollama rejects the request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "model failed",
    });

    await expect(
      generateRaidGreetingMessage({
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
        response:
          "A friendly Minecraft streamer raided in with 12 viewers. https://www.twitch.tv/raiduser",
        done: true,
      }),
    });

    await expect(
      generateRaidGreetingMessage({
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

describe("formatGeneratedRaidGreetingMessage", () => {
  it("keeps the generated greeting single-line and under the AI greeting limit", () => {
    const message = formatGeneratedRaidGreetingMessage(
      raidInfo,
      ` "レイドありがとうD！！ @raiduser さん、すごく${"楽しい".repeat(250)}\n配信お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser" `
    );

    expect(message).not.toContain("\n");
    expect(message).toContain("@raiduser");
    expect(message).toContain("https://www.twitch.tv/raiduser");
    expect(message?.length).toBeLessThanOrEqual(250);
    expect(message.endsWith("...")).toBe(true);
  });

  it("adds the user mention and channel URL when the model omits them", () => {
    expect(
      formatGeneratedRaidGreetingMessage(
        raidInfo,
        "レイドありがとうD！！ Minecraftの建築配信お疲れ様D！"
      )
    ).toBe(
      "レイドありがとうD！！ @raiduser さん、Minecraftの建築配信お疲れ様D！ チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("adds at mark to a bare user name and removes emoji", () => {
    expect(
      formatGeneratedRaidGreetingMessage(
        raidInfo,
        "レイドありがとうraiduser！1人で来てくれてありがとう🎉 https://www.twitch.tv/raiduser"
      )
    ).toBe(
      "レイドありがとう@raiduser！1人で来てくれてありがとう https://www.twitch.tv/raiduser"
    );
  });

  it("rejects negative comments about low raid size", () => {
    const negativeGreetings = [
      "レイドありがとう@raiduserさん！人数少なかったけど、大感謝だよ チャンネルURL→https://www.twitch.tv/raiduser",
      "レイドありがとうD！！ @raiduser さん、少人数だけど来てくれてありがとう https://www.twitch.tv/raiduser",
      "レイドありがとうD！！ @raiduser さん、ちょっと寂しいRaidだけどありがとう https://www.twitch.tv/raiduser",
    ];

    for (const greeting of negativeGreetings) {
      expect(formatGeneratedRaidGreetingMessage(raidInfo, greeting)).toBeNull();
    }
  });
});
