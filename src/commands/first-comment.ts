import logger from "../utils/logger";

/**
 * 配信中の初コメを記録・取得するトラッカー
 * 配信終了時にリセットされる
 */
export class FirstCommentTracker {
  private readonly store = new Map<string, { text: string; time: Date }>();

  /**
   * メッセージを記録する（まだ記録がないユーザーのみ）
   */
  record(user: string, text: string): void {
    const key = user.toLowerCase();
    if (this.store.has(key)) return;
    this.store.set(key, { text, time: new Date() });
    logger.debug(`初コメ記録: ${user}: ${text}`);
  }

  /**
   * 指定ユーザーの初コメを取得する
   */
  get(user: string): { text: string; time: Date } | null {
    return this.store.get(user.toLowerCase()) ?? null;
  }

  /**
   * 配信終了時にリセットする
   */
  reset(): void {
    this.store.clear();
    logger.info("🗑️ 初コメデータをリセットしました。");
  }
}
