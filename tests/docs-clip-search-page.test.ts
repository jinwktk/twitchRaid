import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub Pages clip search page", () => {
  it("publishes search-friendly metadata and a generated OG image", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );
    const ogImagePath = path.join(
      process.cwd(),
      "docs",
      "assets",
      "clip-search-og.png"
    );

    expect(fs.existsSync(ogImagePath)).toBe(true);
    expect(html).toContain(
      '<meta name="description" content="るっかるんのTwitch Clipをタイトル、作成者名、ゲーム名で探せる公開Clip検索ページです。" />'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://jinwktk.github.io/twitchRaid/clip-search.html" />'
    );
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://jinwktk.github.io/twitchRaid/assets/clip-search-og.png" />'
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type": "CollectionPage"');
    expect(html).toContain('"@type": "SearchAction"');
    expect(html).toContain('clip-search.html?q={search_term_string}');
    expect(html).toContain('const initialQuery = new URLSearchParams(window.location.search).get("q");');
  });

  it("contains the expected public search controls", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("clip-search-data.json");
    expect(html).toContain('id="searchInput"');
    expect(html).toContain('placeholder="例: FF14 / 雑談 / 迷子 / 作成者名"');
    expect(html).toContain('id="creatorFilter"');
    expect(html).toContain('id="sortSelect"');
    expect(html).toContain('id="results"');
    expect(html).toContain('id="emptyState"');
    expect(html).toContain('id="clipSyncedAt"');
    expect(html).toContain("Twitchで見る");
    expect(html).toContain("clip-thumbnail");
    expect(html).toContain("thumbnailUrl");
    expect(html).toContain("ゲーム:");
    expect(html).toContain("gameName");
    expect(html).toContain("./assets/clip-search-og.png");
    expect(html).toContain('class="hero-image"');
    expect(html).toContain("JSON生成");
    expect(html).toContain('<option value="oldest">古い順</option>');
    expect(html).toContain('<option value="favorites">お気に入り順</option>');
    expect(html).toContain('second: "2-digit"');
  });

  it("does not expose internal documentation or operation links on the public page", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).not.toContain('href="./index.html"');
    expect(html).not.toContain("Bot仕様書");
    expect(html).not.toContain("docs:export-clips");
    expect(html).not.toContain("SQLite");
    expect(html).not.toContain("公開JSON");
    expect(html).not.toContain("運用側");
    expect(html).not.toContain('id="dataSource"');
  });

  it("uses Twitch links without in-page playback embeds", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("Twitchで見る");
    expect(html).not.toContain('id="clipPlayerPanel"');
    expect(html).not.toContain('id="clipPlayerFrame"');
    expect(html).not.toContain("ページで再生");
    expect(html).not.toContain("https://clips.twitch.tv/embed");
    expect(html).not.toContain('searchParams.set("parent"');
    expect(html).not.toContain("allowFullscreen");
  });

  it("keeps favorites in the browser and can sort by them", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("CLIP_FAVORITES_STORAGE_KEY");
    expect(html).toContain("localStorage.getItem(CLIP_FAVORITES_STORAGE_KEY)");
    expect(html).toContain("localStorage.setItem(CLIP_FAVORITES_STORAGE_KEY");
    expect(html).toContain("toggleFavoriteClip");
    expect(html).toContain("isFavoriteClip");
    expect(html).toContain('sort === "favorites"');
    expect(html).toContain("お気に入りに追加");
    expect(html).toContain("お気に入り済み");
    expect(html).toContain('aria-pressed');
  });

  it("keeps the GitHub Pages root free of the internal bot guide", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );

    expect(indexHtml).toContain("clip-search.html");
    expect(indexHtml).toContain(
      "https://jinwktk.github.io/twitchRaid/assets/clip-search-og.png"
    );
    expect(indexHtml).not.toContain("twitchRaid Bot しくみ図鑑");
    expect(indexHtml).not.toContain("TypeScript版仕様書");
    expect(indexHtml).not.toContain("#map");
    expect(indexHtml).not.toContain("#quality");
  });

  it("does not route the old specification URL back to the public root guide", () => {
    const legacyHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "typescript-bot-spec.html"),
      "utf8"
    );

    expect(legacyHtml).not.toContain("url=index.html");
    expect(legacyHtml).not.toContain('href="index.html"');
    expect(legacyHtml).not.toContain("twitchRaid Bot しくみ図鑑");
  });
});
