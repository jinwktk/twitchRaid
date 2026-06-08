import {
  formatRaidSourceInfoMessage,
  type RaidSourceInfo,
} from "./raid-info";

export interface GenerateRaidGreetingMessageOptions {
  info: RaidSourceInfo;
  viewerCount?: number;
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaGenerateResponse {
  response?: unknown;
  done?: unknown;
}

const GENERATED_RAID_GREETING_LIMIT = 250;
const DEFAULT_OLLAMA_TEMPERATURE = 0.8;
const DEFAULT_OLLAMA_NUM_PREDICT = 80;

const RAID_GREETING_SYSTEM_PROMPT = [
  "あなたはTwitch Raidへのお礼文を短く楽しく作る日本語アシスタントです。",
  "Output Japanese only. Do not answer in English or Chinese.",
  "必ず日本語だけで返答し、ひらがなかカタカナを含めてください。",
  "与えられた情報だけを使い、知らない内容は作らないでください。",
  "返答は1通のTwitchチャット投稿だけ。説明、ハッシュタグ、引用符、前置き、箇条書きは禁止です。",
  "必ずRaidのお礼、相手のユーザー名、配信情報または取得できなかったこと、チャンネルURLを含めてください。",
  "口調は「レイドありがとうD！！」に近い明るい雰囲気にしてください。",
  "絵文字は使わないでください。",
].join("\n");

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

function shortenKeepingUrl(
  value: string,
  streamUrl: string,
  maxLength: number
): string {
  if (value.length <= maxLength) return value;

  const urlIndex = value.indexOf(streamUrl);
  if (urlIndex < 0) return shorten(value, maxLength);

  const beforeUrl = value.slice(0, urlIndex).trimEnd();
  const reservedLength = streamUrl.length + 3;
  const maxBeforeLength = Math.max(0, maxLength - reservedLength);
  return `${beforeUrl.slice(0, maxBeforeLength).trimEnd()}${streamUrl}...`;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^[`"'「『]+/, "").replace(/[`"'」』]+$/, "").trim();
}

function removeEmoji(value: string): string {
  return value.replace(/\p{Extended_Pictographic}/gu, "");
}

function includesJapaneseKana(value: string): boolean {
  return /[\u3040-\u30ff]/.test(value);
}

function normalizeGeneratedGreeting(value: string): string | null {
  const normalized = stripWrappingQuotes(singleLine(removeEmoji(value)));
  if (!normalized) return null;
  if (!includesJapaneseKana(normalized)) return null;
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesUserMention(value: string, userName: string): boolean {
  return new RegExp(`@${escapeRegExp(userName)}\\b`, "i").test(value);
}

function removeLeadingUserName(value: string, userName: string): string {
  const escapedUserName = escapeRegExp(userName);
  return value
    .replace(
      new RegExp(`^@?${escapedUserName}\\s*(?:さん|氏)?\\s*(?:の|は|:|：|、)?\\s*`, "i"),
      ""
    )
    .trim();
}

function ensureUserMention(value: string, userName: string): string {
  if (includesUserMention(value, userName)) return value;

  const bareUserNamePattern = new RegExp(`@?${escapeRegExp(userName)}\\b`, "i");
  if (bareUserNamePattern.test(value)) {
    return value.replace(bareUserNamePattern, `@${userName}`);
  }

  const raidThanks = "レイドありがとうD！！";
  if (value.startsWith(raidThanks)) {
    const rest = value.slice(raidThanks.length).trim();
    return `${raidThanks} @${userName} さん、${rest}`;
  }

  return `レイドありがとうD！！ @${userName} さん、${value}`;
}

function ensureStreamUrl(value: string, streamUrl: string): string {
  if (value.includes(streamUrl)) return value;
  return `${value} チャンネルはこD→${streamUrl}`;
}

function buildOllamaGenerateUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/generate`;
}

function buildRaidGreetingPrompt(
  info: RaidSourceInfo,
  viewerCount?: number
): string {
  const title = info.title ? singleLine(info.title) : "不明";
  const gameName = info.gameName ? singleLine(info.gameName) : "不明";
  const viewers =
    typeof viewerCount === "number" && Number.isFinite(viewerCount)
      ? `${viewerCount}人`
      : "不明";

  return [
    "次のRaidに対して、Twitchチャットへ送る1通のRaid挨拶文を作ってください。",
    `ユーザー名: ${info.userName}`,
    `ゲーム: ${gameName}`,
    `配信タイトル: ${title}`,
    `Raid人数: ${viewers}`,
    `チャンネルURL: ${info.streamUrl}`,
    "条件: 日本語、1通、事実だけ、短い文、チャンネルURLを必ず最後の方に入れる。",
    "タイトル/ゲームが不明なら、配信情報は取得できなかったと正直に書いてください。",
    "完成したRaid挨拶文だけを返してください。説明は不要です。",
  ].join("\n");
}

export function formatGeneratedRaidGreetingMessage(
  info: RaidSourceInfo,
  generated: string
): string | null {
  const userName = normalizeLoginName(info.userName);
  const normalized = normalizeGeneratedGreeting(generated);
  if (!normalized) return null;

  const withoutDuplicateLead = removeLeadingUserName(normalized, userName);
  const withUser = ensureUserMention(withoutDuplicateLead, userName);
  const withUrl = ensureStreamUrl(withUser, info.streamUrl);
  return shortenKeepingUrl(
    withUrl,
    info.streamUrl,
    GENERATED_RAID_GREETING_LIMIT
  );
}

export async function generateRaidGreetingMessage({
  info,
  viewerCount,
  enabled,
  baseUrl,
  model,
  timeoutMs,
  keepAlive,
  fetchImpl = fetch,
}: GenerateRaidGreetingMessageOptions): Promise<string | null> {
  const trimmedModel = model.trim();
  if (!enabled || !trimmedModel) return null;

  try {
    const response = await fetchImpl(buildOllamaGenerateUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: trimmedModel,
        system: RAID_GREETING_SYSTEM_PROMPT,
        prompt: buildRaidGreetingPrompt(info, viewerCount),
        stream: false,
        keep_alive: keepAlive,
        options: {
          temperature: DEFAULT_OLLAMA_TEMPERATURE,
          num_predict: DEFAULT_OLLAMA_NUM_PREDICT,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as OllamaGenerateResponse;
    if (typeof body.response !== "string") return null;
    return formatGeneratedRaidGreetingMessage(info, body.response);
  } catch {
    return null;
  }
}

export async function buildRaidGreetingMessage(
  options: GenerateRaidGreetingMessageOptions
): Promise<string> {
  return (
    (await generateRaidGreetingMessage(options)) ??
    formatRaidSourceInfoMessage(options.info)
  );
}
