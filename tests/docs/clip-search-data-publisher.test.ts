import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  ClipSearchDataPublisher,
  type RunCommand,
} from "../../src/docs/clip-search-data-publisher";

function makePublisher(options: {
  enabled?: boolean;
  nowMs?: () => number;
  minIntervalMs?: number;
  runCommand?: RunCommand;
}) {
  return new ClipSearchDataPublisher({
    enabled: options.enabled ?? true,
    repoDir: "C:\\repo\\twitchRaid",
    dbPath: "C:\\repo\\twitchRaid\\data\\clips.sqlite",
    outPath: "C:\\repo\\twitchRaid\\docs\\clip-search-data.json",
    minIntervalMs: options.minIntervalMs,
    nowMs: options.nowMs,
    runCommand: options.runCommand ?? vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  });
}

function makePublishingCommandRunner() {
  const calls: Array<{ file: string; args: string[] }> = [];
  const runCommand: RunCommand = vi.fn(async (file, args) => {
    calls.push({ file, args });
    if (file === "git" && args[0] === "status") {
      return { stdout: " M docs/clip-search-data.json\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
  return { calls, runCommand };
}

describe("ClipSearchDataPublisher", () => {
  it("does nothing when automatic publishing is disabled", async () => {
    const runCommand = vi.fn();
    const publisher = makePublisher({ enabled: false, runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
    });

    expect(result).toEqual({ status: "disabled" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("exports, commits, and pushes JSON even when a recent sync saved zero clips", async () => {
    const { calls, runCommand } = makePublishingCommandRunner();
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
    });

    expect(result).toEqual({ status: "published" });
    expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
      [
        path.basename(process.execPath),
        "C:\\repo\\twitchRaid\\scripts\\export-clip-search-data.mjs",
        "--db",
        "C:\\repo\\twitchRaid\\data\\clips.sqlite",
        "--out",
        "C:\\repo\\twitchRaid\\docs\\clip-search-data.json",
      ],
      ["git", "status", "--porcelain", "--", "docs/clip-search-data.json"],
      ["git", "add", "--", "docs/clip-search-data.json"],
      ["git", "commit", "-m", "Clip検索JSONを同期時刻更新"],
      ["git", "push", "origin", "main"],
    ]);
  });

  it("throttles zero-save sync publishes but publishes immediately when clips were saved", async () => {
    let now = 1_000;
    const { calls, runCommand } = makePublishingCommandRunner();
    const publisher = makePublisher({
      minIntervalMs: 10_000,
      nowMs: () => now,
      runCommand,
    });

    await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
    });
    now += 1_000;
    const skipped = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:01.000Z",
      saved: 0,
    });
    const saved = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:02.000Z",
      saved: 1,
    });

    expect(skipped).toEqual({ status: "skipped", reason: "min-interval" });
    expect(saved).toEqual({ status: "published" });
    expect(calls.filter((call) => call.file === process.execPath)).toHaveLength(2);
  });

  it("does not commit when the exported JSON has no git diff", async () => {
    const runCommand: RunCommand = vi.fn(async (file, args) => {
      if (file === "git" && args[0] === "status") {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
    });

    expect(result).toEqual({ status: "unchanged" });
    expect(runCommand).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["commit"]),
      expect.anything()
    );
  });
});
