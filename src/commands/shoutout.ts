import type { ApiClient } from "@twurple/api";

interface SendShoutoutParams {
  broadcasterId: string;
  moderatorUserId: string;
  targetUsername: string;
}

/**
 * shoutoutコマンドの管理者判定
 */
export function isShoutoutAdmin(
  userName: string | undefined,
  adminUsers: string[],
  isMod: boolean,
  isBroadcaster: boolean
): boolean {
  if (isBroadcaster) return true;
  if (isMod) return true;
  if (userName && adminUsers.includes(userName.toLowerCase())) return true;
  return false;
}

/**
 * `!shoutout @name` / `!shoutout name` の対象ログイン名を正規化する。
 */
export function normalizeShoutoutTarget(rawTarget: string | undefined): string | null {
  const normalized = (rawTarget ?? "").trim().replace(/^@+/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * レイド元ユーザーへシャウトアウトを送信する。
 *
 * Twurple の shoutoutUser はデフォルトで broadcaster のユーザーコンテキストを
 * 探すため、Bot/Moderator の登録済みコンテキストへ明示的に切り替えて実行する。
 */
export async function sendShoutout(
  apiClient: ApiClient,
  params: SendShoutoutParams
): Promise<boolean> {
  const user = await apiClient.users.getUserByName(params.targetUsername);
  if (!user) return false;

  await apiClient.asUser(params.moderatorUserId, async (ctx) => {
    await ctx.chat.shoutoutUser(params.broadcasterId, user.id);
  });

  return true;
}
