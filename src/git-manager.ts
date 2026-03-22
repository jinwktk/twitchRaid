import { execSync } from "child_process";
import type { Config } from "./config";
import logger from "./utils/logger";
import {
  loadLastRestart,
  saveLastRestart,
  evaluateRestart,
} from "./utils/restart-state-store";
import { restartProcess } from "./utils/process-restart";

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

  pullAndRestartIfUpdated(): void {
    try {
      const result = execSync("git pull", { encoding: "utf-8" });
      logger.info(`Git pull結果: ${result}`);
      if (!result.includes("Already up to date")) {
        this.restartWithCooldown("更新があったので再起動します");
      }
    } catch (e) {
      logger.error(`Git pull エラー: ${e}`);
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

      const fetchResult = execSync("git fetch", {
        encoding: "utf-8",
        stdio: "pipe",
      });

      const countStr = execSync(
        `git rev-list HEAD...origin/${branch} --count`,
        { encoding: "utf-8" }
      ).trim();

      if (countStr !== "0") {
        logger.info(
          `リモートに ${countStr} 件の更新があります。プルして再起動します...`
        );
        const pullResult = execSync("git pull", { encoding: "utf-8" });
        logger.info(`プル結果: ${pullResult}`);
        this.restartWithCooldown("更新があったので再起動します");
        return true;
      }

      logger.info("更新なし - 最新状態です");
      return false;
    } catch (e) {
      logger.error(`GitHub更新確認エラー: ${e}`);
      return false;
    }
  }
}
