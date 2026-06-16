import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractMentionChatMemoryEntry,
  loadMentionChatMemory,
  saveMentionChatAutoLearnMemory,
} from "../../src/commands/mention-chat-memory";

let tempDir: string | null = null;

function createTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitch-raid-memory-"));
  return tempDir;
}

function writeMemoryFile(value: unknown): string {
  const dir = createTempDir();
  const filePath = path.join(dir, "chat-ai-memory.json");
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("loadMentionChatMemory", () => {
  it("returns empty memory when disabled", () => {
    const result = loadMentionChatMemory({
      enabled: false,
      filePath: "missing.json",
      maxItems: 8,
      maxChars: 600,
    });

    expect(result).toEqual({ text: null, itemCount: 0, charCount: 0 });
  });

  it("returns empty memory when the file is missing or invalid", () => {
    const missing = loadMentionChatMemory({
      enabled: true,
      filePath: path.join(createTempDir(), "missing.json"),
      maxItems: 8,
      maxChars: 600,
    });

    fs.writeFileSync(path.join(tempDir!, "broken.json"), "{", "utf8");
    const invalid = loadMentionChatMemory({
      enabled: true,
      filePath: path.join(tempDir!, "broken.json"),
      maxItems: 8,
      maxChars: 600,
    });

    expect(missing).toEqual({ text: null, itemCount: 0, charCount: 0 });
    expect(invalid).toEqual({ text: null, itemCount: 0, charCount: 0 });
  });

  it("loads a shared dictionary and ignores user-specific memory", () => {
    const filePath = writeMemoryFile({
      "bot-tone": "語尾はDを自然に使う",
      "るっかるん": "悪く言わない",
      "呼び方": { value: "にめいやボットくん" },
      users: {
        viewer: [{ key: "好物", value: "カレー" }],
      },
    });

    const result = loadMentionChatMemory({
      enabled: true,
      filePath,
      maxItems: 8,
      maxChars: 600,
    });

    const expectedText = [
      "bot-tone: 語尾はDを自然に使う",
      "るっかるん: 悪く言わない",
      "呼び方: にめいやボットくん",
    ].join("\n");
    expect(result).toEqual({
      text: expectedText,
      itemCount: 3,
      charCount: expectedText.length,
    });
    expect(result.text).not.toContain("カレー");
  });

  it("keeps loading the legacy global list as shared memory", () => {
    const filePath = writeMemoryFile({
      global: [
        { key: "bot-tone", value: "語尾はDを自然に使う" },
        "るっかるんを悪く言わない",
      ],
    });

    const result = loadMentionChatMemory({
      enabled: true,
      filePath,
      maxItems: 8,
      maxChars: 600,
    });

    expect(result.text).toBe(
      ["bot-tone: 語尾はDを自然に使う", "るっかるんを悪く言わない"].join("\n")
    );
    expect(result.itemCount).toBe(2);
  });

  it("caps memory by item count and character count", () => {
    const filePath = writeMemoryFile({
      global: [
        { key: "one", value: "1234567890" },
        { key: "two", value: "1234567890" },
        { key: "three", value: "1234567890" },
      ],
    });

    const result = loadMentionChatMemory({
      enabled: true,
      filePath,
      maxItems: 2,
      maxChars: 24,
    });

    expect(result.itemCount).toBe(2);
    expect(result.text?.split("\n")).toHaveLength(2);
    expect(result.text!.length).toBeLessThanOrEqual(24);
    expect(result.text).not.toContain("three");
  });
});

describe("auto-learn mention chat memory", () => {
  it("extracts explicit key-value memory requests", () => {
    const options = { maxKeyChars: 40, maxValueChars: 120 };

    expect(extractMentionChatMemoryEntry("覚えて: 口調=短くD", options)).toEqual({
      key: "口調",
      value: "短くD",
    });
    expect(extractMentionChatMemoryEntry("メモして 呼び方: にめいや", options)).toEqual({
      key: "呼び方",
      value: "にめいや",
    });
    expect(extractMentionChatMemoryEntry("忘れないで 好物はカレー", options)).toEqual({
      key: "好物",
      value: "カレー",
    });
  });

  it("rejects unsafe, reserved, or oversized memory entries", () => {
    const options = { maxKeyChars: 4, maxValueChars: 8 };

    expect(extractMentionChatMemoryEntry("覚えて: global=全部", options)).toBeNull();
    expect(extractMentionChatMemoryEntry("覚えて: users=viewer", options)).toBeNull();
    expect(extractMentionChatMemoryEntry("覚えて: URL=https://example.test", options)).toBeNull();
    expect(extractMentionChatMemoryEntry("覚えて: token=abc123", options)).toBeNull();
    expect(extractMentionChatMemoryEntry("覚えて: API_KEY=abc123", options)).toBeNull();
    expect(extractMentionChatMemoryEntry("覚えて: 長すぎるキー=値", options)).toBeNull();
    expect(
      extractMentionChatMemoryEntry("覚えて: key=長すぎる値ですです", options)
    ).toBeNull();
  });

  it("saves learned memory atomically and updates existing keys", () => {
    const filePath = writeMemoryFile({
      口調: "古い",
      global: [{ key: "legacy", value: "残す" }],
    });

    const result = saveMentionChatAutoLearnMemory({
      enabled: true,
      filePath,
      promptText: "覚えて: 口調=短くD",
      maxKeyChars: 40,
      maxValueChars: 120,
      maxItems: 50,
    });

    expect(result).toEqual({ saved: true, reason: "saved", key: "口調" });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      口調: "短くD",
      global: [{ key: "legacy", value: "残す" }],
    });
  });

  it("creates the parent directory and caps old non-reserved keys", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "nested", "chat-ai-memory.json");

    saveMentionChatAutoLearnMemory({
      enabled: true,
      filePath,
      promptText: "覚えて: one=1",
      maxKeyChars: 40,
      maxValueChars: 120,
      maxItems: 1,
    });
    saveMentionChatAutoLearnMemory({
      enabled: true,
      filePath,
      promptText: "覚えて: two=2",
      maxKeyChars: 40,
      maxValueChars: 120,
      maxItems: 1,
    });

    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ two: "2" });
  });

  it("keeps the existing file when rename fails", () => {
    const filePath = writeMemoryFile({ 口調: "古い" });
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("rename failed");
    });

    const result = saveMentionChatAutoLearnMemory({
      enabled: true,
      filePath,
      promptText: "覚えて: 口調=短くD",
      maxKeyChars: 40,
      maxValueChars: 120,
      maxItems: 50,
    });

    expect(result.saved).toBe(false);
    expect(result.reason).toBe("write_failed");
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({
      口調: "古い",
    });
    renameSpy.mockRestore();
  });
});
