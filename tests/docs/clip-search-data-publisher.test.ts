import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";
import { describe, expect, it, vi } from "vitest";
import {
  ClipSearchDataPublisher,
  type RunCommand,
} from "../../src/docs/clip-search-data-publisher";
import logger from "../../src/utils/logger";

function makePublisher(options: {
  enabled?: boolean;
  nowMs?: () => number;
  minIntervalMs?: number;
  runCommand?: RunCommand;
  repoDir?: string;
  publishRepoDir?: string;
  outPath?: string;
  remote?: string;
  branch?: string;
  githubToken?: string;
  githubUsername?: string;
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
    remote: options.remote,
    branch: options.branch,
    githubToken: options.githubToken,
    githubUsername: options.githubUsername,
  });
}

function makePublishingCommandRunner(options?: {
  latestCommitSubject?: string;
  headSha?: string;
  remoteSha?: string;
  cherryOutput?: string;
  dirtyStatus?: string;
  changedFilesByCommit?: Record<string, string>;
  whitespaceOnlyDirty?: boolean;
}) {
  const calls: Array<{
    file: string;
    args: string[];
    cwd: string;
    env?: Record<string, string | undefined>;
  }> = [];
  const latestCommitSubject =
    options?.latestCommitSubject ?? "Clip検索JSONを同期時刻更新\n";
  const headSha = options?.headSha ?? "same-sha\n";
  const remoteSha = options?.remoteSha ?? "same-sha\n";
  const cherryOutput = options?.cherryOutput ?? "";
  const dirtyStatus = options?.dirtyStatus ?? "";
  const changedFilesByCommit = options?.changedFilesByCommit ?? {};
  const whitespaceOnlyDirty = options?.whitespaceOnlyDirty ?? false;
  const runCommand: RunCommand = vi.fn(async (file, args, options) => {
    calls.push({
      file,
      args,
      cwd: options.cwd,
      env: options.env,
    });
    if (file === "git" && args[0] === "status" && args.includes("--")) {
      return { stdout: " M docs/clip-search-data.json\n", stderr: "" };
    }
    if (file === "git" && args[0] === "status") {
      return { stdout: dirtyStatus, stderr: "" };
    }
    if (file === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
      return { stdout: headSha, stderr: "" };
    }
    if (file === "git" && args[0] === "rev-parse") {
      return { stdout: remoteSha, stderr: "" };
    }
    if (file === "git" && args[0] === "cherry") {
      return { stdout: cherryOutput, stderr: "" };
    }
    if (file === "git" && args[0] === "diff-tree") {
      const commitHash = args[args.length - 1];
      return {
        stdout:
          changedFilesByCommit[commitHash] ?? "docs/clip-search-data.json\n",
        stderr: "",
      };
    }
    if (file === "git" && args[0] === "diff" && args.includes("--quiet")) {
      if (whitespaceOnlyDirty) {
        return { stdout: "", stderr: "" };
      }
      throw new Error("significant dirty diff");
    }
    if (file === "git" && args[0] === "log" && args[1] === "-1") {
      return { stdout: latestCommitSubject, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
  return { calls, runCommand };
}

const publishGitIdentityEnv = {
  GIT_AUTHOR_NAME: "twitchRaid Bot",
  GIT_AUTHOR_EMAIL: "twitchraid-bot@users.noreply.github.com",
  GIT_COMMITTER_NAME: "twitchRaid Bot",
  GIT_COMMITTER_EMAIL: "twitchraid-bot@users.noreply.github.com",
};

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function configureGitUser(cwd: string): void {
  runGit(cwd, ["config", "user.name", "Clip Publisher Test"]);
  runGit(cwd, ["config", "user.email", "clip-publisher-test@example.com"]);
}

function commitAll(cwd: string, message: string): void {
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", message]);
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
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
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
      ["git", "push", "--force-with-lease", "origin", "HEAD:main"],
    ]);
  });

  it("sets a noninteractive Git identity for publish commits", async () => {
    const { calls, runCommand } = makePublishingCommandRunner();
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-20T06:30:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({ status: "published" });
    const commitCalls = calls.filter(
      (call) => call.file === "git" && call.args[0] === "commit"
    );
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0].env).toEqual(
      expect.objectContaining(publishGitIdentityEnv)
    );
  });

  it("passes a GitHub token to network Git commands without putting it in arguments", async () => {
    const { calls, runCommand } = makePublishingCommandRunner();
    const publisher = makePublisher({
      runCommand,
      githubToken: "token-123",
      githubUsername: "clip-bot",
    });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-20T06:40:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({ status: "published" });
    const fetchCall = calls.find(
      (call) => call.file === "git" && call.args[0] === "fetch"
    );
    const pushCall = calls.find(
      (call) => call.file === "git" && call.args[0] === "push"
    );
    const expectedHeader = `AUTHORIZATION: basic ${Buffer.from(
      "clip-bot:token-123",
      "utf8"
    ).toString("base64")}`;

    expect(fetchCall?.args).not.toContain("token-123");
    expect(pushCall?.args).not.toContain("token-123");
    expect(fetchCall?.env).toEqual(
      expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: expectedHeader,
      })
    );
    expect(pushCall?.env).toEqual(
      expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: expectedHeader,
      })
    );
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
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
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
      ["git", "push", "origin", "HEAD:main"],
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
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
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
      ["git", "push", "origin", "HEAD:main"],
    ]);
    expect(calls.map((call) => call.cwd)).toEqual([
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\twitchRaid",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
      "C:\\repo\\RukalunPage",
    ]);
  });

  it("resets stale local bot sync commits to the fetched remote before publishing", async () => {
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-bot-sync\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "+ abc1234 Clip検索JSONを同期時刻更新\n",
    });
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-12T06:00:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({ status: "published" });
    expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
      ["git", "status", "--porcelain"],
      ["git", "cherry", "-v", "origin/main", "HEAD"],
      ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "abc1234"],
      ["git", "reset", "--hard", "origin/main"],
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
      ["git", "push", "--force-with-lease", "origin", "HEAD:main"],
    ]);
  });

  it("resets local bot sync commits and patch-equivalent local development commits", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-mixed-history\n",
      remoteSha: "remote-rewritten-history\n",
      cherryOutput:
        "+ abc1234 Clip検索JSONを同期時刻更新\n" +
        "- def5678 Clip検索JSONの差分ノイズを抑制\n",
    });
    const publisher = makePublisher({
      runCommand,
      remote: "upstream",
      branch: "pages",
    });

    try {
      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-15T09:56:09.055Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({ status: "published" });
      expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
        ["git", "fetch", "upstream", "pages"],
        ["git", "rev-parse", "HEAD"],
        ["git", "rev-parse", "upstream/pages"],
        ["git", "status", "--porcelain"],
        ["git", "cherry", "-v", "upstream/pages", "HEAD"],
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "abc1234"],
        ["git", "reset", "--hard", "upstream/pages"],
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
        ["git", "push", "--force-with-lease", "upstream", "HEAD:pages"],
      ]);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropEligibleCommits=2")
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("skips publishing instead of resetting local development commits", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-development\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "+ abc1234 Clip検索ページの表示を改善\n",
    });
    const publisher = makePublisher({ runCommand });

    try {
      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-12T06:00:00.000Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "local-publish-commits",
      });
      expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
        ["git", "fetch", "origin", "main"],
        ["git", "rev-parse", "HEAD"],
        ["git", "rev-parse", "origin/main"],
        ["git", "status", "--porcelain"],
        ["git", "cherry", "-v", "origin/main", "HEAD"],
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("protectedCommits=1")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("protects a local development commit even when its subject matches a remote commit but its patch differs", async () => {
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-same-subject-different-patch\n",
      remoteSha: "remote-same-subject\n",
      cherryOutput: "+ abc1234 Clip検索JSONの差分ノイズを抑制\n",
    });
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-12T06:00:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "local-publish-commits",
    });
    expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
      ["git", "status", "--porcelain"],
      ["git", "cherry", "-v", "origin/main", "HEAD"],
    ]);
  });

  it("protects the publish repository when git cherry output is malformed", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-unknown-history\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "SUCCESS Clip検索JSONを同期時刻更新\n",
    });
    const publisher = makePublisher({ runCommand });

    try {
      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-15T10:05:00.000Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "local-publish-commits",
      });
      expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
        ["git", "fetch", "origin", "main"],
        ["git", "rev-parse", "HEAD"],
        ["git", "rev-parse", "origin/main"],
        ["git", "status", "--porcelain"],
        ["git", "cherry", "-v", "origin/main", "HEAD"],
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("protectedCommits=1")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("protects a bot sync subject commit when it changes files other than the published JSON", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-unsafe-sync-subject\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "+ abc1234 Clip検索JSONを同期時刻更新\n",
      changedFilesByCommit: {
        abc1234: "clip-search-data.json\nindex.html\n",
      },
    });
    const publisher = makePublisher({
      publishRepoDir: "C:\\repo\\RukalunPage",
      outPath: "C:\\repo\\RukalunPage\\clip-search-data.json",
      runCommand,
    });

    try {
      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-15T10:10:00.000Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "local-publish-commits",
      });
      expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
        ["git", "fetch", "origin", "main"],
        ["git", "rev-parse", "HEAD"],
        ["git", "rev-parse", "origin/main"],
        ["git", "status", "--porcelain"],
        ["git", "cherry", "-v", "origin/main", "HEAD"],
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "abc1234"],
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("protectedCommits=1")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips publishing instead of resetting a dirty publish repository", async () => {
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-bot-sync\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "+ abc1234 Clip検索JSONを同期時刻更新\n",
      dirtyStatus: " M clip-search-data.json\n",
    });
    const publisher = makePublisher({ runCommand });

    const result = await publisher.publishAfterRecentSync({
      syncedAt: "2026-06-12T06:00:00.000Z",
      saved: 0,
      unavailable: 0,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "dirty-publish-repo",
    });
    expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
      ["git", "fetch", "origin", "main"],
      ["git", "rev-parse", "HEAD"],
      ["git", "rev-parse", "origin/main"],
      ["git", "status", "--porcelain"],
      ["git", "diff", "--ignore-all-space", "--quiet"],
    ]);
  });

  it("resets stale bot sync commits when dirty files only differ by whitespace", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    const { calls, runCommand } = makePublishingCommandRunner({
      headSha: "local-bot-sync\n",
      remoteSha: "remote-sync\n",
      cherryOutput: "+ abc1234 Clip検索JSONを同期時刻更新\n",
      dirtyStatus: " M README.md\n M index.html\n",
      changedFilesByCommit: {
        abc1234: "clip-search-data.json\n",
      },
      whitespaceOnlyDirty: true,
    });
    const publisher = makePublisher({
      publishRepoDir: "C:\\repo\\RukalunPage",
      outPath: "C:\\repo\\RukalunPage\\clip-search-data.json",
      runCommand,
    });

    try {
      const result = await publisher.publishAfterRecentSync({
        syncedAt: "2026-06-20T06:10:36.000Z",
        saved: 0,
        unavailable: 0,
      });

      expect(result).toEqual({ status: "published" });
      expect(calls.map((call) => [path.basename(call.file), ...call.args])).toEqual([
        ["git", "fetch", "origin", "main"],
        ["git", "rev-parse", "HEAD"],
        ["git", "rev-parse", "origin/main"],
        ["git", "status", "--porcelain"],
        ["git", "diff", "--ignore-all-space", "--quiet"],
        ["git", "diff", "--cached", "--ignore-all-space", "--quiet"],
        ["git", "cherry", "-v", "origin/main", "HEAD"],
        ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", "abc1234"],
        ["git", "reset", "--hard", "origin/main"],
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
        ["git", "commit", "--amend", "--no-edit"],
        ["git", "push", "--force-with-lease", "origin", "HEAD:main"],
      ]);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("空白または改行だけ")
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("verifies git cherry markers for patch-equivalent and unique local commits", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-git-cherry-"));
    try {
      const remoteDir = path.join(tempDir, "remote.git");
      const staleDir = path.join(tempDir, "stale");
      const upstreamDir = path.join(tempDir, "upstream");

      execFileSync("git", ["init", "--bare", remoteDir], { cwd: tempDir });
      execFileSync("git", ["init", staleDir], { cwd: tempDir });
      configureGitUser(staleDir);
      runGit(staleDir, ["checkout", "-b", "main"]);
      fs.writeFileSync(path.join(staleDir, "base.txt"), "base\n");
      commitAll(staleDir, "base");
      runGit(staleDir, ["remote", "add", "origin", remoteDir]);
      runGit(staleDir, ["push", "-u", "origin", "main"]);
      runGit(remoteDir, ["symbolic-ref", "HEAD", "refs/heads/main"]);

      execFileSync("git", ["clone", remoteDir, upstreamDir], { cwd: tempDir });
      configureGitUser(upstreamDir);
      fs.writeFileSync(path.join(upstreamDir, "dev.txt"), "same patch\n");
      commitAll(upstreamDir, "same patch already on remote");
      runGit(upstreamDir, ["push", "origin", "main"]);

      runGit(staleDir, ["fetch", "origin", "main"]);
      fs.writeFileSync(path.join(staleDir, "dev.txt"), "same patch\n");
      commitAll(staleDir, "same patch local rewrite");
      fs.writeFileSync(path.join(staleDir, "clip-search-data.json"), "{}\n");
      commitAll(staleDir, "Clip sync time update");
      fs.writeFileSync(path.join(staleDir, "unique.txt"), "local only\n");
      commitAll(staleDir, "unique local work");

      const cherryOutput = runGit(staleDir, [
        "cherry",
        "-v",
        "origin/main",
        "HEAD",
      ]);

      expect(cherryOutput).toMatch(/^- [0-9a-f]+ same patch local rewrite/m);
      expect(cherryOutput).toMatch(/^\+ [0-9a-f]+ Clip sync time update/m);
      expect(cherryOutput).toMatch(/^\+ [0-9a-f]+ unique local work/m);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

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
