import { describe, expect, it } from "vitest";
import {
  appendChatReplyEmote,
  normalizeChatReplyEmotes,
} from "../../src/chat/reply-emotes";

describe("chat reply emotes", () => {
  it("keeps replies unchanged when no emotes are configured", () => {
    expect(appendChatReplyEmote("こんにちはD！", [])).toBe("こんにちはD！");
  });

  it("normalizes configured Twitch emote names without lowercasing them", () => {
    expect(
      normalizeChatReplyEmotes(" rukkaHi, @rukkaGG, ＠rukkaHi, RukkaNice ")
    ).toEqual(["rukkaHi", "rukkaGG", "RukkaNice"]);
  });

  it("appends the first configured emote to the reply", () => {
    expect(appendChatReplyEmote("こんにちはD！", ["rukkaHi", "rukkaGG"])).toBe(
      "こんにちはD！ rukkaHi"
    );
  });

  it("does not append the same emote twice when it is already present", () => {
    expect(appendChatReplyEmote("こんにちはD！ rukkaHi", ["rukkaHi"])).toBe(
      "こんにちはD！ rukkaHi"
    );
  });

  it("keeps the final Twitch chat message within 500 characters", () => {
    const longReply = "あ".repeat(500);
    const result = appendChatReplyEmote(longReply, ["rukkaHi"]);

    expect(result.length).toBeLessThanOrEqual(500);
    expect(result.endsWith(" rukkaHi")).toBe(true);
  });

  it("keeps the suffix within the limit when no reply body can fit", () => {
    expect(appendChatReplyEmote("abcdef", ["abcd"], 5)).toBe(" abcd");
  });
});
