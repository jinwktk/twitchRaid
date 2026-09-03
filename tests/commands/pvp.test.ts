import { describe, expect, it } from "vitest";
import {
  formatTodayAndTomorrowFrontlineRules,
  getFrontlineRuleAt,
} from "../../src/commands/pvp";

describe("Frontline daily rule", () => {
  it("starts the current rotation with Borderland Ruins on 2026-04-29 JST", () => {
    const rule = getFrontlineRuleAt(
      new Date("2026-04-28T15:00:00.000Z")
    );

    expect(rule.fullName).toBe("外縁遺跡群（制圧戦）");
  });

  it("changes to Onsal Hakair at the next JST midnight", () => {
    const beforeMidnight = getFrontlineRuleAt(
      new Date("2026-04-29T14:59:59.999Z")
    );
    const atMidnight = getFrontlineRuleAt(
      new Date("2026-04-29T15:00:00.000Z")
    );

    expect(beforeMidnight.fullName).toBe("外縁遺跡群（制圧戦）");
    expect(atMidnight.fullName).toBe("オンサル・ハカイル（終節戦）");
  });

  it.each([
    ["2026-04-30T15:00:00.000Z", "ウォーコー・チーテ（演習戦）"],
    ["2026-05-01T15:00:00.000Z", "シールロック（争奪戦）"],
    ["2026-05-02T15:00:00.000Z", "フィールド・オブ・グローリー（砕氷戦）"],
    ["2026-05-03T15:00:00.000Z", "オンサル・ハカイル（終節戦）"],
    ["2026-05-04T15:00:00.000Z", "ウォーコー・チーテ（演習戦）"],
    ["2026-05-05T15:00:00.000Z", "シールロック（争奪戦）"],
    ["2026-05-06T15:00:00.000Z", "外縁遺跡群（制圧戦）"],
  ])("follows the eight-day rotation at %s", (instant, expectedRule) => {
    expect(getFrontlineRuleAt(new Date(instant)).fullName).toBe(expectedRule);
  });

  it("formats a regular transition from today to tomorrow", () => {
    expect(
      formatTodayAndTomorrowFrontlineRules(
        new Date("2026-04-28T15:00:00.000Z")
      )
    ).toBe(
      "今日のフロントライン：外縁遺跡群（制圧戦） / 明日：オンサル・ハカイル（終節戦）"
    );
  });

  it("formats today's and tomorrow's rules for Twitch chat", () => {
    expect(
      formatTodayAndTomorrowFrontlineRules(
        new Date("2026-09-02T15:00:00.000Z")
      )
    ).toBe(
      "今日のフロントライン：シールロック（争奪戦） / 明日：外縁遺跡群（制圧戦）"
    );
  });
});
