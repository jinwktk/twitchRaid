import { describe, expect, it, vi } from "vitest";
import logger from "../../src/utils/logger";
import {
  extractMentionChatPrompt,
  formatGeneratedMentionChatReply,
  generateMentionChatReply,
  resolveMentionChatAliases,
} from "../../src/commands/mention-chat";

describe("extractMentionChatPrompt", () => {
  it("detects bot mention aliases and extracts prompt text", () => {
    expect(
      extractMentionChatPrompt("@rukalun_bot こんにちは", [
        "rukalun",
        "rukalun_bot",
      ])
    ).toEqual({
      alias: "rukalun_bot",
      prompt: "こんにちは",
    });
  });

  it("detects full-width at-mark mentions", () => {
    expect(
      extractMentionChatPrompt("＠rukalun_bot こんにちは", [
        "rukalun",
        "rukalun_bot",
      ])
    ).toEqual({
      alias: "rukalun_bot",
      prompt: "こんにちは",
    });
  });

  it("detects the Nyme bot aliases", () => {
    const aliases = ["にめいやボットくん", "nyme_ia2"];

    expect(
      extractMentionChatPrompt("@にめいやボットくん なにしてるの？", aliases)
    ).toEqual({
      alias: "にめいやボットくん",
      prompt: "なにしてるの？",
    });
    expect(extractMentionChatPrompt("@nyme_ia2 なにしてるの？", aliases)).toEqual({
      alias: "nyme_ia2",
      prompt: "なにしてるの？",
    });
    expect(extractMentionChatPrompt("@るっかるん なにしてるの？", aliases)).toBeNull();
  });

  it("does not match partial names", () => {
    expect(
      extractMentionChatPrompt("@rukalun_bot2 こんにちは", ["rukalun_bot"])
    ).toBeNull();
    expect(
      extractMentionChatPrompt("＠rukalun_bot2 こんにちは", ["rukalun_bot"])
    ).toBeNull();
    expect(
      extractMentionChatPrompt("@nyme_ia2x こんにちは", ["nyme_ia2"])
    ).toBeNull();
    expect(
      extractMentionChatPrompt("@にめいやボットくんさん なにしてるの？", [
        "にめいやボットくん",
      ])
    ).toBeNull();
  });

  it("resolves default aliases from login channel when aliases are empty", () => {
    expect(resolveMentionChatAliases([], "Rukalun")).toEqual(["rukalun"]);
    expect(
      resolveMentionChatAliases([" ＠Rukalun_Bot ", "rukalun"], "Rukalun")
    ).toEqual(["rukalun_bot", "rukalun"]);
  });
});

describe("formatGeneratedMentionChatReply", () => {
  it("formats generated replies for Twitch chat", () => {
    const reply = formatGeneratedMentionChatReply(
      ` "今日はいい感じD！\\nたのしんでいこー！🐺" `,
      16
    );

    expect(reply).toBe("今日はいい感じD！ たのし...");
    expect(reply).not.toContain("\n");
  });

  it("does not include command-like generated text that starts with !", () => {
    expect(formatGeneratedMentionChatReply("!今日はいい感じD！", 200)).toBe(
      "今日はいい感じD！"
    );
    expect(formatGeneratedMentionChatReply('"!今日はいい感じD！"', 200)).toBe(
      "今日はいい感じD！"
    );
  });

  it("rejects low-information generated replies", () => {
    expect(formatGeneratedMentionChatReply("める！", 200)).toBeNull();
    expect(formatGeneratedMentionChatReply("え？", 200)).toBeNull();
    expect(formatGeneratedMentionChatReply("スコア100", 200)).toBeNull();
  });
});

describe("generateMentionChatReply", () => {
  it("requests Ollama generate API with a chat-specific prompt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: "こんにちはD！配信たのしんでいってね！",
      }),
    });

    const reply = await generateMentionChatReply({
      enabled: true,
      baseUrl: "http://127.0.0.1:11434/",
      model: "qwen2.5:7b",
      timeoutMs: 3000,
      keepAlive: "30m",
      maxResponseChars: 200,
      channel: "#rukalun",
      userName: "viewer",
      promptText: "こんにちは",
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
      model: "qwen2.5:7b",
      stream: false,
      think: false,
      keep_alive: "30m",
      options: {
        temperature: 0.4,
        num_predict: 80,
      },
    });
    expect(body.system).toContain("日本語");
    expect(body.system).toContain("秘密");
    expect(body.prompt).toContain("viewer");
    expect(body.prompt).toContain("こんにちは");
    expect(body.prompt).not.toContain("TWITCH_ACCESS_TOKEN");
    expect(reply).toBe("こんにちはD！配信たのしんでいってね！");
  });

  it("passes a stream image to Ollama when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "画面にはゲーム画面が見えるよD！" }),
    });

    const reply = await generateMentionChatReply({
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5vl:7b",
      timeoutMs: 3000,
      keepAlive: "30m",
      maxResponseChars: 200,
      channel: "#rukalun",
      userName: "viewer",
      promptText: "この試合かてる？",
      streamImageBase64: "AQID",
      fetchImpl,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("qwen2.5vl:7b");
    expect(body.images).toEqual(["AQID"]);
    expect(body.system).toContain("画像から分かる内容");
    expect(body.prompt).toContain("ユーザーの質問に画像から分かる範囲");
    expect(body.prompt).toContain("ゲーム名");
    expect(body.prompt).toContain("勝敗や今後の展開は断定しない");
    expect(body.prompt).toContain("数字や単語だけの返答は禁止");
    expect(body.prompt).toContain("聞き返し");
    expect(body.prompt).toContain("「え？」だけ");
    expect(reply).toBe("画面にはゲーム画面が見えるよD！");
  });

  it("uses a safe fallback for low-information match outcome replies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "スコア100" }),
    });

    const reply = await generateMentionChatReply({
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "gemma3:4b",
      timeoutMs: 3000,
      keepAlive: "30m",
      maxResponseChars: 200,
      channel: "#rukalun",
      userName: "viewer",
      promptText: "この試合かてる？",
      streamImageBase64: "AQID",
      fetchImpl,
    });

    expect(reply).toBe("画面だけだと断定できないけど、まだいけそうD！");
  });

  it("returns null when disabled or missing model", async () => {
    const fetchImpl = vi.fn();

    await expect(
      generateMentionChatReply({
        enabled: false,
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen2.5:7b",
        timeoutMs: 3000,
        maxResponseChars: 200,
        channel: "#rukalun",
        userName: "viewer",
        promptText: "こんにちは",
        fetchImpl,
      })
    ).resolves.toBeNull();

    await expect(
      generateMentionChatReply({
        enabled: true,
        baseUrl: "http://127.0.0.1:11434",
        model: "",
        timeoutMs: 3000,
        maxResponseChars: 200,
        channel: "#rukalun",
        userName: "viewer",
        promptText: "こんにちは",
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null for http error, invalid response, empty response, and non-Japanese response", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const baseOptions = {
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5:7b",
      timeoutMs: 3000,
      maxResponseChars: 200,
      channel: "#rukalun",
      userName: "viewer",
      promptText: "hello",
    };

    await expect(
      generateMentionChatReply({
        ...baseOptions,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      })
    ).resolves.toBeNull();

    await expect(
      generateMentionChatReply({
        ...baseOptions,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ response: 123 }),
        }),
      })
    ).resolves.toBeNull();

    await expect(
      generateMentionChatReply({
        ...baseOptions,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ response: "   " }),
        }),
      })
    ).resolves.toBeNull();

    await expect(
      generateMentionChatReply({
        ...baseOptions,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ response: "Hello there" }),
        }),
      })
    ).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalledWith(
      "⚠️ AIメンション会話生成失敗: reason=http_error, status=500"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "⚠️ AIメンション会話生成失敗: reason=invalid_response, responseType=number"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("⚠️ AIメンション会話生成失敗: reason=policy_rejected")
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('raw="Hello there"'));
  });
});
