import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMentionChatMemory } from "../../src/commands/mention-chat-memory";

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
      userName: "viewer",
      maxItems: 8,
      maxChars: 600,
    });

    expect(result).toEqual({ text: null, itemCount: 0, charCount: 0 });
  });

  it("returns empty memory when the file is missing or invalid", () => {
    const missing = loadMentionChatMemory({
      enabled: true,
      filePath: path.join(createTempDir(), "missing.json"),
      userName: "viewer",
      maxItems: 8,
      maxChars: 600,
    });

    fs.writeFileSync(path.join(tempDir!, "broken.json"), "{", "utf8");
    const invalid = loadMentionChatMemory({
      enabled: true,
      filePath: path.join(tempDir!, "broken.json"),
      userName: "viewer",
      maxItems: 8,
      maxChars: 600,
    });

    expect(missing).toEqual({ text: null, itemCount: 0, charCount: 0 });
    expect(invalid).toEqual({ text: null, itemCount: 0, charCount: 0 });
  });

  it("loads global and user-specific memory for the normalized user name", () => {
    const filePath = writeMemoryFile({
      global: [
        { key: "bot-tone", value: "語尾はDを自然に使う" },
        "るっかるんを悪く言わない",
      ],
      users: {
        nyme_ia: [{ key: "呼び方", value: "にめいやさん" }],
        other: [{ key: "好物", value: "カレー" }],
      },
    });

    const result = loadMentionChatMemory({
      enabled: true,
      filePath,
      userName: "@Nyme_IA",
      maxItems: 8,
      maxChars: 600,
    });

    expect(result).toEqual({
      text: [
        "bot-tone: 語尾はDを自然に使う",
        "るっかるんを悪く言わない",
        "呼び方: にめいやさん",
      ].join("\n"),
      itemCount: 3,
      charCount: 45,
    });
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
      userName: "viewer",
      maxItems: 2,
      maxChars: 24,
    });

    expect(result.itemCount).toBe(2);
    expect(result.text?.split("\n")).toHaveLength(2);
    expect(result.text!.length).toBeLessThanOrEqual(24);
    expect(result.text).not.toContain("three");
  });
});
