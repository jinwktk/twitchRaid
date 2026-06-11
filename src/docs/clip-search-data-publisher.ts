import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import logger from "../utils/logger";

const execFileAsync = promisify(execFile);
const DEFAULT_REPO_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface ClipSearchPublishRequest {
  syncedAt: string;
  saved: number;
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
  remote?: string;
  branch?: string;
  minIntervalMs?: number;
  runCommand?: RunCommand;
  nowMs?: () => number;
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

export class ClipSearchDataPublisher {
  private readonly enabled: boolean;
  private readonly repoDir: string;
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
    const outGitPath = relativeRepoPath(this.repoDir, this.outPath);
    logger.info(
      `🎬 Clip検索公開JSON更新開始: syncedAt=${request.syncedAt}, saved=${request.saved}`
    );

    await this.runCommand(
      process.execPath,
      [this.exportScriptPath, "--db", this.dbPath, "--out", this.outPath],
      { cwd: this.repoDir, timeoutMs: 120_000 }
    );

    const status = await this.runCommand(
      "git",
      ["status", "--porcelain", "--", outGitPath],
      { cwd: this.repoDir, timeoutMs: 30_000 }
    );
    if (!status.stdout.trim()) {
      logger.info("🎬 Clip検索公開JSON更新なし: 差分なし");
      return { status: "unchanged" };
    }

    await this.runCommand("git", ["add", "--", outGitPath], {
      cwd: this.repoDir,
      timeoutMs: 30_000,
    });
    await this.runCommand(
      "git",
      ["commit", "-m", "Clip検索JSONを同期時刻更新"],
      { cwd: this.repoDir, timeoutMs: 30_000 }
    );
    await this.runCommand("git", ["push", this.remote, this.branch], {
      cwd: this.repoDir,
      timeoutMs: 120_000,
    });

    logger.info(
      `🎬 Clip検索公開JSONを${this.remote}/${this.branch}へpushしました`
    );
    return { status: "published" };
  }
}
