import { describe, expect, it, vi } from "vitest";
import {
  fetchMentionChatMemoryHubContext,
  saveMentionChatMemoryHub,
} from "../../src/commands/mention-chat-memory-hub";

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

describe("mention chat MemoryHub integration", () => {
  it("saves mention memory requests through the Hub ingest API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        saved: true,
      })
    );

    const result = await saveMentionChatMemoryHub({
      enabled: true,
      baseUrl: "http://127.0.0.1:3217",
      namespace: "twitch",
      promptText: "覚えて: 口調=短くD",
      timeoutMs: 1200,
      fetchImpl,
    });

    expect(result).toEqual({ saved: true, reason: "saved" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3217/v1/ingest"
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      namespace: "twitch",
      text: "覚えて: 口調=短くD",
      source: "twitch-mention-chat",
    });
  });

  it("fetches prompt context from the Hub context API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        entries: [{ key: "口調", value: "短くD" }],
        contextText: "口調: 短くD",
      })
    );

    const result = await fetchMentionChatMemoryHubContext({
      enabled: true,
      baseUrl: "http://127.0.0.1:3217/",
      namespace: "twitch",
      queryText: "どう返せばいい？",
      timeoutMs: 1200,
      maxItems: 5,
      maxChars: 400,
      fetchImpl,
    });

    expect(result).toEqual({
      text: "口調: 短くD",
      itemCount: 1,
      charCount: 7,
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3217/v1/context"
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      namespace: "twitch",
      query: "どう返せばいい？",
      limit: 5,
      maxChars: 400,
    });
  });

  it("preserves multiple Hub context lines for prompt injection", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        entries: [
          { key: "口調", value: "短くD" },
          { key: "好物", value: "カレー" },
        ],
        contextText: "口調: 短くD\n\n好物: カレー",
      })
    );

    await expect(
      fetchMentionChatMemoryHubContext({
        enabled: true,
        baseUrl: "http://127.0.0.1:3217",
        namespace: "twitch",
        queryText: "好きなものは？",
        timeoutMs: 1200,
        maxItems: 5,
        maxChars: 400,
        fetchImpl,
      })
    ).resolves.toEqual({
      text: "口調: 短くD\n好物: カレー",
      itemCount: 2,
      charCount: 15,
    });
  });

  it("fails open when disabled or when the Hub request fails", async () => {
    const fetchImpl = vi.fn();

    await expect(
      saveMentionChatMemoryHub({
        enabled: false,
        baseUrl: "http://127.0.0.1:3217",
        namespace: "twitch",
        promptText: "覚えて: 口調=短くD",
        timeoutMs: 1200,
        fetchImpl,
      })
    ).resolves.toEqual({ saved: false, reason: "disabled" });
    await expect(
      fetchMentionChatMemoryHubContext({
        enabled: false,
        baseUrl: "http://127.0.0.1:3217",
        namespace: "twitch",
        queryText: "口調は？",
        timeoutMs: 1200,
        maxItems: 5,
        maxChars: 400,
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      fetchMentionChatMemoryHubContext({
        enabled: true,
        baseUrl: "http://127.0.0.1:3217",
        namespace: "twitch",
        queryText: "口調は？",
        timeoutMs: 1200,
        maxItems: 5,
        maxChars: 400,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response),
      })
    ).resolves.toBeNull();

    await expect(
      saveMentionChatMemoryHub({
        enabled: true,
        baseUrl: "http://127.0.0.1:3217",
        namespace: "twitch",
        promptText: "覚えて: 口調=短くD",
        timeoutMs: 1200,
        fetchImpl: vi.fn().mockRejectedValue(new Error("offline")),
      })
    ).resolves.toEqual({ saved: false, reason: "exception" });
  });
});
