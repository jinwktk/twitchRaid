import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub workflows", () => {
  it("does not run the self-hosted bot deploy for clip search data-only pushes", () => {
    const deployWorkflow = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "deploy.yml"),
      "utf8"
    );

    expect(deployWorkflow).toContain("paths-ignore:");
    expect(deployWorkflow).toContain('"docs/clip-search-data.json"');
  });
});
