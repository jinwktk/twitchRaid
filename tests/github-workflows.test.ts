import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("GitHub workflows", () => {
  it("keeps the legacy self-hosted bot deploy manual-only under Dokploy", () => {
    const deployWorkflow = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "deploy.yml"),
      "utf8"
    );

    expect(deployWorkflow).toContain("workflow_dispatch:");
    expect(deployWorkflow).not.toMatch(/^\s+push:\s*$/m);
  });
});
