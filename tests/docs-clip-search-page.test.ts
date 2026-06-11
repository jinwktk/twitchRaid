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
  });

  it("is linked from the main GitHub Pages document", () => {
    const indexHtml = fs.readFileSync(
      path.join(process.cwd(), "docs", "index.html"),
      "utf8"
    );

    expect(indexHtml).toContain("clip-search.html");
  });
});
