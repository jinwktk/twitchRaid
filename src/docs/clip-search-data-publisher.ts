import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import logger from "../utils/logger";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_TIME_COMMIT_MESSAGE = "Clip検索JSONを同期時刻更新";

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

function parseCommitSubjects(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  private running = false;
  private lastPublishedMs = 0;

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
      if (result.status === "published" || result.status === "unchanged") {
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

    const prepareResult = await this.preparePublishRepository();
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
      await this.runCommand("git", ["commit", "--amend", "--no-edit"], {
        cwd: this.publishRepoDir,
        timeoutMs: 30_000,
      });
      await this.runCommand(
        "git",
        ["push", "--force-with-lease", this.remote, this.branch],
        {
          cwd: this.publishRepoDir,
          timeoutMs: 120_000,
        }
      );
    } else {
      await this.runCommand(
        "git",
        ["commit", "-m", SYNC_TIME_COMMIT_MESSAGE],
        { cwd: this.publishRepoDir, timeoutMs: 30_000 }
      );
      await this.runCommand("git", ["push", this.remote, this.branch], {
        cwd: this.publishRepoDir,
        timeoutMs: 120_000,
      });
    }

    logger.info(
      `🎬 Clip検索公開JSONを${this.remote}/${this.branch}へpushしました`
    );
    return { status: "published" };
  }

  private async preparePublishRepository(): Promise<ClipSearchPublishResult | null> {
    const remoteRef = `${this.remote}/${this.branch}`;

    await this.runCommand("git", ["fetch", this.remote, this.branch], {
      cwd: this.publishRepoDir,
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
      logger.warn(
        "🎬 Clip検索公開JSON更新をスキップ: 公開repoに未コミット変更があります"
      );
      return { status: "skipped", reason: "dirty-publish-repo" };
    }

    const localOnly = await this.runCommand(
      "git",
      ["log", "--pretty=%s", `${remoteRef}..HEAD`],
      { cwd: this.publishRepoDir, timeoutMs: 30_000 }
    );
    const localOnlySubjects = parseCommitSubjects(localOnly.stdout);
    const canDropLocalCommits = localOnlySubjects.every(
      (subject) => subject === SYNC_TIME_COMMIT_MESSAGE
    );
    if (!canDropLocalCommits) {
      logger.warn(
        "🎬 Clip検索公開JSON更新をスキップ: 公開repoに開発commitが残っています"
      );
      return { status: "skipped", reason: "local-publish-commits" };
    }

    await this.runCommand("git", ["reset", "--hard", remoteRef], {
      cwd: this.publishRepoDir,
      timeoutMs: 30_000,
    });
    logger.info(
      `🎬 Clip検索公開repoを${remoteRef}へ同期しました`
    );
    return null;
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
