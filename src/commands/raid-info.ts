import type { ApiClient } from "@twurple/api";

export interface RaidSourceInfo {
  userName: string;
  streamUrl: string;
  title: string | null;
  gameName: string | null;
}

const TWITCH_CHAT_MESSAGE_LIMIT = 500;
const RAID_TITLE_LIMIT = 120;

function normalizeLoginName(userName: string): string {
  return userName.trim().replace(/^@+/, "").toLowerCase();
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

/**
 * Raid元のライブ配信情報を取得する。
 *
 * Raid直後は配信終了済みとしてTwitch APIから返らない場合があるため、
 * URLは常に返し、タイトル/ゲームは取得できた時だけ埋める。
 */
export async function fetchRaidSourceInfo(
  apiClient: Pick<ApiClient, "streams">,
  userName: string
): Promise<RaidSourceInfo> {
  const normalizedUserName = normalizeLoginName(userName);
  const streamUrl = `https://www.twitch.tv/${normalizedUserName}`;
  const stream = await apiClient.streams.getStreamByUserName(normalizedUserName);

  return {
    userName: normalizedUserName,
    streamUrl,
    title: stream?.title ? singleLine(stream.title) : null,
    gameName: stream?.gameName ? singleLine(stream.gameName) : null,
  };
}

export function formatRaidSourceInfoMessage(info: RaidSourceInfo): string {
  const userName = normalizeLoginName(info.userName);
  const titleSource = info.title ? singleLine(info.title) : null;
  const gameName = info.gameName ? singleLine(info.gameName) : null;
  const prefix = `レイドありがとうD！！ @${userName} さん`;
  const suffix = `お疲れ様D！チャンネルはこD→${info.streamUrl}`;
  if (!titleSource && !gameName) {
    return `${prefix}の配信情報は取得できなかったD！${suffix}`;
  }

  const displayGameName = gameName ?? "ゲーム不明";
  const nonTitleLength =
    `${prefix}は、「${displayGameName}」で「」をしてたD！`.length +
    suffix.length;
  const maxTitleLength = Math.min(
    RAID_TITLE_LIMIT,
    Math.max(20, TWITCH_CHAT_MESSAGE_LIMIT - nonTitleLength)
  );
  const title = titleSource ? shorten(titleSource, maxTitleLength) : null;

  return `${prefix}は、「${displayGameName}」で「${title ?? "タイトル不明"}」をしてたD！${suffix}`;
}
