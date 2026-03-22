import logger from "../utils/logger";

const GQL_URL = "https://gql.twitch.tv/gql";
const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const GQL_HASH =
  "eb4e9869e1bb0b3ed553e1ed657fa09f8553781093569c3a5813ad09ee9c0776";

interface GqlMessage {
  sentAt: string;
  text: string;
  login: string;
}

/**
 * Twitch GQL APIでモデレータ権限のチャット履歴から初コメを取得する
 */
export async function fetchFirstComment(
  gqlToken: string,
  channelId: string,
  senderLogin: string
): Promise<GqlMessage | null> {
  // まずユーザーIDを解決する
  const userId = await resolveUserId(gqlToken, senderLogin);
  if (!userId) {
    logger.warn(`⚠️ ユーザー ${senderLogin} のIDが見つかりません。`);
    return null;
  }

  // GQL APIでチャット履歴を取得（最新50件）
  const messages = await fetchMessages(gqlToken, channelId, userId);
  if (messages.length === 0) return null;

  // 最も古いメッセージ（配列の最後）が初コメに最も近い
  return messages[messages.length - 1];
}

async function resolveUserId(
  gqlToken: string,
  login: string
): Promise<string | null> {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        Authorization: `OAuth ${gqlToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query { user(login: "${login}") { id } }`,
      }),
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    return data?.data?.user?.id ?? null;
  } catch (e) {
    logger.error(`❌ ユーザーID解決失敗 (${login}): ${e}`);
    return null;
  }
}

async function fetchMessages(
  gqlToken: string,
  channelId: string,
  senderId: string
): Promise<GqlMessage[]> {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: {
        "Client-Id": GQL_CLIENT_ID,
        Authorization: `OAuth ${gqlToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          operationName: "ViewerCardModLogsMessagesBySender",
          variables: { senderID: senderId, channelID: channelId },
          extensions: {
            persistedQuery: { version: 1, sha256Hash: GQL_HASH },
          },
        },
      ]),
    });

    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;

    if (item.errors) {
      logger.error(`❌ GQL エラー: ${JSON.stringify(item.errors)}`);
      return [];
    }

    const edges =
      item.data?.viewerCardModLogs?.messages?.edges ?? [];

    return edges.map(
      (e: {
        node: {
          sentAt: string;
          content: { text: string };
          sender: { login: string };
        };
      }) => ({
        sentAt: e.node.sentAt,
        text: e.node.content.text,
        login: e.node.sender.login,
      })
    );
  } catch (e) {
    logger.error(`❌ GQL チャット履歴取得失敗: ${e}`);
    return [];
  }
}
