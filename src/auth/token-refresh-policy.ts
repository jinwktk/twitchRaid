/**
 * トークンリフレッシュ失敗時のフォールバック判定
 * 400-499 (クライアントエラー) → フォールバック再認証を試行
 * 500+ (サーバーエラー) → リトライ
 */
export function shouldTryFallback(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500;
}
