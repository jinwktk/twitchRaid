import { describe, expect, it, vi } from "vitest";
import { randomGame } from "../../src/commands/random-commands";

describe("random game command", () => {
  it("formats the first game candidate", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    try {
      expect(randomGame()).toBe("次に遊ぶゲーム候補：Minecraft");
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("keeps the selected game inside the candidate list at the upper boundary", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);

    try {
      expect(randomGame()).toBe("次に遊ぶゲーム候補：Outer Wilds");
    } finally {
      randomSpy.mockRestore();
    }
  });
});
