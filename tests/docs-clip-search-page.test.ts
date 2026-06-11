import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub Pages clip search page", () => {
  it("contains the expected static search controls and data source", () => {
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

  it("is linked from the main GitHub Pages document", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );

    expect(indexHtml).toContain("clip-search.html");
  });
});
