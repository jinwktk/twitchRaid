import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

describe("SearXNG self-hosting config", () => {
  it("keeps SearXNG inside the SUB AI Services Docker Compose stack", () => {
    const compose = fs.readFileSync(
      path.join(repoRoot, "ops/sub-ai-services/docker-compose.yml"),
      "utf8"
    );

    expect(compose).toContain("ollama/ollama:latest");
    expect(compose).toContain("localhost:5050/sub-whisper-api:local");
    expect(compose).toContain("localhost:5050/sub-sbvits2:local");
    expect(compose).toContain("searxng/searxng:latest");
    expect(compose).toContain(
      "/home/mlove/dokploy/searxng/settings.yml:/etc/searxng/settings.yml:ro"
    );
    expect(compose).toContain("aliases:");
    expect(compose).toContain("- searxng");
    expect(compose).toContain("restart_policy:");
    expect(compose).not.toContain("published: 8080");
  });

  it("does not keep a standalone SearXNG compose stack", () => {
    expect(
      fs.existsSync(path.join(repoRoot, "ops/searxng/docker-compose.yml"))
    ).toBe(false);
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
