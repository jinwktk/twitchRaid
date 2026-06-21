import { describe, expect, it, vi } from "vitest";
import {
  loadMentionChatMem0Memory,
  saveMentionChatMem0Memory,
} from "../../src/commands/mention-chat-mem0";

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

describe("mention chat mem0 OSS integration", () => {
  it("does not call HTTP when disabled or missing a self-host endpoint", async () => {
    const fetchImpl = vi.fn();

    await expect(
      loadMentionChatMem0Memory({
        enabled: false,
        endpoint: "http://mem0:8888",
        queryText: "好きな食べ物は？",
        userId: "rukalun",
        timeoutMs: 1000,
        maxItems: 3,
        maxChars: 300,
        fetchImpl,
      })
    ).resolves.toEqual({
      text: null,
      itemCount: 0,
      charCount: 0,
      reason: "disabled",
    });

    await expect(
      saveMentionChatMem0Memory({
        enabled: true,
        endpoint: "",
        userId: "rukalun",
        timeoutMs: 1000,
        entry: { key: "好物", value: "カレー" },
        kind: "semantic",
        sourceUser: "viewer",
        fetchImpl,
      })
    ).resolves.toEqual({ saved: false, reason: "missing_endpoint" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses the hosted Mem0 Platform endpoint to avoid cost risk", async () => {
    const fetchImpl = vi.fn();

    await expect(
      loadMentionChatMem0Memory({
        enabled: true,
        endpoint: "https://api.mem0.ai",
        queryText: "好きな食べ物は？",
        userId: "rukalun",
        timeoutMs: 1000,
        maxItems: 3,
        maxChars: 300,
        fetchImpl,
      })
    ).resolves.toEqual({
      text: null,
      itemCount: 0,
      charCount: 0,
      reason: "hosted_not_allowed",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches a self-host Mem0 OSS endpoint and formats capped memories", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { id: "1", memory: "好物はカレー" },
          { id: "2", memory: "口調は短くD" },
          { id: "3", memory: "これは上限外" },
        ],
      })
    );

    const result = await loadMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888/",
      apiKey: "local-key",
      queryText: "好きな食べ物は？",
      userId: "rukalun",
      agentId: "twitchRaid",
      appId: "chat",
      timeoutMs: 1000,
      maxItems: 2,
      maxChars: 30,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://mem0:8888/search",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "local-key",
        },
      })
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      query: "好きな食べ物は？",
      filters: {
        user_id: "rukalun",
        agent_id: "twitchRaid",
      },
      top_k: 2,
    });
    expect(result).toEqual({
      text: "好物はカレー\n口調は短くD",
      itemCount: 2,
      charCount: 13,
      reason: "found",
    });
  });

  it("adds extracted memory to a self-host Mem0 OSS endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ id: "1", memory: "好物: カレー" }] })
    );

    const result = await saveMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888",
      userId: "rukalun",
      agentId: "twitchRaid",
      appId: "chat",
      timeoutMs: 1000,
      entry: { key: "好物", value: "カレー" },
      kind: "semantic",
      sourceUser: "viewer",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://mem0:8888/memories",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      messages: [{ role: "user", content: "好物: カレー" }],
      infer: false,
      user_id: "rukalun",
      agent_id: "twitchRaid",
      metadata: {
        key: "好物",
        kind: "semantic",
        sourceUser: "viewer",
        source: "twitchRaid",
        app_id: "chat",
      },
    });
    expect(result).toEqual({ saved: true, reason: "saved" });
  });

  it("fails open when mem0 search or save throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("mem0 down"));

    await expect(
      loadMentionChatMem0Memory({
        enabled: true,
        endpoint: "http://mem0:8888",
        queryText: "好きな食べ物は？",
        userId: "rukalun",
        timeoutMs: 1000,
        maxItems: 3,
        maxChars: 300,
        fetchImpl,
      })
    ).resolves.toEqual({
      text: null,
      itemCount: 0,
      charCount: 0,
      reason: "failed",
    });

    await expect(
      saveMentionChatMem0Memory({
        enabled: true,
        endpoint: "http://mem0:8888",
        userId: "rukalun",
        timeoutMs: 1000,
        entry: { key: "好物", value: "カレー" },
        kind: "implicit",
        sourceUser: "viewer",
        fetchImpl,
      })
    ).resolves.toEqual({ saved: false, reason: "failed" });
  });
});
