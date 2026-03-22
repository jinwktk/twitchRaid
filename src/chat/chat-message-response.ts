/**
 * Twitch API send_chat_message のレスポンスからメッセージIDを抽出する
 */
export function getSentMessageId(sendResult: unknown): string {
  if (sendResult && typeof sendResult === "object") {
    const result = sendResult as Record<string, unknown>;

    // twurple APIのレスポンス形式に対応
    if (typeof result["id"] === "string") return result["id"];
    if (typeof result["messageId"] === "string") return result["messageId"];

    // data配列形式
    const data = result["data"];
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0] as Record<string, unknown>;
      if (typeof first["message_id"] === "string") return first["message_id"];
    }
  }
  return "";
}
