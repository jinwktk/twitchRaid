import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub Pages clip search page", () => {
  it("publishes search-friendly metadata and rukalun visual assets", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );
    const ogImagePath = path.join(
      process.cwd(),
      "docs",
      "assets",
      "rukalun",
      "clip-search-og.png"
    );
    const heroImagePath = path.join(
      process.cwd(),
      "docs",
      "assets",
      "rukalun",
      "clip-search-hero.png"
    );
    const faviconPath = path.join(
      process.cwd(),
      "docs",
      "assets",
      "clip-search-favicon.png"
    );
    const appleTouchIconPath = path.join(
      process.cwd(),
      "docs",
      "assets",
      "apple-touch-icon.png"
    );
    const legacyFaviconPath = path.join(process.cwd(), "docs", "favicon.ico");

    expect(fs.existsSync(ogImagePath)).toBe(true);
    expect(fs.existsSync(heroImagePath)).toBe(true);
    expect(fs.existsSync(faviconPath)).toBe(true);
    expect(fs.existsSync(appleTouchIconPath)).toBe(true);
    expect(fs.existsSync(legacyFaviconPath)).toBe(true);
    expect(html).toContain(
      '<meta name="description" content="るっかるんのTwitch Clipをタイトル、作成者名、ゲーム名で探せる公開Clip検索ページです。" />'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://jinwktk.github.io/twitchRaid/clip-search.html" />'
    );
    expect(html).toContain('<meta name="robots" content="index,follow" />');
    expect(html).toContain('<meta property="og:type" content="website" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://jinwktk.github.io/twitchRaid/assets/rukalun/clip-search-og.png" />'
    );
    expect(html).toContain('<link rel="icon" href="./favicon.ico" sizes="any" />');
    expect(html).toContain(
      '<link rel="icon" href="./assets/clip-search-favicon.png" type="image/png" />'
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" href="./assets/apple-touch-icon.png" />'
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
    expect(html).toContain("./assets/rukalun/clip-search-hero.png");
    expect(html).toContain('class="hero-image"');
    expect(html).toContain('<span class="title-phrase">ふわっと探す。</span>');
    expect(html).toContain("white-space: nowrap");
    expect(html).toContain("JSON生成");
    expect(html).toContain('<option value="oldest">古い順</option>');
    expect(html).toContain('<option value="favorites">お気に入り順</option>');
    expect(html).toContain('second: "2-digit"');
  });

  it("collapses the mobile search controls behind a compact toggle", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain('id="searchPanel" class="search-panel is-collapsed"');
    expect(html).toContain('id="searchPanelToggle"');
    expect(html).toContain('aria-controls="searchControls"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="searchControls"');
    expect(html).toContain('id="searchPanelSummary"');
    expect(html).toContain('class="search-toggle-copy"');
    expect(html).toContain('class="search-toggle-icon" aria-hidden="true">▽</span>');
    expect(html).toContain("検索条件を開く");
    expect(html).toContain("検索条件を閉じる");
    expect(html).toContain(".search-toggle-wrap");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) 24px;");
    expect(html).toContain('.search-toggle[aria-expanded="true"] .search-toggle-icon');
    expect(html).not.toContain(".search-toggle::after");
    expect(html).toContain(".search-panel.is-collapsed .search-grid");
    expect(html).toContain("setSearchPanelExpanded");
    expect(html).toContain("updateSearchPanelSummary");
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

  it("marks clips created within 3 days as new", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("NEW_CLIP_WINDOW_MS");
    expect(html).toContain("3 * 24 * 60 * 60 * 1000");
    expect(html).toContain("isNewClip");
    expect(html).toContain('className = "new-badge"');
    expect(html).toContain('newBadge.textContent = "NEW"');
    expect(html).toContain('aria-label", "新着Clip"');
    expect(html).toContain(".new-badge");
  });

  it("keeps the GitHub Pages root free of the internal bot guide", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );

    expect(indexHtml).toContain("clip-search.html");
    expect(indexHtml).toContain(
      "https://jinwktk.github.io/twitchRaid/assets/rukalun/clip-search-og.png"
    );
    expect(indexHtml).toContain('<link rel="icon" href="./favicon.ico" sizes="any" />');
    expect(indexHtml).toContain(
      '<link rel="icon" href="./assets/clip-search-favicon.png" type="image/png" />'
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
