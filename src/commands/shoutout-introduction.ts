import type { RaidSourceInfo } from "./raid-info";

export interface GenerateShoutoutIntroductionOptions {
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

const TWITCH_CHAT_MESSAGE_LIMIT = 500;
const INTRO_BODY_LIMIT = 220;
const DEFAULT_OLLAMA_TEMPERATURE = 0.8;
const DEFAULT_OLLAMA_NUM_PREDICT = 80;

const SHOUTOUT_INTRO_SYSTEM_PROMPT = [
  "あなたはTwitch配信者を短く楽しく紹介する日本語アシスタントです。",
  "Output Japanese only. Do not answer in English or Chinese.",
  "必ず日本語だけで返答し、ひらがなかカタカナを含めてください。",
  "与えられた情報だけを使い、知らない内容は作らないでください。",
  "返答は1文だけ。説明、URL、ハッシュタグ、引用符、前置き、箇条書きは禁止です。",
  "語尾は少し明るく、必要なら「D！」を使ってください。",
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

function stripWrappingQuotes(value: string): string {
  return value.replace(/^[`"'「『]+/, "").replace(/[`"'」』]+$/, "").trim();
}

function includesJapaneseKana(value: string): boolean {
  return /[\u3040-\u30ff]/.test(value);
}

function normalizeGeneratedIntro(value: string): string | null {
  const normalized = stripWrappingQuotes(singleLine(value));
  if (!normalized) return null;
  if (!includesJapaneseKana(normalized)) return null;
  return shorten(normalized, INTRO_BODY_LIMIT);
}

function removeLeadingUserName(value: string, userName: string): string {
  const escapedUserName = userName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(
      new RegExp(`^@?${escapedUserName}\\s*(?:さん|氏)?\\s*(?:の|は|:|：|、)?\\s*`, "i"),
      ""
    )
    .trim();
}

function buildOllamaGenerateUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/generate`;
}

function buildShoutoutIntroductionPrompt(
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
    "次のTwitch配信者を、配信に遊びに来た人へ紹介する短い文章を作ってください。",
    `ユーザー名: ${info.userName}`,
    `ゲーム: ${gameName}`,
    `配信タイトル: ${title}`,
    `Raid人数: ${viewers}`,
    "条件: 80文字以内、日本語、1文、事実だけ、チャンネルURLは書かない。",
    "最終的な紹介文だけを返してください。説明は不要です。",
  ].join("\n");
}

export async function generateShoutoutIntroduction({
  info,
  viewerCount,
  enabled,
  baseUrl,
  model,
  timeoutMs,
  keepAlive,
  fetchImpl = fetch,
}: GenerateShoutoutIntroductionOptions): Promise<string | null> {
  const trimmedModel = model.trim();
  if (!enabled || !trimmedModel) return null;

  try {
    const response = await fetchImpl(buildOllamaGenerateUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: trimmedModel,
        system: SHOUTOUT_INTRO_SYSTEM_PROMPT,
        prompt: buildShoutoutIntroductionPrompt(info, viewerCount),
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
    return normalizeGeneratedIntro(body.response);
  } catch {
    return null;
  }
}

export function formatShoutoutIntroductionMessage(
  info: RaidSourceInfo,
  intro: string
): string {
  const userName = normalizeLoginName(info.userName);
  const body =
    normalizeGeneratedIntro(removeLeadingUserName(intro, userName)) ??
    "遊びに行ってみてD！";
  return shorten(
    `@${userName} さん紹介D！${body}`,
    TWITCH_CHAT_MESSAGE_LIMIT
  );
}
