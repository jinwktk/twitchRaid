import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRandomMangaRecommendation } from "../../src/commands/manga";

describe("fetchRandomMangaRecommendation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("combines recommendations from the maniax and girls daily rankings", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const rankingUrl = String(url);
      const title = rankingUrl.includes("/girls/") ? "女性向け作品" : "既存作品";
      const workSection = rankingUrl.includes("/girls/") ? "girls" : "maniax";
      return new Response(
        `<a href="/${workSection}/work/=/product_id/RJ0001.html">${title}</a>`,
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0.75);

    await expect(fetchRandomMangaRecommendation()).resolves.toEqual({
      title: "女性向け作品",
      url: "https://www.dlsite.com/girls/work/=/product_id/RJ0001.html",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dlsite.com/maniax/ranking/day?category=comic",
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.dlsite.com/girls/ranking/day?category=comic",
      expect.any(Object)
    );
  });

  it("uses the available ranking when the other ranking request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/maniax/")) {
          return new Response("unavailable", { status: 503 });
        }
        return new Response(
          '<a href="/girls/work/=/product_id/RJ0002.html">取得可能な作品</a>',
          { status: 200 }
        );
      })
    );

    await expect(fetchRandomMangaRecommendation()).resolves.toEqual({
      title: "取得可能な作品",
      url: "https://www.dlsite.com/girls/work/=/product_id/RJ0002.html",
    });
  });
});
