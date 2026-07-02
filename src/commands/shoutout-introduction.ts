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
  onDecision?: (decision: RaidGreetingDecision) => void;
}

interface OllamaGenerateResponse {
  response?: unknown;
  done?: unknown;
}

export type RaidGreetingFallbackReason =
  | "disabled"
  | "missing_model"
  | "http_error"
  | "invalid_response"
  | "empty_or_non_japanese"
  | "negative_raid_size"
  | "request_failed";

export interface RaidGreetingDecision {
  status: "generated" | "fallback";
  userName: string;
  reason?: RaidGreetingFallbackReason;
  elapsedMs?: number;
  detail?: string;
}

export const GENERATED_RAID_GREETING_LIMIT = 500;
const DEFAULT_OLLAMA_TEMPERATURE = 0.8;
const DEFAULT_OLLAMA_NUM_PREDICT = 180;
const NEGATIVE_RAID_SIZE_PATTERNS = [
  /人数\s*(?:が|は|も|の)?\s*(?:少な|すくな)/i,
  /(?:少な|すくな)かった/i,
  /少人数/i,
  /(?:寂し|さみし)/i,
  /人数\s*(?:控えめ|ひかえめ)/i,
  /(?:たった|小規模|こじんまり)/i,
];

const RAID_GREETING_SYSTEM_PROMPT = [
  "あなたはTwitch Raidへのお礼と紹介文を明るく作る日本語アシスタントです。",
  "Output Japanese only. Do not answer in English or Chinese.",
  "必ず日本語だけで返答し、ひらがなかカタカナを含めてください。",
  "与えられた情報だけを使い、知らない内容は作らないでください。",
  "返答は1通のTwitchチャット投稿だけ。説明、ハッシュタグ、引用符、前置き、箇条書きは禁止です。",
  "500文字以内で、相手の配信内容が伝わるように詳しめに書いてください。",
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

export function shortenRaidGreetingKeepingUrl(
  value: string,
  streamUrl: string,
  maxLength: number
): string {
  if (value.length <= maxLength) return value;

  const urlIndex = value.indexOf(streamUrl);
  if (urlIndex < 0) return shorten(value, maxLength);

  const beforeUrl = value.slice(0, urlIndex).trimEnd();
  const afterUrl = value
    .slice(urlIndex + streamUrl.length)
    .trimEnd()
    .replace(/^\.\.\.(?=\s|$)/, "");
  const tail = `${streamUrl}${afterUrl}`;
  const ellipsis = "...";
  const maxBeforeLength = maxLength - tail.length - ellipsis.length;
  if (maxBeforeLength <= 0) return shorten(tail, maxLength);
  return `${beforeUrl.slice(0, maxBeforeLength).trimEnd()}${ellipsis}${tail}`;
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

function hasNegativeRaidSizePhrasing(value: string): boolean {
  return NEGATIVE_RAID_SIZE_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeRequiredContent(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

function removeDecorativeTitleParts(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\w+/g, " ")
    .replace(/[「『【［\[].*?[」』】］\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCoverageCandidates(title: string | null): string[] {
  if (!title) return [];
  const candidates = [title, removeDecorativeTitleParts(title)];
  return [...new Set(candidates.map(normalizeRequiredContent).filter(Boolean))];
}

function includesRequiredContent(value: string, required: string | null): boolean {
  if (!required) return true;
  const normalizedRequired = normalizeRequiredContent(required);
  if (!normalizedRequired) return true;
  return normalizeRequiredContent(value).includes(normalizedRequired);
}

function includesTitleContent(value: string, title: string | null): boolean {
  const normalizedValue = normalizeRequiredContent(value);
  const candidates = titleCoverageCandidates(title);
  if (candidates.length === 0) return true;
  return candidates.some((candidate) => normalizedValue.includes(candidate));
}

function includesRequiredStreamDetails(
  value: string,
  info: RaidSourceInfo
): boolean {
  return (
    includesRequiredContent(value, info.gameName) &&
    includesTitleContent(value, info.title)
  );
}

function buildStreamDetailsClause(
  info: RaidSourceInfo,
  missing: { gameName: boolean; title: boolean }
): string | null {
  const gameName = info.gameName ? singleLine(info.gameName) : null;
  const title = info.title ? singleLine(info.title) : null;
  if (missing.gameName && missing.title && gameName && title) {
    return `配信では「${gameName}」で「${title}」をしてたD！`;
  }
  if (missing.gameName && gameName) return `「${gameName}」で遊んでたD！`;
  if (missing.title && title) return `「${title}」をしてたD！`;
  return null;
}

function insertBeforeStreamUrl(
  value: string,
  streamUrl: string,
  insertion: string
): string {
  const urlIndex = value.indexOf(streamUrl);
  if (urlIndex < 0) return `${value} ${insertion}`;

  const beforeUrl = value.slice(0, urlIndex).trimEnd();
  const afterUrl = value.slice(urlIndex + streamUrl.length);
  return `${beforeUrl} ${insertion} ${streamUrl}${afterUrl}`;
}

function ensureStreamDetails(value: string, info: RaidSourceInfo): string {
  const missing = {
    gameName: !includesRequiredContent(value, info.gameName),
    title: !includesTitleContent(value, info.title),
  };

  if (!missing.gameName && !missing.title) return value;

  const details = buildStreamDetailsClause(info, missing);
  if (!details || value.includes(details)) return value;
  return insertBeforeStreamUrl(value, info.streamUrl, details);
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

function buildRaidGreetingPrompt(info: RaidSourceInfo): string {
  const title = info.title ? singleLine(info.title) : "不明";
  const gameName = info.gameName ? singleLine(info.gameName) : "不明";

  return [
    "次のRaidに対して、Twitchチャットへ送る1通のRaid挨拶文を作ってください。",
    "この文はRaid元配信者の紹介文です。相手の配信内容をなるべく長めに、詳しく紹介してください。",
    `ユーザー名: ${info.userName}`,
    `ゲーム: ${gameName}`,
    `配信タイトル: ${title}`,
    `チャンネルURL: ${info.streamUrl}`,
    "ゲーム名と配信タイトルを必ず入れ、何をして遊んでいたかが分かるように歓迎、労い、見どころを自然につないでください。",
    "条件: 日本語、1通、事実だけ、500文字以内、チャンネルURLを必ず最後の方に入れる。",
    "500文字はTwitchチャットの文字数上限でありRaid人数ではありません。",
    "人数の多い少ないには触れないでください。",
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
  if (hasNegativeRaidSizePhrasing(normalized)) return null;

  const withoutDuplicateLead = removeLeadingUserName(normalized, userName);
  const withUser = ensureUserMention(withoutDuplicateLead, userName);
  const withUrl = ensureStreamUrl(withUser, info.streamUrl);
  const withStreamDetails = ensureStreamDetails(withUrl, info);
  return shortenRaidGreetingKeepingUrl(
    withStreamDetails,
    info.streamUrl,
    GENERATED_RAID_GREETING_LIMIT
  );
}

function notifyDecision(
  options: GenerateRaidGreetingMessageOptions,
  decision: Omit<RaidGreetingDecision, "userName">
): void {
  options.onDecision?.({
    userName: normalizeLoginName(options.info.userName),
    ...decision,
  });
}

export async function generateRaidGreetingMessage({
  info,
  enabled,
  baseUrl,
  model,
  timeoutMs,
  keepAlive,
  fetchImpl = fetch,
  onDecision,
}: GenerateRaidGreetingMessageOptions): Promise<string | null> {
  const options = {
    info,
    enabled,
    baseUrl,
    model,
    timeoutMs,
    keepAlive,
    fetchImpl,
    onDecision,
  };
  const startedAt = Date.now();
  const trimmedModel = model.trim();
  if (!enabled) {
    notifyDecision(options, { status: "fallback", reason: "disabled" });
    return null;
  }
  if (!trimmedModel) {
    notifyDecision(options, { status: "fallback", reason: "missing_model" });
    return null;
  }

  try {
    const response = await fetchImpl(buildOllamaGenerateUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: trimmedModel,
        system: RAID_GREETING_SYSTEM_PROMPT,
        prompt: buildRaidGreetingPrompt(info),
        stream: false,
        think: false,
        keep_alive: keepAlive,
        options: {
          temperature: DEFAULT_OLLAMA_TEMPERATURE,
          num_predict: DEFAULT_OLLAMA_NUM_PREDICT,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      notifyDecision(options, {
        status: "fallback",
        reason: "http_error",
        elapsedMs,
        detail: `HTTP ${response.status}`,
      });
      return null;
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    if (typeof body.response !== "string") {
      notifyDecision(options, {
        status: "fallback",
        reason: "invalid_response",
        elapsedMs,
      });
      return null;
    }

    const normalized = normalizeGeneratedGreeting(body.response);
    if (!normalized) {
      notifyDecision(options, {
        status: "fallback",
        reason: "empty_or_non_japanese",
        elapsedMs,
      });
      return null;
    }
    if (hasNegativeRaidSizePhrasing(normalized)) {
      notifyDecision(options, {
        status: "fallback",
        reason: "negative_raid_size",
        elapsedMs,
      });
      return null;
    }

    const message = formatGeneratedRaidGreetingMessage(info, normalized);
    if (!message) {
      notifyDecision(options, {
        status: "fallback",
        reason: "invalid_response",
        elapsedMs,
      });
      return null;
    }

    notifyDecision(options, {
      status: "generated",
      elapsedMs,
      detail: includesRequiredStreamDetails(normalized, info)
        ? undefined
        : "stream_details_repaired",
    });
    return message;
  } catch (error) {
    notifyDecision(options, {
      status: "fallback",
      reason: "request_failed",
      elapsedMs: Date.now() - startedAt,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
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
