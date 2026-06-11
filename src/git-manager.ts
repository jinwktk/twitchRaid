import { execSync } from "child_process";
import type { Config } from "./config";
import logger from "./utils/logger";
import {
  loadLastRestart,
  saveLastRestart,
  evaluateRestart,
} from "./utils/restart-state-store";
import { restartProcess } from "./utils/process-restart";

const RESTART_IGNORED_CHANGED_PATHS = new Set(["docs/clip-search-data.json"]);

function parseChangedPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

export class GitManager {
  private readonly config: Config;
  restartPending = false;

  constructor(config: Config) {
    this.config = config;
  }

  get updateCheckInterval(): number {
    return this.config.updateCheckInterval;
  }

  get restartCheckInterval(): number {
    return this.config.restartCheckInterval;
  }

  shouldRestart(): boolean {
    const now = Date.now() / 1000;
    const last = loadLastRestart(this.config.restartFile);
    const [shouldDo, nextStamp] = evaluateRestart(
      now,
      last,
      this.config.restartInterval
    );
    if (nextStamp !== last) {
      saveLastRestart(this.config.restartFile, nextStamp);
    }
    return shouldDo;
  }

  restartWithCooldown(reason: string): boolean {
    if (this.shouldRestart()) {
      this.restartPending = false;
      logger.info(reason);
      restartProcess();
      return true;
    }
    this.restartPending = true;
    logger.info("再起動クールダウン中のため保留します。");
    return false;
  }

  restartAfterUpdate(reason: string): boolean {
    this.restartPending = false;
    saveLastRestart(this.config.restartFile, Date.now() / 1000);
    logger.info(reason);
    restartProcess();
    return true;
  }

  pullAndRestartIfUpdated(): void {
    try {
      const beforeHead = this._currentCommit();
      const result = execSync("git pull", { encoding: "utf-8" });
      logger.info(`Git pull結果: ${result}`);
      if (!result.includes("Already up to date")) {
        const afterHead = this._currentCommit();
        const changedPaths =
          beforeHead && afterHead
            ? this._changedPathsBetween(beforeHead, afterHead)
            : [];
        if (this._isRestartIgnoredUpdate(changedPaths)) {
          logger.info(
            `再起動不要の更新のみ反映しました: ${changedPaths.join(", ")}`
          );
          return;
        }
        this._buildAfterPull();
        this.restartAfterUpdate("更新があったので再起動します");
      }
    } catch (e) {
      logger.error(`Git pull エラー: ${e}`);
    }
  }

  private _buildAfterPull(): void {
    try {
      logger.info("📦 TypeScriptビルドを実行中...");
      const buildResult = execSync("npm run build", {
        encoding: "utf-8",
        timeout: 60_000,
      });
      logger.info(`✅ ビルド完了: ${buildResult.trim()}`);
    } catch (e) {
      logger.error(`❌ ビルド失敗: ${e}`);
    }
  }

  private _currentBranch(): string {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
      }).trim();
    } catch {
      return "main";
    }
  }

  checkForUpdates(): boolean {
    try {
      const branch = this._currentBranch();

      execSync("git fetch", {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const countStr = execSync(
        `git rev-list HEAD...origin/${branch} --count`,
        { encoding: "utf-8" }
      ).trim();

      if (countStr !== "0") {
        const changedPaths = this._changedPathsBetween(
          "HEAD",
          `origin/${branch}`
        );
        logger.info(
          `リモートに ${countStr} 件の更新があります。プルして再起動します...`
        );
        const pullResult = execSync("git pull", { encoding: "utf-8" });
        logger.info(`プル結果: ${pullResult}`);
        if (this._isRestartIgnoredUpdate(changedPaths)) {
          logger.info(
            `再起動不要の更新のみ反映しました: ${changedPaths.join(", ")}`
          );
          return true;
        }
        this._buildAfterPull();
        this.restartAfterUpdate("更新があったので再起動します");
        return true;
      }

      logger.info("更新なし - 最新状態です");
      return false;
    } catch (e) {
      logger.error(`GitHub更新確認エラー: ${e}`);
      return false;
    }
  }

  private _currentCommit(): string | null {
    try {
      return execSync("git rev-parse HEAD", {
        encoding: "utf-8",
      }).trim();
    } catch {
      return null;
    }
  }

  private _changedPathsBetween(baseRevision: string, targetRevision: string): string[] {
    try {
      return parseChangedPaths(
        execSync(`git diff --name-only ${baseRevision} ${targetRevision}`, {
          encoding: "utf-8",
        })
      );
    } catch {
      return [];
    }
  }

  private _isRestartIgnoredUpdate(changedPaths: string[]): boolean {
    return (
      changedPaths.length > 0 &&
      changedPaths.every((path) => RESTART_IGNORED_CHANGED_PATHS.has(path))
    );
  }
}
