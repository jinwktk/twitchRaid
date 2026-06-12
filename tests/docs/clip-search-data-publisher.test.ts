import path from "path";
import fs from "fs";
import os from "os";
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
  repoDir?: string;
  publishRepoDir?: string;
  outPath?: string;
}) {
  return new ClipSearchDataPublisher({
    enabled: options.enabled ?? true,
    repoDir: options.repoDir ?? "C:\\repo\\twitchRaid",
    publishRepoDir: options.publishRepoDir,
    dbPath: "C:\\repo\\twitchRaid\\data\\clips.sqlite",
    outPath: options.outPath ?? "C:\\repo\\twitchRaid\\docs\\clip-search-data.json",
    minIntervalMs: options.minIntervalMs,
    nowMs: options.nowMs,
    runCommand: options.runCommand ?? vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
  });
}

function makePublishingCommandRunner(options?: { latestCommitSubject?: string }) {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
  const latestCommitSubject =
    options?.latestCommitSubject ?? "Clip検索JSONを同期時刻更新\n";
  const runCommand: RunCommand = vi.fn(async (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd });
    if (file === "git" && args[0] === "status") {
      return { stdout: " M docs/clip-search-data.json\n", stderr: "" };
    }
    if (file === "git" && args[0] === "log") {
      return { stdout: latestCommitSubject, stderr: "" };
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
      unavailable: 0,
    });

    expect(result).toEqual({ status: "disabled" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("amends and force-pushes JSON when a zero-save sync follows the bot sync commit", async () => {
    const { calls, runCommand } = makePublishingCommandRunner();
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
      unavailable: 0,
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
      ["git", "log", "-1", "--pretty=%s"],
      ["git", "commit", "--amend", "--no-edit"],
      ["git", "push", "--force-with-lease", "origin", "main"],
    ]);
  });

  it("creates a new commit for a zero-save sync after a development commit", async () => {
    const { calls, runCommand } = makePublishingCommandRunner({
      latestCommitSubject: "Clip検索ページの表示を改善\n",
    });
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:00.000Z",
      saved: 0,
      unavailable: 0,
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
      ["git", "log", "-1", "--pretty=%s"],
      ["git", "commit", "-m", "Clip検索JSONを同期時刻更新"],
      ["git", "push", "origin", "main"],
    ]);
  });

  it("can publish the search JSON into a separate RukalunPage repository", async () => {
    const { calls, runCommand } = makePublishingCommandRunner({
      latestCommitSubject: "RukalunPage初期構築\n",
    });
    const publisher = makePublisher({
      repoDir: "C:\\repo\\twitchRaid",
      publishRepoDir: "C:\\repo\\RukalunPage",
      outPath: "C:\\repo\\RukalunPage\\clip-search-data.json",
      runCommand,
    });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-12T06:00:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({ status: "published" });
    expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
      [
        path.basename(process.execPath),
        "C:\\repo\\twitchRaid\\scripts\\export-clip-search-data.mjs",
        "--db",
        "C:\\repo\\twitchRaid\\data\\clips.sqlite",
        "--out",
        "C:\\repo\\RukalunPage\\clip-search-data.json",
      ],
      ["git", "status", "--porcelain", "--", "clip-search-data.json"],
      ["git", "add", "--", "clip-search-data.json"],
      ["git", "log", "-1", "--pretty=%s"],
      ["git", "commit", "-m", "Clip検索JSONを同期時刻更新"],
      ["git", "push", "origin", "main"],
    ]);
    expect(calls.map((call) => call.cwd)).toEqual([
      "C:\\repo\\twitchRaid",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
    ]);
  });

  it("throttles zero-save sync publishes but publishes immediately when newly available clips were saved", async () => {
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
      unavailable: 0,
    });
    now += 1_000;
    const skipped = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:01.000Z",
      saved: 0,
      unavailable: 0,
    });
    const saved = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:02.000Z",
      saved: 1,
      unavailable: 0,
    });

    expect(skipped).toEqual({ status: "skipped", reason: "min-interval" });
    expect(saved).toEqual({ status: "published" });
    expect(calls.filter((call) => call.file === process.execPath)).toHaveLength(2);
    expect(
      calls
        .filter((call) => call.file === "git" && call.args[0] === "commit")
        .map((call) => call.args)
    ).toEqual([
      ["commit", "--amend", "--no-edit"],
      ["commit", "-m", "Clip検索JSONを同期時刻更新"],
    ]);
  });

  it("publishes immediately when recent sync made clips unavailable", async () => {
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
      unavailable: 0,
    });
    now += 1_000;
    const unavailable = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-11T09:00:01.000Z",
      saved: 0,
      unavailable: 1,
    });

    expect(unavailable).toEqual({ status: "published" });
    expect(calls.filter((call) => call.file === process.execPath)).toHaveLength(2);
    expect(
      calls
        .filter((call) => call.file === "git" && call.args[0] === "commit")
        .map((call) => call.args)
    ).toEqual([
      ["commit", "--amend", "--no-edit"],
      ["commit", "-m", "Clip検索JSONを同期時刻更新"],
    ]);
  });

  it("keeps the publish interval after restart by reading the existing JSON generatedAt", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-publisher-"));
    try {
      const outPath = path.join(tempDir, "docs", "clip-search-data.json");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        JSON.stringify({ generatedAt: "2026-06-11T09:45:00.000Z", clips: [] })
      );
      const runCommand = vi.fn();
      const publisher = new ClipSearchDataPublisher({
        enabled: true,
        repoDir: tempDir,
        dbPath: path.join(tempDir, "data", "clips.sqlite"),
        outPath,
        minIntervalMs: 5 * 60 * 1000,
        nowMs: () => Date.parse("2026-06-11T09:46:00.000Z"),
        runCommand,
      });

      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-11T09:46:00.000Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({ status: "skipped", reason: "min-interval" });
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
      unavailable: 0,
    });

    expect(result).toEqual({ status: "unchanged" });
    expect(runCommand).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["commit"]),
      expect.anything()
    );
  });
});
