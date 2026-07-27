import { describe, expect, it, vi } from "vitest";
import {
  fetchMentionChatSearchContext,
  fetchMentionChatSearchContextDetailed,
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

  it("removes the object particle from a natural weather request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "今日の天気",
        results: [
          {
            title: "東京都八王子市の天気予報",
            content: "八王子市の天気予報を今日明日・週間で掲載中です。",
            url: "https://example.test/weather",
            engine: "bing",
          },
        ],
      })
    );

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("今日の天気");
    expect(result.reason).toBe("found");
    expect(result.context?.text).toContain("東京都八王子市の天気予報");
  });

  it("keeps an explicit weather location in the relevance check", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "大阪の今日の天気",
          results: [
            {
              title: "東京都八王子市の天気予報",
              content: "八王子市の天気予報を今日明日・週間で掲載中です。",
              url: "https://example.test/weather",
              engine: "bing",
            },
          ],
        });
      }
      return { ok: false, status: 404 } as Response;
    });

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "大阪の今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(result).toEqual({ context: null, reason: "no_result" });
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

  it("searches both subjects separately when a compact comparison has no combined result", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q");
      if (query === "タン塩 塩タン 違い") {
        return jsonResponse({
          query,
          results: [
            {
              title: "牛タンの焼き方",
              content: "タン塩を焼く時の一般的な手順。",
              url: "https://example.test/grilling",
              engine: "bing",
            },
          ],
        });
      }
      if (query === "タン塩") {
        return jsonResponse({
          query,
          results: [
            {
              title: "タン塩という呼び方",
              content: "牛タンを塩味で食べる料理の呼び方。",
              url: "https://example.test/tan-shio",
              engine: "bing",
            },
          ],
        });
      }
      if (query === "塩タン") {
        return jsonResponse({
          query,
          results: [
            {
              title: "塩タンという呼び方",
              content: "地域や店によって使われる牛タン料理の呼び方。",
              url: "https://example.test/shio-tan",
              engine: "bing",
            },
          ],
        });
      }
      if (String(input).startsWith("https://ja.wikipedia.org/")) {
        return { ok: false, status: 404 } as Response;
      }
      throw new Error(`unexpected url: ${String(input)}`);
    });

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "タン塩？塩タン？",
      force: true,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    const sentQueries = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.hostname === "searxng.test")
      .map((url) => url.searchParams.get("q"));
    expect(sentQueries).toEqual([
      "タン塩 塩タン 違い",
      "タン塩",
      "塩タン",
    ]);
    expect(result?.resultCount).toBe(2);
    expect(result?.text).toContain("タン塩という呼び方");
    expect(result?.text).toContain("塩タンという呼び方");
  });

  it("keeps a separate comparison lookup failure as failed", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q");
      if (query === "タン塩 塩タン 違い") {
        return jsonResponse({ query, results: [] });
      }
      if (query === "タン塩") {
        throw new Error("network unavailable");
      }
      if (query === "塩タン") {
        return jsonResponse({
          query,
          results: [
            {
              title: "塩タンという呼び方",
              content: "牛タン料理の呼び方。",
              url: "https://example.test/shio-tan",
            },
          ],
        });
      }
      if (String(input).startsWith("https://ja.wikipedia.org/")) {
        return { ok: false, status: 404 } as Response;
      }
      throw new Error(`unexpected url: ${String(input)}`);
    });

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "タン塩？塩タン？",
      force: true,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(result).toEqual({ context: null, reason: "failed" });
  });

  it("shares one overall deadline across comparison fallback searches", async () => {
    let nowMs = 1_000;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q");
      if (query === "タン塩 塩タン 違い") {
        nowMs += 100;
        return jsonResponse({ query, results: [] });
      }
      throw new Error(`deadlineを超えて検索した: ${String(input)}`);
    });

    try {
      const result = await fetchMentionChatSearchContextDetailed({
        enabled: true,
        provider: "searxng",
        endpoint: "http://searxng.test/search",
        engines: "bing",
        queryText: "タン塩？塩タン？",
        force: true,
        timeoutMs: 100,
        maxQueryChars: 120,
        maxResponseBytes: 65536,
        maxResults: 2,
        fetchImpl,
      });

      expect(result).toEqual({ context: null, reason: "failed" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      dateNow.mockRestore();
    }
  });

  it("rejects unrelated results for short separate comparison subjects", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const query = url.searchParams.get("q");
      if (query === "猫 犬 違い") {
        return jsonResponse({ query, results: [] });
      }
      if (query === "猫") {
        return jsonResponse({
          query,
          results: [
            {
              title: "今日の天気",
              content: "全国的に晴れる見込み。",
              url: "https://example.test/weather",
            },
          ],
        });
      }
      if (query === "犬") {
        return jsonResponse({
          query,
          results: [
            {
              title: "夕食の献立",
              content: "季節の野菜を使った料理。",
              url: "https://example.test/dinner",
            },
          ],
        });
      }
      if (String(input).startsWith("https://ja.wikipedia.org/")) {
        return { ok: false, status: 404 } as Response;
      }
      throw new Error(`unexpected url: ${String(input)}`);
    });

    const result = await fetchMentionChatSearchContext({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "猫？犬？",
      force: true,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(result).toBeNull();
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
