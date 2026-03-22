/**
 * メッセージがコマンドかどうかを判定する
 */
export function isCommandMessage(content: string, prefix: string): boolean {
  return content.startsWith(prefix);
}
