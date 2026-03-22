import type { GitManager } from "./git-manager";
import logger from "./utils/logger";
import { restartProcess } from "./utils/process-restart";

export class SystemWatcher {
  private readonly gitManager: GitManager;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setInterval> | null = null;

  constructor(gitManager: GitManager) {
    this.gitManager = gitManager;
  }

  /**
   * GitHub更新監視を開始
   */
  startUpdateWatcher(): void {
    const interval = this.gitManager["config"].updateCheckInterval * 1000;

    this.updateTimer = setInterval(() => {
      try {
        logger.info("GitHub更新確認中...");
        this.gitManager.checkForUpdates();
      } catch (e) {
        logger.error(`GitHub更新監視エラー: ${e}`);
      }
    }, interval);

    logger.info("GitHub更新監視を開始しました。");
  }

  /**
   * 定期再起動監視を開始
   */
  startRestartWatcher(): void {
    const interval = this.gitManager["config"].restartCheckInterval * 1000;

    this.restartTimer = setInterval(() => {
      try {
        const should = this.gitManager.shouldRestart();
        if (should) {
          if (this.gitManager.restartPending) {
            logger.info("保留中の更新があるため再起動します...");
            this.gitManager.restartPending = false;
          } else {
            logger.info("1日経過したので再起動を開始します...");
          }
          logger.info("再起動前の最終ログ - プロセス終了");
          restartProcess();
        }
      } catch (e) {
        logger.error(`再起動監視エラー: ${e}`);
      }
    }, interval);

    logger.info("定期再起動監視を開始しました。");
  }

  stop(): void {
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.restartTimer) clearInterval(this.restartTimer);
  }
}
