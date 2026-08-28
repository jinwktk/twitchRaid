import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const RUKALUN_PAGE_URL = "https://rukalun-page.vercel.app/";

describe("legacy GitHub Pages routes", () => {
  it("redirects the old clip search URL to the RukalunPage repository", () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "docs", "clip-search.html"),
      "utf8"
    );

    expect(html).toContain(`content="0; url=${RUKALUN_PAGE_URL}"`);
    expect(html).toContain(`href="${RUKALUN_PAGE_URL}"`);
    expect(html).toContain(
      `const target = new URL("${RUKALUN_PAGE_URL}");`
    );
    expect(html).toContain("target.search = window.location.search;");
    expect(html).toContain("location.replace(target.href)");
    expect(html).toContain(
      `<a href="${RUKALUN_PAGE_URL}">RukalunPage</a>`
    );
    expect(html).not.toContain("clip-search-data.json");
    expect(html).not.toContain("https://jinwktk.github.io/twitchRaid/clip-search.html");
    expect(html).not.toContain("docs:export-clips");
    expect(html).not.toContain("SQLite");
  });

  it("keeps the old root and spec URL as public redirects only", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );
    const legacyHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "typescript-bot-spec.html"),
      "utf8"
    );

    for (const html of [indexHtml, legacyHtml]) {
      expect(html).toContain(`content="0; url=${RUKALUN_PAGE_URL}"`);
      expect(html).toContain(`href="${RUKALUN_PAGE_URL}"`);
      expect(html).toContain(
        `const target = new URL("${RUKALUN_PAGE_URL}");`
      );
      expect(html).toContain("target.search = window.location.search;");
      expect(html).toContain(
        `<a href="${RUKALUN_PAGE_URL}">RukalunPage</a>`
      );
      expect(html).not.toContain("twitchRaid Bot しくみ図鑑");
      expect(html).not.toContain("TypeScript版仕様書");
      expect(html).not.toContain("clip-search-data.json");
      expect(html).not.toContain("docs:export-clips");
    }
  });
});
