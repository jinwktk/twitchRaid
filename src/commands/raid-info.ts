import type { ApiClient } from "@twurple/api";
import logger from "../utils/logger";

export interface RaidSourceInfo {
  userName: string;
  streamUrl: string;
  title: string | null;
  gameName: string | null;
}

export type HelixRaidStreamFetchLike = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<{ ok: boolean; status?: number; text(): Promise<string> }>;

export interface FetchRaidSourceInfoOptions {
  helixClientId?: string;
  helixAccessToken?: string;
  helixFetchFn?: HelixRaidStreamFetchLike;
  helixRetryAttempts?: number;
  helixRetryDelayMs?: number;
}

interface HelixRaidStreamPage {
  data: Array<{
    title?: unknown;
    game_name?: unknown;
  }>;
}

const TWITCH_CHAT_MESSAGE_LIMIT = 500;
const RAID_TITLE_LIMIT = 120;
const DEFAULT_HELIX_RETRY_ATTEMPTS = 2;
const DEFAULT_HELIX_RETRY_DELAY_MS = 500;

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

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? ` ${String(error.cause)}`
        : "";
    return `${error.name} ${error.message}${cause}`;
  }

  return String(error);
}

function isTransientRaidStreamFetchError(error: unknown): boolean {
  return /premature close|econnreset|etimedout|socket hang up|fetch failed|body terminated|aborted|terminated|unexpected end of json input/i.test(
    errorText(error)
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function raidSourceInfoFromStream(
  normalizedUserName: string,
  streamUrl: string,
  stream: { title?: unknown; gameName?: unknown; game_name?: unknown } | null
): RaidSourceInfo {
  const title = stringValue(stream?.title);
  const gameName =
    stringValue(stream?.gameName) ?? stringValue(stream?.game_name);
  return {
    userName: normalizedUserName,
    streamUrl,
    title: title ? singleLine(title) : null,
    gameName: gameName ? singleLine(gameName) : null
  };
}

function parseHelixRaidStreamPage(response: unknown): HelixRaidStreamPage {
  if (typeof response !== "object" || response === null) return { data: [] };
  const data = (response as Record<string, unknown>)["data"];
  return {
    data: Array.isArray(data)
      ? data.flatMap((item) =>
          typeof item === "object" && item !== null
            ? [item as { title?: unknown; game_name?: unknown }]
            : []
        )
      : []
  };
}

async function fetchRaidStreamIdentityWithRetry(
  normalizedUserName: string,
  options: Required<
    Pick<
      FetchRaidSourceInfoOptions,
      "helixClientId" | "helixAccessToken" | "helixFetchFn"
    >
  > & {
    helixRetryAttempts: number;
    helixRetryDelayMs: number;
  }
): Promise<{ title?: unknown; game_name?: unknown } | null> {
  const maxAttempts = Math.max(1, options.helixRetryAttempts + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchRaidStreamIdentity(normalizedUserName, options);
    } catch (e) {
      if (attempt >= maxAttempts || !isTransientRaidStreamFetchError(e)) {
        throw e;
      }

      logger.info(
        `Raid元配信情報の取得を再試行: attempt=${attempt}/${maxAttempts}, reason=${errorText(e)}`
      );
      await delay(options.helixRetryDelayMs);
    }
  }

  throw new Error("Twitch raid stream identity fetch did not complete");
}

async function fetchRaidStreamIdentity(
  normalizedUserName: string,
  options: Required<
    Pick<
      FetchRaidSourceInfoOptions,
      "helixClientId" | "helixAccessToken" | "helixFetchFn"
    >
  >
): Promise<{ title?: unknown; game_name?: unknown } | null> {
  const url = new URL("https://api.twitch.tv/helix/streams");
  url.searchParams.set("user_login", normalizedUserName);

  const response = await options.helixFetchFn(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      Authorization: `Bearer ${options.helixAccessToken}`,
      "Client-ID": options.helixClientId
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Twitch Helix streams request failed: status=${response.status ?? "unknown"}`
    );
  }

  const page = parseHelixRaidStreamPage(JSON.parse(body));
  return page.data[0] ?? null;
}

/**
 * Raid元のライブ配信情報を取得する。
 *
 * Raid直後は配信終了済みとしてTwitch APIから返らない場合があるため、
 * URLは常に返し、タイトル/ゲームは取得できた時だけ埋める。
 */
export async function fetchRaidSourceInfo(
  apiClient: Pick<ApiClient, "streams">,
  userName: string,
  options: FetchRaidSourceInfoOptions = {}
): Promise<RaidSourceInfo> {
  const normalizedUserName = normalizeLoginName(userName);
  const streamUrl = `https://www.twitch.tv/${normalizedUserName}`;
  const helixClientId = options.helixClientId?.trim();
  const helixAccessToken = options.helixAccessToken?.trim();

  if (helixClientId && helixAccessToken) {
    const stream = await fetchRaidStreamIdentityWithRetry(normalizedUserName, {
      helixClientId,
      helixAccessToken,
      helixFetchFn: options.helixFetchFn ?? fetch,
      helixRetryAttempts:
        options.helixRetryAttempts ?? DEFAULT_HELIX_RETRY_ATTEMPTS,
      helixRetryDelayMs:
        options.helixRetryDelayMs ?? DEFAULT_HELIX_RETRY_DELAY_MS
    });

    return raidSourceInfoFromStream(normalizedUserName, streamUrl, stream);
  }

  const stream =
    await apiClient.streams.getStreamByUserName(normalizedUserName);
  return raidSourceInfoFromStream(normalizedUserName, streamUrl, stream);
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
