import { describe, expect, it, vi } from "vitest";
import * as mentionChatMem0Module from "../../src/commands/mention-chat-mem0";
import {
  loadMentionChatMem0Memory,
  saveMentionChatMem0Memory,
} from "../../src/commands/mention-chat-mem0";

type ShouldRecallMentionChatMem0Memory = (
  queryText: string,
  recallGateEnabled?: boolean
) => boolean;

function shouldRecallMentionChatMem0Memory(
  queryText: string,
  recallGateEnabled = true
): boolean {
  const predicate = (
    mentionChatMem0Module as unknown as {
      shouldRecallMentionChatMem0Memory?: ShouldRecallMentionChatMem0Memory;
    }
  ).shouldRecallMentionChatMem0Memory;

  expect(
    predicate,
    "mention-chat-mem0 must expose the negative recall gate predicate"
  ).toBeTypeOf("function");
  if (!predicate) {
    throw new Error("shouldRecallMentionChatMem0Memory is not implemented");
  }
  return predicate(queryText, recallGateEnabled);
}

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
          { id: "1", memory: "好物はカレー", score: 0.91 },
          { id: "2", memory: "口調は短くD", score: 0.82 },
          { id: "3", memory: "これは上限外", score: 0.73 },
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
      threshold: 0.5,
    });
    expect(result).toEqual({
      text: "好物はカレー\n口調は短くD",
      itemCount: 2,
      charCount: 13,
      reason: "found",
    });
  });

  it("filters scores below the threshold and rejects missing, NaN, invalid-type, or out-of-range scores", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { id: "below", memory: "below: 除外", score: 0.49 },
          { id: "boundary", memory: "boundary: 採用", score: 0.5 },
          { id: "high", memory: "high: 採用", score: 1 },
          { id: "missing", memory: "missing: 除外" },
          { id: "nan", memory: "nan: 除外", score: Number.NaN },
          { id: "negative", memory: "negative: 除外", score: -0.01 },
          { id: "above-one", memory: "above-one: 除外", score: 1.01 },
          { id: "string", memory: "string: 除外", score: "0.9" },
        ],
      })
    );

    const result = await loadMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888",
      queryText: "好物について教えて",
      userId: "rukalun",
      timeoutMs: 1000,
      maxItems: 10,
      maxChars: 300,
      minScore: 0.5,
      fetchImpl,
    });
    const expectedText = "boundary: 採用\nhigh: 採用";

    expect(result).toEqual({
      text: expectedText,
      itemCount: 2,
      charCount: expectedText.length,
      reason: "found",
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      threshold: 0.5,
    });
  });

  it("accepts score zero and forwards threshold zero for the Stage 1 kill switch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { memory: "score-zero: 採用", score: 0 },
          { memory: "score-one: 採用", score: 1 },
        ],
      })
    );

    const result = await loadMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888",
      queryText: "Stage 1互換",
      userId: "rukalun",
      timeoutMs: 1000,
      maxItems: 3,
      maxChars: 300,
      minScore: 0,
      fetchImpl,
    });

    expect(result.text).toBe("score-zero: 採用\nscore-one: 採用");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      threshold: 0,
    });
  });

  it("allows missing-score legacy results only with the explicit opt-in", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ id: "legacy", memory: "好物: カレー" }] })
    );
    const baseOptions = {
      enabled: true,
      endpoint: "http://mem0:8888",
      queryText: "好きな食べ物は？",
      userId: "rukalun",
      timeoutMs: 1000,
      maxItems: 3,
      maxChars: 300,
      minScore: 0.5,
      fetchImpl,
    };

    await expect(loadMentionChatMem0Memory(baseOptions)).resolves.toEqual({
      text: null,
      itemCount: 0,
      charCount: 0,
      reason: "empty",
    });
    await expect(
      loadMentionChatMem0Memory({
        ...baseOptions,
        allowMissingScore: true,
      })
    ).resolves.toEqual({
      text: "好物: カレー",
      itemCount: 1,
      charCount: "好物: カレー".length,
      reason: "found",
    });
  });

  it("uses a negative-only recall gate without false negatives for natural memory queries", () => {
    const positiveQueries = [
      "るっかるんの好きな食べ物って何だっけ？",
      "viewerが前に好きって言ってたゲーム覚えてる？",
      "aliceについて何を覚えてる？",
      "管理画面で追加したaliceの好きな飲み物は？",
      "私はカレーが好き",
      "この前話したこと、どう思う？",
      "にめいやボットくんの口調は？",
      "私って社会人だっけ？",
      "おはよう、前に言ってた好物なんだっけ？",
      "ままっかが熱なんだって！",
    ];

    for (const query of positiveQueries) {
      expect(shouldRecallMentionChatMem0Memory(query), query).toBe(true);
    }
  });

  it("skips definite greetings, thanks, and simple reactions with the recall gate enabled", () => {
    const negativeQueries = [
      "こんにちは",
      "こんばんは！",
      "ありがとう",
      "助かった、ありがとう！",
      "なるほど",
      "そうなんだ",
      "わーい！",
      "草",
      "rukkaKusa",
    ];

    for (const query of negativeQueries) {
      expect(shouldRecallMentionChatMem0Memory(query), query).toBe(false);
    }
  });

  it("restores recall for every normal query when the recall gate kill switch is off", () => {
    for (const query of ["こんにちは", "ありがとう", "なるほど", "rukkaKusa"]) {
      expect(shouldRecallMentionChatMem0Memory(query, false), query).toBe(true);
    }
  });

  it("keeps mem0-only subjects isolated while allowing a subjectless topic result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { memory: "aliceの好物: いちご", score: 0.91 },
          { memory: "bobの好物: カレー", score: 0.9 },
          { memory: "好物: ラーメン", score: 0.82 },
        ],
      })
    );

    const result = await loadMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888",
      queryText: "aliceは何が好き？",
      userId: "rukalun",
      timeoutMs: 1000,
      maxItems: 5,
      maxChars: 300,
      minScore: 0.5,
      fetchImpl,
    });

    expect(result.text?.split("\n")).toEqual([
      "aliceの好物: いちご",
      "好物: ラーメン",
    ]);
    expect(result.itemCount).toBe(2);
    expect(result.text).not.toContain("bobの好物");
  });

  it("uses metadata keys for subject isolation when memory text is natural prose", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
          {
            memory: "いちごが好き",
            metadata: { key: "aliceの好物" },
            score: 0.91,
          },
          {
            memory: "カレーが好き",
            metadata: { key: "bobの好物" },
            score: 0.9,
          },
          {
            memory: "ラーメンが好き",
            metadata: { key: "好物" },
            score: 0.82,
          },
        ])
    );

    const result = await loadMentionChatMem0Memory({
      enabled: true,
      endpoint: "http://mem0:8888",
      queryText: "aliceは何が好き？",
      userId: "rukalun",
      timeoutMs: 1000,
      maxItems: 5,
      maxChars: 300,
      minScore: 0.5,
      fetchImpl,
    });

    expect(result.text?.split("\n")).toEqual([
      "いちごが好き",
      "ラーメンが好き",
    ]);
    expect(result.text).not.toContain("カレーが好き");
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
