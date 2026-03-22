/**
 * Twitch OAuth スコープ定義
 * twurpleではスコープは文字列として管理する
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

export const MANGA_EXTRA_REAUTH_SCOPES: string[] = [
  "moderator:manage:chat_messages",
  "user:write:chat",
];

export const REAUTH_AUTH_SCOPES: string[] = [
  ...REQUIRED_AUTH_SCOPES,
  ...MANGA_EXTRA_REAUTH_SCOPES.filter(
    (s) => !REQUIRED_AUTH_SCOPES.includes(s)
  ),
];
