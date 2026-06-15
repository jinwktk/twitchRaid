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

  it("does not match partial names", () => {
    expect(
      extractMentionChatPrompt("@rukalun_bot2 こんにちは", ["rukalun_bot"])
    ).toBeNull();
    expect(
      extractMentionChatPrompt("＠rukalun_bot2 こんにちは", ["rukalun_bot"])
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
      keep_alive: "30m",
      options: {
        temperature: 0.7,
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
      "⚠️ AIメンション会話生成失敗: reason=policy_rejected"
    );
  });
});
