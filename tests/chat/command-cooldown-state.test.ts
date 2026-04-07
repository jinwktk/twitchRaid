import { describe, it, expect, beforeEach } from "vitest";
import { CommandCooldownState } from "../../src/chat/command-cooldown-state";

describe("CommandCooldownState", () => {
  let state: CommandCooldownState;
  const NOW = 1_700_000_000;

  beforeEach(() => {
    state = new CommandCooldownState();
  });

  describe("lastUsed", () => {
    it("returns null for an unused command", () => {
      expect(state.lastUsed("clip")).toBeNull();
    });

    it("returns the timestamp after markUsed", () => {
      state.markUsed("clip", NOW);
      expect(state.lastUsed("clip")).toBe(NOW);
    });
  });

  describe("remainingSeconds", () => {
    const COOLDOWN = 1800;

    it("returns 0 when command has never been used", () => {
      expect(state.remainingSeconds("clip", NOW, COOLDOWN)).toBe(0);
    });

    it("returns remaining time within cooldown window", () => {
      state.markUsed("clip", NOW);
      expect(state.remainingSeconds("clip", NOW + 600, COOLDOWN)).toBe(1200);
    });

    it("returns 0 exactly when cooldown elapsed", () => {
      state.markUsed("clip", NOW);
      expect(state.remainingSeconds("clip", NOW + COOLDOWN, COOLDOWN)).toBe(0);
    });

    it("returns 0 when cooldown has been exceeded", () => {
      state.markUsed("clip", NOW);
      expect(state.remainingSeconds("clip", NOW + COOLDOWN + 1, COOLDOWN)).toBe(0);
    });

    it("floors fractional remaining seconds", () => {
      state.markUsed("clip", NOW);
      expect(state.remainingSeconds("clip", NOW + 0.5, COOLDOWN)).toBe(1799);
    });
  });

  describe("multiple commands tracked independently", () => {
    it("clip and myclip have separate cooldown states", () => {
      state.markUsed("clip", NOW);
      expect(state.remainingSeconds("myclip", NOW + 100, 1800)).toBe(0);
      expect(state.remainingSeconds("clip", NOW + 100, 1800)).toBe(1700);
    });
  });

  describe("constructor initialTimes", () => {
    it("initializes with provided timestamps", () => {
      const s = new CommandCooldownState({
        clip: NOW,
        myclip: NOW - 500,
      });
      expect(s.lastUsed("clip")).toBe(NOW);
      expect(s.lastUsed("myclip")).toBe(NOW - 500);
    });
  });
});
