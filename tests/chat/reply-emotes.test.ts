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
        availableEmotes: [{ id: "1", name: "rukkaGg", emoteType: "follower" }],
      })
    ).toBe("GG！ rukkaGg");
  });

  it("prioritizes uncertain or apologetic replies over upbeat prompt context", () => {
    expect(
      appendContextualChatReplyEmote(
        "検索では確認できなかったD！",
        ["rukkaNikoniko"],
        {
          source: "mention",
          promptText: "GGだった？",
          availableEmotes: [
            { id: "2", name: "rukkaShobobo", emoteType: "subscriptions" },
          ],
        }
      )
    ).toBe("検索では確認できなかったD！ rukkaShobobo");
  });

  it("keeps an upbeat fallback for informative replies", () => {
    expect(
      appendContextualChatReplyEmote(
        "TwitchConは配信者向けイベントだよD！",
        ["rukkaNikoniko"],
        {
          source: "mention",
          promptText: "TwitchConの日程教えて",
          availableEmotes: [
            { id: "3", name: "rukkaNikoniko", emoteType: "follower" },
          ],
        }
      )
    ).toBe("TwitchConは配信者向けイベントだよD！ rukkaNikoniko");
  });

  it("uses a raid emote for raid greetings from the built-in rukka set", () => {
    expect(
      appendContextualChatReplyEmote("レイドありがとうD！", ["rukkaNikoniko"], {
        source: "raid",
        availableEmotes: [
          { id: "4", name: "rukkaNiceraido", emoteType: "subscriptions" },
        ],
      })
    ).toBe("レイドありがとうD！ rukkaNiceraido");
  });

  it("can defer contextual trimming when the caller owns final trimming", () => {
    const longReply = "レイドありがとうD！" + "あ".repeat(500);
    const result = appendContextualChatReplyEmote(longReply, ["rukkaNikoniko"], {
      source: "raid",
      deferTrimming: true,
      availableEmotes: [
        { id: "4", name: "rukkaNiceraido", emoteType: "subscriptions" },
      ],
    });

    expect(result.length).toBeGreaterThan(500);
    expect(result.endsWith(" rukkaNiceraido")).toBe(true);
  });

  it("uses an available configured emote as the informative fallback", () => {
    expect(
      appendContextualChatReplyEmote("GG！", ["rukkaHi"], {
        source: "mention",
        promptText: "GG",
        availableEmotes: [{ id: "5", name: "rukkaHi", emoteType: "follower" }],
      })
    ).toBe("GG！ rukkaHi");
  });

  it("filters expanded built-in candidates by exact case-sensitive availability", () => {
    expect(
      appendContextualChatReplyEmote("GG！", ["rukkaNikoniko"], {
        source: "mention",
        promptText: "GG",
        availableEmotes: [
          { id: "6", name: "rukkaGG", emoteType: "follower" },
          { id: "7", name: "rukkaNikoniko", emoteType: "follower" },
        ],
      })
    ).toBe("GG！ rukkaNikoniko");
  });

  it("uses Unicode fallbacks instead of unavailable Twitch emote codes", () => {
    expect(
      appendContextualChatReplyEmote("検索では確認できなかったD！", ["rukkaNikoniko"], {
        source: "mention",
        availableEmotes: [],
      })
    ).toBe("検索では確認できなかったD！ 😔");

    expect(
      appendContextualChatReplyEmote("レイドありがとうD！", ["rukkaNikoniko"], {
        source: "raid",
        availableEmotes: [],
      })
    ).toBe("レイドありがとうD！ 🎉");
  });

  it("does not pick an unrelated available built-in emote as a generic fallback", () => {
    expect(
      appendContextualChatReplyEmote("今日は配信日だよD！", ["rukkaNikoniko"], {
        source: "mention",
        availableEmotes: [
          { id: "8", name: "rukkaOhanyo", emoteType: "follower" },
        ],
      })
    ).toBe("今日は配信日だよD！ 😊");
  });

  it("does not add a Unicode fallback when emotes are not configured", () => {
    expect(
      appendContextualChatReplyEmote("今日は配信日だよD！", [], {
        source: "mention",
        availableEmotes: [],
      })
    ).toBe("今日は配信日だよD！");
  });
});
