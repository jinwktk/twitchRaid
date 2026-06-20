import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

describe("SearXNG self-hosting config", () => {
  it("keeps a Docker Compose service for the local SearXNG instance", () => {
    const compose = fs.readFileSync(
      path.join(repoRoot, "ops/searxng/docker-compose.yml"),
      "utf8"
    );

    expect(compose).toContain("searxng/searxng:latest");
    expect(compose).toContain(
      "/home/mlove/dokploy/searxng/settings.yml:/etc/searxng/settings.yml:ro"
    );
    expect(compose).toContain("aliases:");
    expect(compose).toContain("- searxng");
    expect(compose).toContain("restart_policy:");
    expect(compose).not.toContain("ports:");
  });

  it("enables JSON output and keeps Google as the only default engine", () => {
    const settings = fs.readFileSync(
      path.join(repoRoot, "ops/searxng/settings.yml"),
      "utf8"
    );

    expect(settings).toContain("formats:");
    expect(settings).toContain("- json");
    expect(settings).toContain("keep_only:");
    expect(settings).toContain("- google");
    expect(settings).toContain("disabled: false");
  });
});
