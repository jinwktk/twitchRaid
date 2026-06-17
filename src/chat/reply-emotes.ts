const TWITCH_CHAT_MESSAGE_LIMIT = 500;

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

function includesStandaloneEmote(message: string, emote: string): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(emote)}(?=$|\\s)`).test(message);
}

function trimReplyForSuffix(
  reply: string,
  suffix: string,
  maxChars: number
): string {
  const available = maxChars - suffix.length;
  if (available <= 0) return reply.slice(0, maxChars).trimEnd();
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
