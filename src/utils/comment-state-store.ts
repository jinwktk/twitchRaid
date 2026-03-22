import { config as dotenvConfig } from "dotenv";
import { updateEnvFile } from "./env-store";

/**
 * .envからコメント状態を読み込む
 */
export function loadCommentState(envFile: string): [number, number] {
  try {
    const env = dotenvConfig({ path: envFile }).parsed ?? {};
    const totalCount = parseInt(env["COMMENT_TOTAL_COUNT"] ?? "0", 10) || 0;
    const streamStartedAt =
      parseFloat(env["COMMENT_STREAM_STARTED_AT"] ?? "0") || 0;
    return [totalCount, streamStartedAt];
  } catch {
    return [0, 0];
  }
}

/**
 * コメント状態を.envに保存する
 */
export function saveCommentState(
  envFile: string,
  totalCount: number,
  streamStartedAt: number
): void {
  try {
    updateEnvFile(envFile, {
      COMMENT_TOTAL_COUNT: String(totalCount),
      COMMENT_STREAM_STARTED_AT: String(streamStartedAt),
    });
  } catch (e) {
    // 保存失敗は無視（次回リトライ）
  }
}
