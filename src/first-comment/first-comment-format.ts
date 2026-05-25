import type {
  UserFirstCommentRecord,
} from "./first-comment-store";
import type { FirstCommentBackfillResult } from "./first-comment-backfill";

export function formatFirstComment(
  record: UserFirstCommentRecord | null,
  requestedUser?: string
): string {
  if (!record) {
    const suffix = requestedUser ? `@${requestedUser} の` : "";
    return `${suffix}初コメはまだ保存されていません。`;
  }

  const displayName = record.authorDisplayName || record.authorName;
  return `@${displayName} の初コメ: ${formatDateTime(record.firstCommentedAt)}「${truncate(
    record.messageText,
    120
  )}」`;
}

export function formatFirstCommentBackfillResult(
  result: FirstCommentBackfillResult
): string {
  return `初コメバックフィル完了: 対象${result.processed}件 / 走査コメント${result.commentsScanned}件 / 保存${result.saved}件 / 既存${result.skipped}件 / コメントなし${result.noComments}件 / 失敗${result.failed}件`;
}

function formatDateTime(isoValue: string): string {
  const date = new Date(isoValue);
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
