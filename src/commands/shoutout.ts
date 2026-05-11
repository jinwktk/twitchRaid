import type { ApiClient } from "@twurple/api";

interface SendShoutoutParams {
  broadcasterId: string;
  moderatorUserId: string;
  targetUsername: string;
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
