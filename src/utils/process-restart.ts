import { spawn } from "child_process";
import logger from "./logger";

/**
 * プロセスを再起動する（PM2環境ではprocess.exit、それ以外はspawn）
 */
export function restartProcess(): void {
  logger.info("プロセスを再起動します...");

  // PM2管理下の場合はprocess.exitでPM2に再起動させる
  if (process.env.PM2_HOME || process.env.pm_id) {
    logger.info("PM2管理下のため、process.exit(0)で再起動をトリガーします...");
    setTimeout(() => process.exit(0), 2000);
    return;
  }

  // PM2外の場合は子プロセスとして再起動
  logger.info("新しいプロセスをスポーンします...");
  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
  });
  child.unref();

  setTimeout(() => process.exit(0), 2000);
}
