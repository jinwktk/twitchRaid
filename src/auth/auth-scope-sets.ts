/**
 * Twitch OAuth スコープ定義
 * twurpleではスコープは文字列として管理する
 *
 * 注: 過去 MANGA_EXTRA_REAUTH_SCOPES が REQUIRED_AUTH_SCOPES と完全に重複した
 * dead branch を含んでいたため整理した。再認証時に追加スコープが必要になった
 * 場合は REAUTH_AUTH_SCOPES に直接追加する。
 */

export const REQUIRED_AUTH_SCOPES: string[] = [
  "chat:read",
  "chat:edit",
  "moderator:manage:shoutouts",
  "clips:edit",
  "user:read:email",
  "channel:read:stream_key",
  "moderator:manage:chat_messages",
  "user:write:chat",
];

export const EMOTE_READ_REAUTH_SCOPES: string[] = ["user:read:emotes"];

export const REAUTH_AUTH_SCOPES: string[] = [
  ...new Set([...REQUIRED_AUTH_SCOPES, ...EMOTE_READ_REAUTH_SCOPES]),
];
