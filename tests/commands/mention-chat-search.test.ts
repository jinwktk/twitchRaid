import { describe, expect, it, vi } from "vitest";
import {
  applyMentionChatTodayWeatherReplyContract,
  applyMentionChatWeatherReplyContract,
  fetchMentionChatSearchContext,
  fetchMentionChatSearchContextDetailed,
  shouldAlwaysSynthesizeMentionChatSearchReply,
  shouldRepairMentionChatReplyFromSearchContext,
  shouldResearchMentionChatReply,
  shouldSearchMentionChat,
} from "../../src/commands/mention-chat-search";

const TENKI_TODAY_FORECAST_HTML = `<script type="application/ld+json">${JSON.stringify(
  {
    "@type": "Dataset",
    name: "鹿児島市の今日の天気予報",
    temporalCoverage: "2026-07-27",
    mainEntity: {
      "csvw:tableSchema": {
        "csvw:columns": [
          {
            "csvw:name": "今日の天気",
            "csvw:cells": [{ "csvw:value": "雨のち晴" }],
          },
          {
            "csvw:name": "今日の最高気温(℃)",
            "csvw:cells": [{ "csvw:value": "36" }],
          },
          {
            "csvw:name": "今日の最低気温(℃)",
            "csvw:cells": [{ "csvw:value": "28" }],
          },
        ],
      },
    },
  }
)}</script>`;

const TENKI_TOMORROW_FORECAST_HTML = `${TENKI_TODAY_FORECAST_HTML.replaceAll(
  "鹿児島市",
  "大阪市"
)}
<section class="tomorrow-weather"><!-- 明日の天気 -->
  <div class="date-box">明日&nbsp;07月28日<span>（火）</span></div>
  <p class="weather-telop">晴一時雨</p>
  <dl class="date-value">
    <dt class="high-temp sumarry">最高</dt>
    <dd class="high-temp temp"><span class="value">33</span><span class="unit">℃</span></dd>
    <dt class="low-temp sumarry">最低</dt>
    <dd class="low-temp temp"><span class="value">27</span><span class="unit">℃</span></dd>
  </dl>
</section>`;

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
    expect(shouldSearchMentionChat("呪術廻戦のネタバレして")).toBe(true);
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
    expect(shouldSearchMentionChat("ネタバレしてほしくない")).toBe(false);
    expect(
      shouldSearchMentionChat("呪術廻戦のネタバレを調べてほしくない")
    ).toBe(false);
    expect(
      shouldSearchMentionChat("呪術廻戦のネタバレを検索しないで")
    ).toBe(false);
    expect(
      shouldSearchMentionChat("呪術廻戦のネタバレをググってほしくない")
    ).toBe(false);
  });

  it("detects a generated refusal that claims external search is unavailable", () => {
    expect(
      shouldResearchMentionChatReply(
        "えーっと、私ってそういう外部検索とかする能力ないからさぁ。"
      )
    ).toBe(true);
    expect(
      shouldResearchMentionChatReply(
        "リアルタイムで外部検索とかはできないんだよね。"
      )
    ).toBe(true);
    expect(
      shouldResearchMentionChatReply(
        "外部検索で確認した結果、宿儺との最終決戦後の話だよ。"
      )
    ).toBe(false);
  });

  it("repairs uncertain wording only after search context was already found", () => {
    const uncertainReply =
      "検索結果だと、最終回は生き残ったメンバーが日常に戻る後日談みたいな感じなのかな？俺はあんまり深く追ってないんだよね。";
    const liveRefusalReply =
      "えーっと、ネタバレって聞かれたけど、私はそういうの得意じゃないんだよね。検索結果を見ても最終回の結末とか後日談についての情報はあるみたいだけど、私自身がちゃんと把握してるわけじゃないから、断言することはできないな。ごめんね。";
    const liveSoftRefusalReply =
      "えーっと、ネタバレとかはちょっと難しいかな〜。でも、みんなが気になるのは最終回とかの結末なんだよね！";
    const liveAvoidanceReply =
      "えー、ネタバレとか怖いよ〜！今は色々やってるから、そういう話は後でゆっくり聞かせてくれると嬉しいな！";

    expect(shouldResearchMentionChatReply(uncertainReply)).toBe(false);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(uncertainReply)
    ).toBe(true);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(
        "外部検索で確認した結果、宿儺との最終決戦後の話だよ。"
      )
    ).toBe(false);
    expect(shouldResearchMentionChatReply(liveRefusalReply)).toBe(false);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(liveRefusalReply)
    ).toBe(true);
    expect(shouldResearchMentionChatReply(liveSoftRefusalReply)).toBe(false);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(liveSoftRefusalReply)
    ).toBe(true);
    expect(shouldResearchMentionChatReply(liveAvoidanceReply)).toBe(false);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(liveAvoidanceReply)
    ).toBe(true);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(
        "このゲームは難しいかな？ホラーは怖いよ〜！後でゆっくり聞かせてくれると嬉しい。"
      )
    ).toBe(false);
    expect(
      shouldRepairMentionChatReplyFromSearchContext(
        "ネタバレが怖い人向けに結末を説明すると、最終決戦後に虎杖たちは日常へ戻るよ。"
      )
    ).toBe(false);
  });

  it("always synthesizes an explicit spoiler request after search results were found", () => {
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply(
        "呪術廻戦のネタバレを調べて"
      )
    ).toBe(true);
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply("呪術廻戦のネタバレして")
    ).toBe(true);
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply(
        "呪術廻戦のネタバレを教えてください"
      )
    ).toBe(true);
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply(
        "呪術廻戦のネタバレを検索してください"
      )
    ).toBe(true);
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply(
        "呪術廻戦のネタバレしてほしくない"
      )
    ).toBe(false);
    expect(
      shouldAlwaysSynthesizeMentionChatSearchReply(
        "ネタバレが怖い人向けに結末を説明して"
      )
    ).toBe(false);
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

  it.each([
    "呪術廻戦のネタバレを調べて",
    "呪術廻戦のネタバレして",
  ])(
    "separates a Japanese spoiler modifier from the work title: %s",
    async (queryText) => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          query: "呪術廻戦 最終回 結末 ネタバレ",
          results: [
            {
              title: "呪術廻戦 公式サイト",
              content: "テレビアニメの最新情報を紹介します。",
              url: "https://example.test/jujutsu-official",
              engine: "bing",
            },
            {
              title: "呪術廻戦 全話ネタバレ解説まとめ",
              content: "呪術廻戦の結末と主要人物のその後を紹介する記事。",
              url: "https://example.test/jujutsu-spoilers",
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
        queryText,
        timeoutMs: 2500,
        maxQueryChars: 120,
        maxResponseBytes: 65536,
        maxResults: 3,
        fetchImpl,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const url = new URL(String(fetchImpl.mock.calls[0][0]));
      expect(url.searchParams.get("q")).toBe(
        "呪術廻戦 最終回 結末 ネタバレ"
      );
      expect(result.reason).toBe("found");
      expect(result.context?.text).toContain(
        "呪術廻戦 全話ネタバレ解説まとめ"
      );
      expect(result.context?.text).not.toContain("呪術廻戦 公式サイト");
    }
  );

  it("keeps no inside a Japanese work title when separating a spoiler modifier", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "進撃の巨人 最終回 結末 ネタバレ",
        results: [
          {
            title: "進撃の巨人 最終回の結末ネタバレ",
            content: "進撃の巨人の最終回と結末を解説。",
            url: "https://example.test/attack-on-titan-ending",
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
      queryText: "進撃の巨人のネタバレを調べて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe(
      "進撃の巨人 最終回 結末 ネタバレ"
    );
    expect(result.reason).toBe("found");
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

  it("does not match Kyoto weather results for Tokyo", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "京都 今日 天気",
          results: [
            {
              title: "東京都の今日の天気",
              content: "東京都の天気、最高気温、最低気温を掲載しています。",
              url: "https://example.test/tokyo-weather",
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
      queryText: "京都の今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(result).toEqual({ context: null, reason: "no_result" });
  });

  it("does not match Osaka weather results for Higashiosaka", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "大阪 今日 天気",
          results: [
            {
              title: "東大阪市の今日の天気",
              content: "東大阪市の天気、最高気温、最低気温を掲載しています。",
              url: "https://example.test/higashiosaka-weather",
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

  it("does not enrich weather from a different location than the matching result", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "大阪の今日の天気",
          results: [
            {
              title: "東京都八王子市の1時間天気",
              content: "八王子市の天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/3/16/4410/13201/1hour.html",
              engine: "bing",
            },
            {
              title: "大阪市の今日の天気",
              content: "大阪市の天気予報です。",
              url: "https://example.test/osaka-weather",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(TENKI_TODAY_FORECAST_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
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

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.reason).toBe("found");
    expect(result.context?.text).toContain("大阪市の今日の天気");
    expect(result.context?.text).not.toContain("鹿児島市の今日の天気は");
    expect(result.context?.todayWeatherForecast).toBeUndefined();
  });

  it("does not trust a tenki.jp page whose structured location differs from the query", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "大阪 今日 天気",
          results: [
            {
              title: "大阪市の今日の天気 - 日本気象協会 tenki.jp",
              content: "大阪市の天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/6/30/6200/27100/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(TENKI_TODAY_FORECAST_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
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
      currentDate: new Date("2026-07-27T12:00:00+09:00"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.reason).toBe("found");
    expect(result.context?.weatherForecast).toBeUndefined();
    expect(result.context?.todayWeatherForecast).toBeUndefined();
    expect(result.context?.text).not.toContain("鹿児島市の今日の天気は");
  });

  it("does not trust Tokyo structured weather for a Kyoto query", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "京都 今日 天気",
          results: [
            {
              title: "京都市の今日の天気 - 日本気象協会 tenki.jp",
              content: "京都市の天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/6/29/6100/26100/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(
          TENKI_TODAY_FORECAST_HTML.replaceAll("鹿児島市", "東京都"),
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
    });

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "京都の今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
      currentDate: new Date("2026-07-27T12:00:00+09:00"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.reason).toBe("found");
    expect(result.context?.weatherForecast).toBeUndefined();
    expect(result.context?.todayWeatherForecast).toBeUndefined();
    expect(result.context?.text).not.toContain("東京都の今日の天気は");
  });

  it("adds structured current forecast details from an allowlisted tenki.jp result", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "今日の天気",
          results: [
            {
              title: "鹿児島市の1時間天気 - 日本気象協会 tenki.jp",
              content:
                "鹿児島市の1時間ごとの天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/9/49/8810/46201/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(TENKI_TODAY_FORECAST_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
    });

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
      currentDate: new Date("2026-07-27T12:00:00+09:00"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchImpl.mock.calls[1][0])).toString()).toBe(
      "https://tenki.jp/forecast/9/49/8810/46201/"
    );
    expect(fetchImpl.mock.calls[1][1]?.redirect).toBe("error");
    expect(result.reason).toBe("found");
    expect(result.context?.text).toContain(
      "鹿児島市の今日の天気は雨のち晴。最高気温36℃、最低気温28℃。予報日: 2026年7月27日。出典: tenki.jp"
    );
    expect(result.context?.todayWeatherForecast).toEqual({
      location: "鹿児島市",
      weather: "雨のち晴",
      highTemperatureCelsius: "36",
      lowTemperatureCelsius: "28",
      forecastDate: "2026-07-27",
      source: "tenki.jp",
    });
  });

  it("does not expose a stale tenki.jp forecast as today's structured data", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "今日の天気",
          results: [
            {
              title: "鹿児島市の1時間天気 - 日本気象協会 tenki.jp",
              content: "鹿児島市の天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/9/49/8810/46201/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(
          TENKI_TODAY_FORECAST_HTML.replace("2026-07-27", "2026-07-26"),
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
    });

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
      currentDate: new Date("2026-07-27T12:00:00+09:00"),
    });

    expect(result.reason).toBe("found");
    expect(result.context?.todayWeatherForecast).toBeUndefined();
    expect(result.context?.text).not.toContain("最高気温36℃");
  });

  it("replaces an incomplete unknown weather reply with all structured values", () => {
    const result = applyMentionChatTodayWeatherReplyContract(
      "天気予報は知らないけど、鹿児島市は雨のち晴みたいだよ！",
      {
        location: "鹿児島市",
        weather: "雨のち晴",
        highTemperatureCelsius: "36",
        lowTemperatureCelsius: "28",
        forecastDate: "2026-07-27",
        source: "tenki.jp",
      }
    );

    expect(result).toEqual({
      corrected: true,
      reply:
        "鹿児島市の今日の天気は雨のち晴。最高気温36℃、最低気温28℃だよ！",
    });
  });

  it("keeps a complete weather reply without replacing its wording", () => {
    const generatedReply =
      "鹿児島市は雨のち晴だよ！最高気温は36度、最低気温は28℃の予報だよ。";
    const result = applyMentionChatTodayWeatherReplyContract(generatedReply, {
      location: "鹿児島市",
      weather: "雨のち晴",
      highTemperatureCelsius: "36",
      lowTemperatureCelsius: "28",
      forecastDate: "2026-07-27",
      source: "tenki.jp",
    });

    expect(result).toEqual({ corrected: false, reply: generatedReply });
  });

  it("normalizes a leading web-search instruction and adds tomorrow's structured forecast", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "大阪 明日 天気",
          results: [
            {
              title: "大阪市の今日明日の天気 - 日本気象協会 tenki.jp",
              content: "大阪市の今日と明日の天気、気温、降水確率を掲載。",
              url: "https://tenki.jp/forecast/6/30/6200/27100/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      if (url.hostname === "tenki.jp") {
        return new Response(TENKI_TOMORROW_FORECAST_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`unexpected fetch: ${url.toString()}`);
    });

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      provider: "searxng",
      endpoint: "http://searxng.test/search",
      engines: "bing",
      queryText: "Web検索して、あしたの大阪の天気を調べて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
      currentDate: new Date("2026-07-27T12:00:00+09:00"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("q")
    ).toBe("大阪 明日 天気");
    expect(result.reason).toBe("found");
    expect(result.context?.text).toContain(
      "大阪市の明日の天気は晴一時雨。最高気温33℃、最低気温27℃。予報日: 2026年7月28日。出典: tenki.jp"
    );
    expect(result.context?.weatherForecast).toEqual({
      relativeDay: "tomorrow",
      location: "大阪市",
      weather: "晴一時雨",
      highTemperatureCelsius: "33",
      lowTemperatureCelsius: "27",
      forecastDate: "2026-07-28",
      source: "tenki.jp",
    });
  });

  it("does not treat the characters in Asuka Village as a relative day", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "奈良県明日香村 今日 天気",
        results: [
          {
            title: "奈良県明日香村の今日の天気",
            content: "奈良県明日香村の今日の天気予報です。",
            url: "https://example.test/asuka-weather",
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
      queryText: "奈良県明日香村の今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("q")).toBe(
      "奈良県明日香村 今日 天気"
    );
    expect(result.reason).toBe("found");
  });

  it("keeps no inside the Hinode town name when normalizing weather", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "東京都日の出町 今日 天気",
        results: [
          {
            title: "東京都日の出町の今日の天気",
            content: "東京都日の出町の今日の天気予報です。",
            url: "https://example.test/hinode-weather",
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
      queryText: "東京都日の出町の今日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("q")).toBe(
      "東京都日の出町 今日 天気"
    );
    expect(result.reason).toBe("found");
  });

  it("keeps a request for both today and tomorrow out of single-day enrichment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        query: "大阪の今日と明日の天気",
        results: [
          {
            title: "大阪の今日と明日の天気",
            content: "大阪の今日と明日の天気予報です。",
            url: "https://example.test/osaka-two-day-weather",
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
      queryText: "大阪の今日と明日の天気を教えて",
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 3,
      fetchImpl,
    });

    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("q")).toBe(
      "大阪の今日と明日の天気"
    );
    expect(result.reason).toBe("found");
    expect(result.context?.weatherForecast).toBeUndefined();
  });

  it("replaces an incomplete tomorrow reply with verified structured values", () => {
    const result = applyMentionChatWeatherReplyContract(
      "大阪の明日の天気は分からないよ。",
      {
        relativeDay: "tomorrow",
        location: "大阪市",
        weather: "晴一時雨",
        highTemperatureCelsius: "33",
        lowTemperatureCelsius: "27",
        forecastDate: "2026-07-28",
        source: "tenki.jp",
      }
    );

    expect(result).toEqual({
      corrected: true,
      reply:
        "大阪市の明日の天気は晴一時雨。最高気温33℃、最低気温27℃だよ！",
    });
  });

  it("replaces a tomorrow reply that incorrectly labels the forecast as today", () => {
    const result = applyMentionChatWeatherReplyContract(
      "大阪市の今日の天気は晴一時雨。最高気温33℃、最低気温27℃だよ！",
      {
        relativeDay: "tomorrow",
        location: "大阪市",
        weather: "晴一時雨",
        highTemperatureCelsius: "33",
        lowTemperatureCelsius: "27",
        forecastDate: "2026-07-28",
        source: "tenki.jp",
      }
    );

    expect(result).toEqual({
      corrected: true,
      reply:
        "大阪市の明日の天気は晴一時雨。最高気温33℃、最低気温27℃だよ！",
    });
  });

  it("does not mistake Asuka in a location name for a tomorrow label", () => {
    const result = applyMentionChatWeatherReplyContract(
      "奈良県明日香村の昨日の天気は晴。最高気温33℃、最低気温27℃だよ！",
      {
        relativeDay: "tomorrow",
        location: "奈良県明日香村",
        weather: "晴",
        highTemperatureCelsius: "33",
        lowTemperatureCelsius: "27",
        forecastDate: "2026-07-28",
        source: "tenki.jp",
      }
    );

    expect(result).toEqual({
      corrected: true,
      reply:
        "奈良県明日香村の明日の天気は晴。最高気温33℃、最低気温27℃だよ！",
    });
  });

  it("skips tenki.jp detail when the response has no streaming body", async () => {
    const detailArrayBuffer = vi.fn(async () => {
      const bytes = Buffer.from(TENKI_TODAY_FORECAST_HTML, "utf8");
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    });
    const fetchImpl = vi.fn().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "searxng.test") {
        return jsonResponse({
          query: "今日の天気",
          results: [
            {
              title: "鹿児島市の1時間天気 - 日本気象協会 tenki.jp",
              content: "鹿児島市の天気、気温、降水量を掲載しています。",
              url: "https://tenki.jp/forecast/9/49/8810/46201/1hour.html",
              engine: "bing",
            },
          ],
        });
      }
      return {
        ok: true,
        body: null,
        headers: { get: () => "text/html; charset=utf-8" },
        arrayBuffer: detailArrayBuffer,
      } as unknown as Response;
    });

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

    expect(detailArrayBuffer).not.toHaveBeenCalled();
    expect(result.reason).toBe("found");
    expect(result.context?.text).not.toContain("鹿児島市の今日の天気は");
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

  it.each([
    "呪術廻戦のネタバレを調べてほしくない",
    "呪術廻戦のネタバレを検索しないで",
    "呪術廻戦のネタバレをググってほしくない",
    "呪術廻戦のネタバレを調べないで",
    "呪術廻戦のネタバレを調べないでください",
    "呪術廻戦のネタバレをググらないで",
  ])("does not externally search a negated spoiler request: %s", async (queryText) => {
    const fetchImpl = vi.fn();

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      queryText,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(result).toEqual({ context: null, reason: "not_candidate" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "呪術廻戦のネタバレを調べてほしくない",
    "呪術廻戦のネタバレを検索しないで",
    "呪術廻戦のネタバレをググってほしくない",
    "呪術廻戦のネタバレを調べないで",
    "呪術廻戦のネタバレを調べないでください",
    "呪術廻戦のネタバレをググらないで",
  ])("does not force-search a negated spoiler request: %s", async (queryText) => {
    const fetchImpl = vi.fn();

    const result = await fetchMentionChatSearchContextDetailed({
      enabled: true,
      endpoint: "https://api.duckduckgo.com/",
      queryText,
      force: true,
      timeoutMs: 2500,
      maxQueryChars: 120,
      maxResponseBytes: 65536,
      maxResults: 2,
      fetchImpl,
    });

    expect(result).toEqual({ context: null, reason: "not_candidate" });
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
