import { Config } from "./config";
import { Bot } from "./bot";
import { GitManager } from "./git-manager";
import { SystemWatcher } from "./system-watcher";
import { getValidAccessToken } from "./auth/token-manager";
import logger from "./utils/logger";

async function main(): Promise<void> {
  const maxRetries = 10;
  let retryCount = 0;
  const backoffDelay = 10;

  logger.info("=== TwitchRaid Bot Starting (TypeScript) ===");

  const config = new Config();
  let systemWatcher: SystemWatcher | null = null;

  if (config.gitAutoUpdateEnabled) {
    const gitManager = new GitManager(config);
    systemWatcher = new SystemWatcher(gitManager);

    // 起動時にGit更新チェック
    logger.info("GitHub更新チェックを実行中...");
    gitManager.pullAndRestartIfUpdated();

    // 監視開始
    systemWatcher.startUpdateWatcher();
    systemWatcher.startRestartWatcher();
    logger.info("全ての監視が開始されました。");
  } else {
    logger.info("内部Git自動更新は無効です。Dokployのデプロイ管理を使用します。");
  }

  let bot: Bot | null = null;

  // Graceful shutdown（一度だけ登録）
  const shutdown = async () => {
    logger.info("シャットダウン中...");
    if (bot) await bot.stop();
    systemWatcher?.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  while (retryCount < maxRetries) {
    try {
      // トークン検証
      const validToken = await getValidAccessToken(config);
      if (!validToken) {
        retryCount++;
        logger.warn(
          `⚠️ トークン取得失敗 (${retryCount}/${maxRetries})。自動リトライします...`
        );
        const waitTime = Math.min(backoffDelay * 2 ** retryCount, 300);
        await sleep(waitTime * 1000);
        continue;
      }

      bot = new Bot(config);
      await bot.start();
      break; // 正常起動
    } catch (e) {
      retryCount++;
      logger.error(`❌ メインループでエラー発生: ${e}`);

      if (retryCount < maxRetries) {
        const waitTime = Math.min(backoffDelay * 2 ** retryCount, 300);
        logger.info(
          `🔄 自動復旧を試行 (${retryCount}/${maxRetries})... ${waitTime}秒待機`
        );
        await sleep(waitTime * 1000);
      } else {
        logger.error("❌ 最大再試行回数に達しました。プロセスを再起動します...");
        process.exit(1); // PM2が再起動する
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((e) => {
  logger.error(`⚠️ 致命的エラー: ${e}`);
  process.exit(1);
});
