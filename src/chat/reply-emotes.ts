const TWITCH_CHAT_MESSAGE_LIMIT = 500;

export type ChatReplyEmoteSource = "mention" | "raid";

export interface ChatReplyEmoteContext {
  source: ChatReplyEmoteSource;
  promptText?: string;
  maxChars?: number;
  deferTrimming?: boolean;
}

const BUILT_IN_RUKKA_EMOTES = [
  "rukkaNikoniko",
  "rukkaNiceraido",
  "rukkaGg",
  "rukkaMvp",
  "rukkaPatipati",
  "rukkaGanbareee",
  "rukkaOuen",
  "rukkaTasukaru",
  "rukkaKonchaa",
  "rukkaOhanyo",
  "rukkaKitayooo",
  "rukkaMogumogu",
  "rukkaNondekooo",
  "rukkaNpai",
  "rukkaUnitabetaiii",
  "rukkaOyasumi",
  "rukkaOyanmi",
  "rukkaKanasii",
  "rukkaShobobo",
  "rukkaPoroporo",
  "rukkaPunpun",
  "rukkaMagao",
  "rukkaNanikodeeeee",
  "rukkaSukisuki",
  "rukkaLovelove",
  "rukkaMeromero",
  "rukkaDoya",
  "rukkaNimanima",
  "rukkaDance",
  "rukkaOkanekaese",
] as const;

const CONTEXTUAL_RUKKA_EMOTES = new Set<string>(BUILT_IN_RUKKA_EMOTES);

const CONTEXTUAL_EMOTE_CATEGORIES = [
  {
    pattern: /(?:gg|GG|ＧＧ|ないす|ナイス|勝ち|勝った|おめ|MVP|mvp|すご|えら|拍手|できてる|できた)/u,
    emotes: ["rukkaGg", "rukkaMvp", "rukkaPatipati", "rukkaDoya"],
  },
  {
    pattern: /(?:おは|おはよ|こんにちは|こんちゃ|こんち|来た|きた|いらっしゃ|やほ)/u,
    emotes: ["rukkaOhanyo", "rukkaKonchaa", "rukkaKitayooo"],
  },
  {
    pattern: /(?:がんば|頑張|応援|ファイト|いける|いけそう|大丈夫|助か|たすか)/u,
    emotes: ["rukkaGanbareee", "rukkaOuen", "rukkaTasukaru"],
  },
  {
    pattern: /(?:ごはん|ご飯|飯|食|もぐ|お腹|腹|うま|おいし|飲|乾杯|カレー|ラーメン)/u,
    emotes: ["rukkaMogumogu", "rukkaNondekooo", "rukkaNpai", "rukkaUnitabetaiii"],
  },
  {
    pattern: /(?:おやす|寝|眠|ねむ|おつかれ|お疲れ)/u,
    emotes: ["rukkaOyasumi", "rukkaOyanmi"],
  },
  {
    pattern: /(?:悲し|かなしい|ごめ|すま|泣|つら|しょぼ|残念|負け)/u,
    emotes: ["rukkaKanasii", "rukkaShobobo", "rukkaPoroporo"],
  },
  {
    pattern: /(?:なんで|なにこれ|何これ|怒|ぷん|だめ|ダメ|やば|疑|許せ)/u,
    emotes: ["rukkaPunpun", "rukkaMagao", "rukkaNanikodeeeee"],
  },
  {
    pattern: /(?:好き|すき|かわい|可愛|愛|ラブ|推し)/u,
    emotes: ["rukkaSukisuki", "rukkaLovelove", "rukkaMeromero"],
  },
  {
    pattern: /(?:笑|草|いいね|楽しい|たのし|うれし|嬉し|最高|にこ)/u,
    emotes: ["rukkaNikoniko", "rukkaNimanima", "rukkaDance"],
  },
  {
    pattern: /(?:お金|金|返金|課金|高い)/u,
    emotes: ["rukkaOkanekaese"],
  },
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEmoteToken(value: string): string {
  return value.trim().replace(/^[@＠]+/, "").trim();
}

function isUsableEmoteToken(value: string): boolean {
  return value.length > 0 && !/\s/.test(value);
}

export function normalizeChatReplyEmotes(
  raw: string | readonly string[] | undefined
): string[] {
  const values =
    typeof raw === "string" ? raw.split(",") : Array.from(raw ?? []);
  const normalized = values
    .map(normalizeEmoteToken)
    .filter(isUsableEmoteToken);
  return [...new Set(normalized)];
}

function resolveContextualEmotes(emotes: readonly string[] | undefined): string[] {
  const normalizedEmotes = normalizeChatReplyEmotes(emotes);
  if (!normalizedEmotes.some((emote) => CONTEXTUAL_RUKKA_EMOTES.has(emote))) {
    return normalizedEmotes;
  }

  return [...new Set([...normalizedEmotes, ...BUILT_IN_RUKKA_EMOTES])];
}

function includesStandaloneEmote(message: string, emote: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(emote)}(?=$|\\s)`).test(message);
}

function trimReplyForSuffix(
  reply: string,
  suffix: string,
  maxChars: number
): string {
  const available = maxChars - suffix.length;
  if (available <= 0) return "";
  if (reply.length <= available) return reply;

  const ellipsis = "...";
  const bodyLength = Math.max(0, available - ellipsis.length);
  return `${reply.slice(0, bodyLength).trimEnd()}${ellipsis}`;
}

export function appendChatReplyEmote(
  reply: string,
  emotes: readonly string[] | undefined,
  maxChars = TWITCH_CHAT_MESSAGE_LIMIT
): string {
  const normalizedEmotes = normalizeChatReplyEmotes(emotes);
  const emote = normalizedEmotes[0];
  if (!emote) return reply;
  if (includesStandaloneEmote(reply, emote)) return reply;

  const suffix = ` ${emote}`;
  if (suffix.length > maxChars) return reply;

  const trimmedReply = trimReplyForSuffix(reply, suffix, maxChars);
  return `${trimmedReply}${suffix}`;
}

function selectFirstAvailable(
  candidates: readonly string[],
  availableEmotes: ReadonlySet<string>
): string | null {
  return candidates.find((emote) => availableEmotes.has(emote)) ?? null;
}

function selectContextualEmote(
  reply: string,
  emotes: readonly string[],
  context: ChatReplyEmoteContext
): string | null {
  const availableEmotes = new Set(emotes);
  if (context.source === "raid") {
    const raidEmote = selectFirstAvailable(["rukkaNiceraido"], availableEmotes);
    if (raidEmote) return raidEmote;
  }

  const uncertainReplyEmote = selectUncertainReplyEmote(reply, availableEmotes);
  if (uncertainReplyEmote) return uncertainReplyEmote;

  const text = `${context.promptText ?? ""} ${reply}`;
  for (const category of CONTEXTUAL_EMOTE_CATEGORIES) {
    if (!category.pattern.test(text)) continue;
    const emote = selectFirstAvailable(category.emotes, availableEmotes);
    if (emote) return emote;
  }

  return (
    selectFirstAvailable(["rukkaNikoniko"], availableEmotes) ??
    emotes[0] ??
    null
  );
}

function selectUncertainReplyEmote(
  reply: string,
  availableEmotes: ReadonlySet<string>
): string | null {
  if (
    !/(?:ごめん|すま|申し訳|わからな|分からな|知らな|不明|検索結果(?:が)?(?:なく|なし)|結果(?:が)?(?:なく|なし)|見つから|確認でき|断定でき|情報(?:が)?(?:足り|ない)|答えられ|できない)/u.test(
      reply
    )
  ) {
    return null;
  }

  return selectFirstAvailable(
    ["rukkaShobobo", "rukkaKanasii", "rukkaPoroporo", "rukkaMagao"],
    availableEmotes
  );
}

export function appendContextualChatReplyEmote(
  reply: string,
  emotes: readonly string[] | undefined,
  context: ChatReplyEmoteContext
): string {
  const contextualEmotes = resolveContextualEmotes(emotes);
  const emote = selectContextualEmote(reply, contextualEmotes, context);
  if (!emote) return reply;
  if (includesStandaloneEmote(reply, emote)) return reply;

  const maxChars = context.maxChars ?? TWITCH_CHAT_MESSAGE_LIMIT;
  const suffix = ` ${emote}`;
  if (suffix.length > maxChars) return reply;

  const trimmedReply = context.deferTrimming
    ? reply
    : trimReplyForSuffix(reply, suffix, maxChars);
  return `${trimmedReply}${suffix}`;
}
