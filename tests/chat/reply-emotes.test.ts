import { describe, expect, it } from "vitest";
import {
  appendContextualChatReplyEmote,
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

  it("uses a contextual GG emote when a known rukka emote enables the built-in set", () => {
    expect(
      appendContextualChatReplyEmote("GG！", ["rukkaNikoniko"], {
        source: "mention",
        promptText: "GG",
      })
    ).toBe("GG！ rukkaGg");
  });

  it("prioritizes uncertain or apologetic replies over upbeat prompt context", () => {
    expect(
      appendContextualChatReplyEmote(
        "ごめん、検索結果がなくて分からないD！",
        ["rukkaNikoniko"],
        {
          source: "mention",
          promptText: "GGだった？",
        }
      )
    ).toBe("ごめん、検索結果がなくて分からないD！ rukkaShobobo");
  });

  it("keeps an upbeat fallback for informative replies", () => {
    expect(
      appendContextualChatReplyEmote(
        "TwitchConは配信者向けイベントだよD！",
        ["rukkaNikoniko"],
        {
          source: "mention",
          promptText: "TwitchConの日程教えて",
        }
      )
    ).toBe("TwitchConは配信者向けイベントだよD！ rukkaNikoniko");
  });

  it("uses a raid emote for raid greetings from the built-in rukka set", () => {
    expect(
      appendContextualChatReplyEmote("レイドありがとうD！", ["rukkaNikoniko"], {
        source: "raid",
      })
    ).toBe("レイドありがとうD！ rukkaNiceraido");
  });

  it("keeps legacy first-emote behavior for unknown configured emotes", () => {
    expect(
      appendContextualChatReplyEmote("GG！", ["rukkaHi"], {
        source: "mention",
        promptText: "GG",
      })
    ).toBe("GG！ rukkaHi");
  });
});
