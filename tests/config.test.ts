import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../src/config";

let tempDir: string | null = null;

function writeEnvFile(contents: string): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-config-"));
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, contents, "utf8");
  return envPath;
}

describe("Config", () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("loads clip search auto-publish settings for GitHub Pages JSON updates", () => {
    const envPath = writeEnvFile(`
TWITCH_CLIENT_ID=client
TWITCH_ACCESS_TOKEN=access
TWITCH_REFRESH_TOKEN=refresh
TWITCH_SECRET_TOKEN=secret
TWITCH_BROADCASTER_ID=broadcaster
TWITCH_MODERATOR_ID=moderator
CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true
CLIP_SEARCH_DATA_PATH=public/clip-search-data.json
CLIP_SEARCH_PUBLISH_MIN_INTERVAL_MS=120000
CLIP_SEARCH_PUBLISH_REMOTE=origin
CLIP_SEARCH_PUBLISH_BRANCH=main
`);

    const config = new Config(envPath);

    expect(config.clipSearchAutoPublishEnabled).toBe(true);
    expect(config.clipSearchDataPath).toBe(
      path.resolve("public", "clip-search-data.json")
    );
    expect(config.clipSearchPublishMinIntervalMs).toBe(120_000);
    expect(config.clipSearchPublishRemote).toBe("origin");
    expect(config.clipSearchPublishBranch).toBe("main");
  });
});
