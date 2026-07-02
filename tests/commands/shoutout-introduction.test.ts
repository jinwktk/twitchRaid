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

const miiyuetaroRaidInfo: RaidSourceInfo = {
  userName: "miiyuetaro",
  streamUrl: "https://www.twitch.tv/miiyuetaro",
  title:
    "今日の固定活動終わり！明日のお知らせ作る裏作業雑談！【わちゃわちゃおおかみべいびー🐺🍑🍼】 @miiyuetaro",
  gameName: "Just Chatting",
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
      think: false,
      keep_alive: "5m",
      options: {
        temperature: 0.8,
        num_predict: 180,
      },
    });
    expect(body.prompt).toContain("RaidUser");
    expect(body.prompt).toContain("Minecraft");
    expect(body.prompt).toContain("たのしい建築配信");
    expect(body.prompt).toContain("https://www.twitch.tv/raiduser");
    expect(body.prompt).toContain("1通のRaid挨拶文");
    expect(body.prompt).toContain("紹介文");
    expect(body.prompt).toContain("ゲーム名と配信タイトル");
    expect(body.prompt).toContain("何をして遊んでいたか");
    expect(body.prompt).toContain("500文字以内");
    expect(body.prompt).toContain("なるべく長め");
    expect(body.prompt).toContain("詳しく紹介");
    expect(body.prompt).toContain("文字数上限でありRaid人数ではありません");
    expect(body.prompt).not.toContain("250文字");
    expect(body.prompt).not.toContain("短い文");
    expect(body.prompt).not.toContain("手短");
    expect(body.prompt).not.toContain("Raid人数: 12");
    expect(body.prompt).not.toContain("viewerCount");
    expect(body.prompt).not.toContain("12人");
    expect(body.prompt).toContain("人数の多い少ないには触れない");
    expect(body.system).toContain("Twitch Raidへのお礼と紹介文");
    expect(body.system).toContain("500文字以内");
    expect(body.system).toContain("詳しめ");
    expect(body.system).not.toContain("短く");
    expect(message).toBe(
      "レイドありがとうD！！ @raiduser さんは、Minecraftでたのしい建築配信をしてたD！チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("returns null when Ollama rejects the request", async () => {
    const decisions: unknown[] = [];
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
        onDecision: (decision) => decisions.push(decision),
      })
    ).resolves.toBeNull();
    expect(decisions).toEqual([
      expect.objectContaining({
        status: "fallback",
        reason: "http_error",
        userName: "raiduser",
        detail: "HTTP 500",
      }),
    ]);
  });

  it("returns null when Ollama responds without Japanese kana", async () => {
    const decisions: unknown[] = [];
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
        onDecision: (decision) => decisions.push(decision),
      })
    ).resolves.toBeNull();
    expect(decisions).toEqual([
      expect.objectContaining({
        status: "fallback",
        reason: "empty_or_non_japanese",
        userName: "raiduser",
      }),
    ]);
  });

  it("reports when a valid Ollama greeting is adopted", async () => {
    const decisions: unknown[] = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response:
          "レイドありがとうD！！ @raiduser さん、Minecraftでたのしい建築配信をしてたD！ https://www.twitch.tv/raiduser",
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
        onDecision: (decision) => decisions.push(decision),
      })
    ).resolves.toContain("@raiduser");
    expect(decisions).toEqual([
      expect.objectContaining({
        status: "generated",
        userName: "raiduser",
      }),
    ]);
  });
});

describe("formatGeneratedRaidGreetingMessage", () => {
  it("keeps the generated greeting single-line and under the Twitch chat limit", () => {
    const message = formatGeneratedRaidGreetingMessage(
      raidInfo,
      ` "レイドありがとうD！！ @raiduser さん、Minecraftでたのしい建築配信をしながら、すごく${"楽しい".repeat(250)}\n配信お疲れ様D！チャンネルはこD→https://www.twitch.tv/raiduser" `
    );

    expect(message).not.toContain("\n");
    expect(message).toContain("@raiduser");
    expect(message).toContain("https://www.twitch.tv/raiduser");
    expect(message?.length).toBeLessThanOrEqual(500);
    expect(message).toContain("...");
  });

  it("keeps valid generated greetings longer than the former 250 character limit", () => {
    const message = formatGeneratedRaidGreetingMessage(
      raidInfo,
      `レイドありがとうD！！ @raiduser さん、Minecraftでたのしい建築配信をしてたD！${"建築の工夫やのんびりした空気が伝わる配信で、初見さんにも見どころが分かりやすくて、作業の進み方も楽しく追える内容だったD！".repeat(3)}来てくれてありがとうD！チャンネルはこD→https://www.twitch.tv/raiduser`
    );

    expect(message).toContain("@raiduser");
    expect(message).toContain("https://www.twitch.tv/raiduser");
    expect(message).toContain("来てくれてありがとうD！");
    expect(message?.length).toBeGreaterThan(250);
    expect(message?.length).toBeLessThanOrEqual(500);
    expect(message).not.toContain("...");
  });

  it("adds the user mention and channel URL when the model omits them", () => {
    expect(
      formatGeneratedRaidGreetingMessage(
        raidInfo,
        "レイドありがとうD！！ Minecraftでたのしい建築配信をしてたD！"
      )
    ).toBe(
      "レイドありがとうD！！ @raiduser さん、Minecraftでたのしい建築配信をしてたD！ チャンネルはこD→https://www.twitch.tv/raiduser"
    );
  });

  it("adds at mark to a bare user name and removes emoji", () => {
    expect(
      formatGeneratedRaidGreetingMessage(
        raidInfo,
        "レイドありがとうraiduser！Minecraftでたのしい建築配信をしてたD！来てくれてありがとう🎉 https://www.twitch.tv/raiduser"
      )
    ).toBe(
      "レイドありがとう@raiduser！Minecraftでたのしい建築配信をしてたD！来てくれてありがとう https://www.twitch.tv/raiduser"
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

  it("repairs generated greetings that omit the game or stream title", () => {
    const titleOnly = formatGeneratedRaidGreetingMessage(
      raidInfo,
      "レイドありがとうD！！ @raiduser さん、たのしい建築配信お疲れ様D！ https://www.twitch.tv/raiduser"
    );
    expect(titleOnly).toContain("Minecraft");
    expect(titleOnly?.match(/たのしい建築配信/g)).toHaveLength(1);

    const gameOnly = formatGeneratedRaidGreetingMessage(
      raidInfo,
      "レイドありがとうD！！ @raiduser さん、Minecraftで遊んでたD！ https://www.twitch.tv/raiduser"
    );
    expect(gameOnly).toContain("たのしい建築配信");
    expect(gameOnly?.match(/Minecraft/g)).toHaveLength(1);

    const missingBoth = formatGeneratedRaidGreetingMessage(
      raidInfo,
      "レイドありがとうD！！ @raiduser さん、来てくれてありがとうD！ https://www.twitch.tv/raiduser"
    );
    expect(missingBoth).toContain("Minecraft");
    expect(missingBoth).toContain("たのしい建築配信");
    expect(missingBoth).toContain("https://www.twitch.tv/raiduser");
  });

  it("does not append a full stream detail sentence when the generated greeting already summarizes the stream", () => {
    const message = formatGeneratedRaidGreetingMessage(
      miiyuetaroRaidInfo,
      "レイドありがとうmiiyuetaro！Just Chattingの今日の固定活動終わり！明日のお知らせ作る裏作業雑談見守らせて頂きます！@miiyuetaro チャンネルはこD→ https://www.twitch.tv/miiyuetaro"
    );

    expect(message).toContain("Just Chatting");
    expect(message).toContain("今日の固定活動終わり");
    expect(message).toContain("明日のお知らせ作る裏作業雑談");
    expect(message).not.toContain("配信では");
    expect(message?.match(/Just Chatting/g)).toHaveLength(1);
    expect(message).toBe(
      "レイドありがとうmiiyuetaro！Just Chattingの今日の固定活動終わり！明日のお知らせ作る裏作業雑談見守らせて頂きます！@miiyuetaro チャンネルはこD→ https://www.twitch.tv/miiyuetaro"
    );
  });
});
