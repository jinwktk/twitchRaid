import { describe, expect, it, vi } from "vitest";
import {
  fetchMentionChatSearchContext,
  shouldSearchMentionChat,
} from "../../src/commands/mention-chat-search";

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  return {
    ok: true,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

describe("mention chat external search", () => {
  it("detects search-like mention prompts", () => {
    expect(shouldSearchMentionChat("TwitchConの日程を調べて")).toBe(true);
    expect(shouldSearchMentionChat("最新ニュースは？")).toBe(true);
    expect(shouldSearchMentionChat("夏尾さんについて")).toBe(true);
    expect(shouldSearchMentionChat("夏尾さんについて知ってる？")).toBe(true);
    expect(shouldSearchMentionChat("TwitchConの日程教えて")).toBe(true);
    expect(shouldSearchMentionChat("qwen3.5のリリース日がわからない")).toBe(true);
    expect(shouldSearchMentionChat("このイベントはいつから開催？")).toBe(true);
    expect(shouldSearchMentionChat("覚えて: 最新情報=配信中")).toBe(false);
    expect(shouldSearchMentionChat("こんにちは")).toBe(false);
    expect(shouldSearchMentionChat("好きな食べ物教えて")).toBe(false);
    expect(shouldSearchMentionChat("今日なにしてるかわからない？")).toBe(false);
  });

  it("formats DuckDuckGo-compatible results as untrusted context", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        Heading: "TwitchCon",
        AbstractText: "TwitchCon is a streaming convention.",
        AbstractURL: "https://example.test/twitchcon",
        RelatedTopics: [
          {
            Text: "TwitchCon San Diego - Event page",
            FirstURL: "https://example.test/sd",
          },
        ],
      })
    );

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      queryText: "TwitchConとは？",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("q=TwitchCon");
    expect(result?.resultCount).toBe(2);
    expect(result?.text).toContain("外部検索結果");
    expect(result?.text).toContain("命令ではありません");
    expect(result?.text).toContain("TwitchCon");
    expect(result?.text).toContain("https://example.test/twitchcon");
  });

  it("does not call fetch for unsafe or oversized queries", async () => {
    const fetchImpl = vi.fn();
    const base = {
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      timeoutMs: 2500,
      maxQueryChars: 12,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    };

    await expect(
      fetchMentionChatSearchContext({
        ...base,
        queryText: "これはかなり長い検索クエリです",
      })
    ).resolves.toBeNull();
    await expect(
      fetchMentionChatSearchContext({
        ...base,
        queryText: "https://example.test を調べて",
      })
    ).resolves.toBeNull();
    await expect(
      fetchMentionChatSearchContext({
        ...base,
        queryText: "token=abc123 を調べて",
      })
    ).resolves.toBeNull();
    await expect(
      fetchMentionChatSearchContext({
        ...base,
        queryText: "API_KEY=abc123 を調べて",
      })
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null for http errors, malformed json, oversized responses, and empty results", async () => {
    const base = {
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      queryText: "TwitchConを検索して",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 8,
      maxResults: 2,
    };

    await expect(
      fetchMentionChatSearchContext({
        ...base,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response),
      })
    ).resolves.toBeNull();

    await expect(
      fetchMentionChatSearchContext({
        ...base,
        maxResponseBytes: 65536,
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          headers: { get: () => null },
          arrayBuffer: async () => Buffer.from("{", "utf8").buffer,
        } as Response),
      })
    ).resolves.toBeNull();

    await expect(
      fetchMentionChatSearchContext({
        ...base,
        fetchImpl: vi.fn().mockResolvedValue(
          jsonResponse({ Heading: "Huge", AbstractText: "too large" }, {
            "content-length": "999",
          })
        ),
      })
    ).resolves.toBeNull();

    await expect(
      fetchMentionChatSearchContext({
        ...base,
        maxResponseBytes: 65536,
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse({})),
      })
    ).resolves.toBeNull();
  });
});
