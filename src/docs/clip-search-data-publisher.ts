import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import logger from "../utils/logger";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_TIME_COMMIT_MESSAGE = "Clip検索JSONを同期時刻更新";
const PUBLISH_GIT_IDENTITY_ENV = Object.freeze({
  GIT_AUTHOR_NAME: "twitchRaid Bot",
  GIT_AUTHOR_EMAIL: "twitchraid-bot@users.noreply.github.com",
  GIT_COMMITTER_NAME: "twitchRaid Bot",
  GIT_COMMITTER_EMAIL: "twitchraid-bot@users.noreply.github.com",
});

export interface ClipSearchPublishRequest {
  syncedAt: string;
  saved: number;
  unavailable: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export type RunCommand = (
  file: string,
  args: string[],
  options: RunCommandOptions
) => Promise<CommandResult>;

export type ClipSearchPublishStatus =
  | "disabled"
  | "skipped"
  | "already-running"
  | "unchanged"
  | "published";

export interface ClipSearchPublishResult {
  status: ClipSearchPublishStatus;
  reason?: string;
}

interface ClipSearchDataPublisherOptions {
  enabled: boolean;
  dbPath: string;
  outPath: string;
  repoDir?: string;
  publishRepoDir?: string;
  remote?: string;
  branch?: string;
  githubToken?: string;
  githubUsername?: string;
  minIntervalMs?: number;
  runCommand?: RunCommand;
  nowMs?: () => number;
  initialLastPublishedMs?: number;
}

async function defaultRunCommand(
  file: string,
  args: string[],
  options: RunCommandOptions
): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function toGitPath(value: string): string {
  return value.split(path.sep).join("/");
}

function relativeRepoPath(repoDir: string, targetPath: string): string {
  const relative = path.relative(repoDir, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside repository: ${targetPath}`);
  }
  return toGitPath(relative);
}

function readGeneratedAtMs(outPath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const generatedAt =
      typeof parsed?.generatedAt === "string" ? parsed.generatedAt : "";
    const generatedAtMs = Date.parse(generatedAt);
    return Number.isFinite(generatedAtMs) ? generatedAtMs : 0;
  } catch {
    return 0;
  }
}

function isSyncTimeOnlyRequest(request: ClipSearchPublishRequest): boolean {
  return request.saved === 0 && request.unavailable === 0;
}

interface CherryCommit {
  marker: "+" | "-";
  hash: string;
  subject: string;
}

function parseCherryCommits(stdout: string): CherryCommit[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([+-])\s+([0-9a-f]+)\s+(.*)$/i.exec(line);
      if (!match) {
        return { marker: "+", hash: "", subject: line };
      }
      return {
        marker: match[1] as "+" | "-",
        hash: match[2],
        subject: match[3],
      };
    });
}

function parseChangedFiles(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

function changesOnlyPublishJson(stdout: string, outGitPath: string): boolean {
  const changedFiles = parseChangedFiles(stdout);
  return (
    changedFiles.length > 0 &&
    changedFiles.every((file) => file === outGitPath)
  );
}

function statusHasOnlyTrackedModifications(stdout: string): boolean {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return (
    lines.length > 0 &&
    lines.every((line) => {
      const status = line.slice(0, 2);
      return /^[ M][ M]$/.test(status) && status.includes("M");
    })
  );
}

function createGitNetworkEnv(
  githubToken: string | undefined,
  githubUsername: string | undefined
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
  };
  const token = githubToken?.trim();
  if (!token) {
    return env;
  }

  const username = githubUsername?.trim() || "x-access-token";
  const auth = Buffer.from(`${username}:${token}`, "utf8").toString("base64");
  return {
    ...env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
  };
}

function commandErrorText(error: unknown): string {
  const parts = [error instanceof Error ? error.message : String(error)];
  const commandError = error as { stdout?: unknown; stderr?: unknown };
  if (typeof commandError.stdout === "string" && commandError.stdout.trim()) {
    parts.push(commandError.stdout);
  }
  if (typeof commandError.stderr === "string" && commandError.stderr.trim()) {
    parts.push(commandError.stderr);
  }
  return parts.join("\n");
}

function isMissingGithubHttpsCredentials(error: unknown): boolean {
  const text = commandErrorText(error);
  return (
    /could not read Username for 'https:\/\/github\.com'/iu.test(text) ||
    (/github\.com/iu.test(text) && /terminal prompts disabled/iu.test(text))
  );
}

export class ClipSearchDataPublisher {
  private readonly enabled: boolean;
  private readonly repoDir: string;
  private readonly publishRepoDir: string;
  private readonly dbPath: string;
  private readonly outPath: string;
  private readonly exportScriptPath: string;
  private readonly remote: string;
  private readonly branch: string;
  private readonly minIntervalMs: number;
  private readonly runCommand: RunCommand;
  private readonly nowMs: () => number;
  private readonly gitNetworkEnv: NodeJS.ProcessEnv;
  private running = false;
  private lastPublishedMs = 0;
  private githubAuthMissingWarned = false;

  constructor(options: ClipSearchDataPublisherOptions) {
    this.enabled = options.enabled;
    this.repoDir = path.resolve(options.repoDir ?? DEFAULT_REPO_DIR);
    this.publishRepoDir = path.resolve(options.publishRepoDir ?? this.repoDir);
    this.dbPath = path.resolve(options.dbPath);
    this.outPath = path.resolve(options.outPath);
    this.exportScriptPath = path.join(
      this.repoDir,
      "scripts",
      "export-clip-search-data.mjs"
    );
    this.remote = options.remote?.trim() || "origin";
    this.branch = options.branch?.trim() || "main";
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.nowMs = options.nowMs ?? Date.now;
    this.gitNetworkEnv = createGitNetworkEnv(
      options.githubToken,
      options.githubUsername
    );
    this.lastPublishedMs =
      options.initialLastPublishedMs ?? readGeneratedAtMs(this.outPath);
  }

  async publishAfterRecentSync(
    request: ClipSearchPublishRequest
  ): Promise<ClipSearchPublishResult> {
    if (!this.enabled) {
      return { status: "disabled" };
    }

    if (this.running) {
      logger.info("🎬 Clip検索公開JSON更新をスキップ: 既に実行中");
      return { status: "already-running", reason: "running" };
    }

    const now = this.nowMs();
    const shouldPublish =
      request.saved > 0 ||
      request.unavailable > 0 ||
      this.lastPublishedMs === 0 ||
      now - this.lastPublishedMs >= this.minIntervalMs;
    if (!shouldPublish) {
      return { status: "skipped", reason: "min-interval" };
    }

    this.running = true;
    try {
      const result = await this.publishNow(request);
      if (
        result.status === "published" ||
        result.status === "unchanged" ||
        result.reason === "github-auth-missing"
      ) {
        this.lastPublishedMs = now;
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async publishNow(
    request: ClipSearchPublishRequest
  ): Promise<ClipSearchPublishResult> {
    const outGitPath = relativeRepoPath(this.publishRepoDir, this.outPath);
    logger.info(
      `🎬 Clip検索公開JSON更新開始: syncedAt=${request.syncedAt}, saved=${request.saved}, unavailable=${request.unavailable}`
    );

    const prepareResult = await this.preparePublishRepository(outGitPath);
    if (prepareResult) {
      return prepareResult;
    }

    await this.runCommand(
      process.execPath,
      [this.exportScriptPath, "--db", this.dbPath, "--out", this.outPath],
      { cwd: this.repoDir, timeoutMs: 120_000 }
    );

    const status = await this.runCommand(
      "git",
      ["status", "--porcelain", "--", outGitPath],
      { cwd: this.publishRepoDir, timeoutMs: 30_000 }
    );
    if (!status.stdout.trim()) {
      logger.info("🎬 Clip検索公開JSON更新なし: 差分なし");
      return { status: "unchanged" };
    }

    await this.runCommand("git", ["add", "--", outGitPath], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    const shouldAmend = await this.shouldAmendPreviousSyncTimeCommit(request);
    if (shouldAmend) {
      await this.commitPublishJson(["--amend", "--no-edit"]);
      const pushResult = await this.pushPublishJson(
        ["push", "--force-with-lease", this.remote, `HEAD:${this.branch}`]
      );
      if (pushResult) return pushResult;
    } else {
      await this.commitPublishJson(["-m", SYNC_TIME_COMMIT_MESSAGE]);
      const pushResult = await this.pushPublishJson([
        "push",
        this.remote,
        `HEAD:${this.branch}`,
      ]);
      if (pushResult) return pushResult;
    }

    logger.info(
      `🎬 Clip検索公開JSONを${this.remote}/${this.branch}へpushしました`
    );
    return { status: "published" };
  }

  private async commitPublishJson(args: string[]): Promise<void> {
    await this.runCommand("git", ["commit", ...args], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
      env: PUBLISH_GIT_IDENTITY_ENV,
    });
  }

  private async pushPublishJson(
    args: string[]
  ): Promise<ClipSearchPublishResult | null> {
    try {
      await this.runCommand("git", args, {
        cwd: this.publishRepoDir,
        env: this.gitNetworkEnv,
        timeoutMs: 120_000,
      });
      return null;
    } catch (error) {
      if (!isMissingGithubHttpsCredentials(error)) {
        throw error;
      }
      this.logMissingGithubAuth();
      return { status: "skipped", reason: "github-auth-missing" };
    }
  }

  private logMissingGithubAuth(): void {
    const message =
      "🎬 Clip検索公開JSON更新をスキップ: GitHub HTTPS push用の認証情報がありません。Dokploy環境変数 CLIP_SEARCH_PUBLISH_GITHUB_TOKEN（または GITHUB_TOKEN / GH_TOKEN）を設定してください";
    if (this.githubAuthMissingWarned) {
      logger.info(message);
      return;
    }
    this.githubAuthMissingWarned = true;
    logger.warn(message);
  }

  private async canDropLocalCommit(
    commit: CherryCommit,
    outGitPath: string
  ): Promise<boolean> {
    if (commit.marker === "-") {
      return true;
    }
    if (commit.subject !== SYNC_TIME_COMMIT_MESSAGE || !commit.hash) {
      return false;
    }

    const changedFiles = await this.runCommand(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", commit.hash],
      { cwd: this.publishRepoDir, timeoutMs: 30_000 }
    );
    return changesOnlyPublishJson(changedFiles.stdout, outGitPath);
  }

  private async preparePublishRepository(
    outGitPath: string
  ): Promise<ClipSearchPublishResult | null> {
    const remoteRef = `${this.remote}/${this.branch}`;

    await this.runCommand("git", ["fetch", this.remote, this.branch], {
      cwd: this.publishRepoDir,
      env: this.gitNetworkEnv,
      timeoutMs: 120_000,
    });

    const head = await this.runCommand("git", ["rev-parse", "HEAD"], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    const remoteHead = await this.runCommand("git", ["rev-parse", remoteRef], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    if (head.stdout.trim() === remoteHead.stdout.trim()) {
      return null;
    }

    const dirty = await this.runCommand("git", ["status", "--porcelain"], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    if (dirty.stdout.trim()) {
      const whitespaceOnly = await this.hasOnlyWhitespaceDirtyChanges(
        dirty.stdout
      );
      if (!whitespaceOnly) {
        logger.warn(
          "🎬 Clip検索公開JSON更新をスキップ: 公開repoに未コミット変更があります"
        );
        return { status: "skipped", reason: "dirty-publish-repo" };
      }
      logger.info(
        "🎬 Clip検索公開repoの未コミット差分は空白または改行だけのためremote同期で破棄します"
      );
    }

    const localCommitsResult = await this.runCommand(
      "git",
      ["cherry", "-v", remoteRef, "HEAD"],
      { cwd: this.publishRepoDir, timeoutMs: 30_000 }
    );
    const localCommits = parseCherryCommits(localCommitsResult.stdout);
    const commitDropEligibility = await Promise.all(
      localCommits.map(async (commit) => ({
        commit,
        canDrop: await this.canDropLocalCommit(commit, outGitPath),
      }))
    );
    const protectedCommits = commitDropEligibility.filter(
      ({ canDrop }) => !canDrop
    );
    const dropEligibleCommitCount =
      localCommits.length - protectedCommits.length;

    if (protectedCommits.length > 0) {
      logger.warn(
        `🎬 Clip検索公開JSON更新をスキップ: 公開repoに開発commitが残っています protectedCommits=${protectedCommits.length}, dropEligibleCommits=${dropEligibleCommitCount}`
      );
      return { status: "skipped", reason: "local-publish-commits" };
    }

    await this.runCommand("git", ["reset", "--hard", remoteRef], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    logger.info(
      `🎬 Clip検索公開repoを${remoteRef}へ同期しました dropEligibleCommits=${dropEligibleCommitCount}, protectedCommits=0`
    );
    return null;
  }

  private async hasOnlyWhitespaceDirtyChanges(
    dirtyStatus: string
  ): Promise<boolean> {
    if (!statusHasOnlyTrackedModifications(dirtyStatus)) {
      return false;
    }

    try {
      await this.runCommand("git", ["diff", "--ignore-all-space", "--quiet"], {
        cwd: this.publishRepoDir,
        timeoutMs: 30_000,
      });
      await this.runCommand(
        "git",
        ["diff", "--cached", "--ignore-all-space", "--quiet"],
        {
          cwd: this.publishRepoDir,
          timeoutMs: 30_000,
        }
      );
      return true;
    } catch {
      return false;
    }
  }

  private async shouldAmendPreviousSyncTimeCommit(
    request: ClipSearchPublishRequest
  ): Promise<boolean> {
    if (!isSyncTimeOnlyRequest(request)) {
      return false;
    }

    try {
      const head = await this.runCommand("git", ["log", "-1", "--pretty=%s"], {
        cwd: this.publishRepoDir,
        timeoutMs: 30_000,
      });
      return head.stdout.trim() === SYNC_TIME_COMMIT_MESSAGE;
    } catch (error) {
      logger.warn(
        `🎬 Clip検索公開JSON更新: 直前commit判定に失敗したため通常commitします: ${String(error)}`
      );
      return false;
    }
  }
}
