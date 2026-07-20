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
    expect(shouldSearchMentionChat("TwitchConは誰が主催？")).toBe(true);
    expect(shouldSearchMentionChat("このツールは誰が開発した？")).toBe(true);
    expect(shouldSearchMentionChat("TwitchConは誰が出る？")).toBe(true);
    expect(shouldSearchMentionChat("次はいつ配信？")).toBe(true);
    expect(shouldSearchMentionChat("イベントはどこでやる？")).toBe(true);
    expect(shouldSearchMentionChat("覚えて: 最新情報=配信中")).toBe(false);
    expect(shouldSearchMentionChat("こんにちは")).toBe(false);
    expect(shouldSearchMentionChat("好きな食べ物教えて")).toBe(false);
    expect(shouldSearchMentionChat("今日なにしてるかわからない？")).toBe(false);
    expect(shouldSearchMentionChat("開催おめでとう")).toBe(false);
    expect(shouldSearchMentionChat("次の配信日程ありがとう")).toBe(false);
    expect(shouldSearchMentionChat("いつもありがとう")).toBe(false);
    expect(shouldSearchMentionChat("どこでも大丈夫")).toBe(false);
    expect(shouldSearchMentionChat("いつか遊ぼう？")).toBe(false);
    expect(shouldSearchMentionChat("誰でもいい？")).toBe(false);
    expect(shouldSearchMentionChat("どこでも大丈夫？")).toBe(false);
    expect(shouldSearchMentionChat("誰が好き？")).toBe(false);
    expect(shouldSearchMentionChat("いつ寝る？")).toBe(false);
    expect(shouldSearchMentionChat("どこ行きたい？")).toBe(false);
    expect(shouldSearchMentionChat("TwitchConは誰が好き？")).toBe(false);
    expect(shouldSearchMentionChat("次の配信いつ寝る？")).toBe(false);
    expect(shouldSearchMentionChat("イベントどこ行きたい？")).toBe(false);
    expect(shouldSearchMentionChat("イベント楽しかった？知らない")).toBe(false);
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

  it("formats SearXNG results and can restrict the request to Google", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "るっかるん rukalun",
        results: [
          {
            title: "るっかるん - Twitch",
            content: "るっかるんさんのTwitchチャンネル。",
            url: "https://www.twitch.tv/rukalun",
            engine: "google",
          },
          {
            title: "るっかるん - X",
            content: "配信告知や日常投稿。",
            url: "https://x.com/rukalun",
            engine: "google",
          },
        ],
      })
    );

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search?language=all&safesearch=0",
      engines: "google",
      queryText: "るっかるんについて調べて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("language")).toBe("all");
    expect(url.searchParams.get("safesearch")).toBe("0");
    expect(url.searchParams.get("q")).toBe("るっかるん rukalun");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("engines")).toBe("google");
    expect(result?.resultCount).toBe(2);
    expect(result?.text).toContain("るっかるん - Twitch");
    expect(result?.text).toContain("るっかるんさんのTwitchチャンネル。");
    expect(result?.text).toContain("https://www.twitch.tv/rukalun");
  });

  it("searches the subject when an explicit search request is followed by another action", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "森のくまさん 替え歌",
        results: [
          {
            title: "森のくまさん替え歌",
            content: "森のくまさんを元にした替え歌を紹介する記事。",
            url: "https://example.test/parody",
            engine: "bing",
          },
        ],
      })
    );

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search?language=all&safesearch=0",
      engines: "bing",
      queryText: "森のくまさんの替え歌を調べて、うたって",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("森のくまさん 替え歌");
    expect(result?.resultCount).toBe(1);
    expect(result?.text).toContain("森のくまさん替え歌");
  });

  it("does not treat two separate information questions as a comparison", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "発売日はいつ 価格はいくら",
        results: [
          {
            title: "発売日はいつ、価格はいくら",
            content: "発売日と価格を案内する記事。",
            url: "https://example.test/product-info",
            engine: "bing",
          },
        ],
      })
    );

    await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "発売日はいつ？価格はいくら？",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("発売日はいつ 価格はいくら");
  });

  it("falls back to Japanese Wikipedia when SearXNG has no usable result", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://searxng.test/")) {
        return jsonResponse({ query: "レゲエパンチ", results: [] });
      }
      if (url.startsWith("https://ja.wikipedia.org/api/rest_v1/page/summary/")) {
        return jsonResponse({
          title: "レゲエパンチ",
          extract:
            "レゲエパンチは、宮城県仙台市のご当地カクテル。ピーチリキュールの烏龍茶割り。",
          content_urls: {
            desktop: {
              page: "https://ja.wikipedia.org/wiki/レゲエパンチ",
            },
          },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search?language=all&safesearch=0",
      engines: "google",
      queryText: "レゲエパンチについて調べて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("q=%E3%83%AC%E3%82%B2%E3%82%A8%E3%83%91%E3%83%B3%E3%83%81");
    expect(String(fetchImpl.mock.calls[1][0])).toContain(
      "https://ja.wikipedia.org/api/rest_v1/page/summary/"
    );
    expect(result?.resultCount).toBe(1);
    expect(result?.text).toContain("レゲエパンチ");
    expect(result?.text).toContain("ピーチリキュールの烏龍茶割り");
  });

  it("uses Japanese Wikipedia instead of noisy SearXNG results without the exact query", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://searxng.test/")) {
        return jsonResponse({
          query: "レゲエパンチ",
          results: [
            {
              title: "レゲエ - Wikipedia",
              content: "ジャマイカ発祥の音楽ジャンル。",
              url: "https://ja.wikipedia.org/wiki/レゲエ",
            },
          ],
        });
      }
      if (url.startsWith("https://ja.wikipedia.org/api/rest_v1/page/summary/")) {
        return jsonResponse({
          title: "レゲエパンチ",
          extract:
            "レゲエパンチは、宮城県仙台市のご当地カクテル。ピーチリキュールの烏龍茶割り。",
          content_urls: {
            desktop: {
              page: "https://ja.wikipedia.org/wiki/レゲエパンチ",
            },
          },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search?language=all&safesearch=0",
      engines: "bing",
      queryText: "レゲエパンチについて調べて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(result?.text).toContain("レゲエパンチ");
    expect(result?.text).toContain("ピーチリキュールの烏龍茶割り");
    expect(result?.text).not.toContain("ジャマイカ発祥の音楽ジャンル");
  });

  it.each([
    ["Wikipedia non-OK", { ok: false, status: 404 } as Response],
    [
      "Wikipedia empty",
      jsonResponse({
        title: "レゲエパンチ",
        extract: "",
        content_urls: {},
      }),
    ],
  ])(
    "returns null for mismatched SearXNG noise when %s cannot provide a summary",
    async (_scenario, wikipediaResponse) => {
      const fetchImpl = vi.fn().mockImplementation(async (input) => {
        const url = String(input);
        if (url.startsWith("http://searxng.test/")) {
          return jsonResponse({
            query: "レゲエパンチ",
            results: [
              {
                title: "レゲエ - Wikipedia",
                content: "ジャマイカ発祥の音楽ジャンル。",
                url: "https://ja.wikipedia.org/wiki/レゲエ",
              },
            ],
          });
        }
        if (url.startsWith("https://ja.wikipedia.org/api/rest_v1/page/summary/")) {
          return wikipediaResponse;
        }
        throw new Error(`unexpected url: ${url}`);
      });

      const result = await fetchMentionChatSearchContext({
        enabled: true,
        provider: "searxng",
        endpoint: "http://searxng.test/search?language=all&safesearch=0",
        engines: "bing",
        queryText: "レゲエパンチについて調べて",
        timeoutMs: 2500,
        maxQueryChars: 120,
        maxResponseBytes: 65536,
        maxResults: 2,
        fetchImpl,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    }
  );

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

  it("can force a safe research search even when the prompt is not a normal search candidate", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        Heading: "るか吉",
        AbstractText: "るか吉はおみくじの最上位枠で、出現率は0.01%。",
        AbstractURL: "https://example.test/rukakichi",
      })
    );

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      queryText: "るか吉は何パーセント？",
      force: true,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(shouldSearchMentionChat("るか吉は何パーセント？")).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "q=%E3%82%8B%E3%81%8B%E5%90%89"
    );
    expect(result?.text).toContain("るか吉");
    expect(result?.text).toContain("出現率は0.01%");
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
