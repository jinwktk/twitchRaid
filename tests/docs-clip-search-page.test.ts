import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub Pages clip search page", () => {
  it("contains the expected public search controls", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("clip-search-data.json");
    expect(html).toContain('id="searchInput"');
    expect(html).toContain('id="creatorFilter"');
    expect(html).toContain('id="sortSelect"');
    expect(html).toContain('id="results"');
    expect(html).toContain('id="emptyState"');
    expect(html).toContain('id="clipSyncedAt"');
    expect(html).toContain('id="clipPlayerPanel"');
    expect(html).toContain('id="clipPlayerFrame"');
    expect(html).toContain("ページで再生");
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
    expect(html).not.toContain('id="dataSource"');
  });

  it("configures Twitch clip embeds for in-page playback", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain("https://clips.twitch.tv/embed");
    expect(html).toContain('searchParams.set("clip"');
    expect(html).toContain('searchParams.set("parent"');
    expect(html).toContain('searchParams.set("autoplay", "false")');
    expect(html).toContain("allowFullscreen");
  });

  it("is not linked from the internal specification document", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );

    expect(indexHtml).not.toContain('href="./clip-search.html"');
  });
});
