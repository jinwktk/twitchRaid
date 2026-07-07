import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBotRequestNotesDigest,
  extractBotRequestNote,
  listBotRequestNotesStore,
  markBotRequestNotesDigestSent,
  saveBotRequestNoteObservationStore,
  updateBotRequestNoteStore,
  writeBotRequestNotesDigestFile,
} from "../../src/commands/bot-request-notes";

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-request-notes-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    tempDir = null;
  }
});

describe("bot request note extraction", () => {
  it("extracts only bot improvement requests", () => {
    expect(
      extractBotRequestNote("Botでおみくじ履歴を見られるようにしてほしい", {
        sourceUser: "viewer",
      })
    ).toMatchObject({
      category: "feature",
      summary: "Botでおみくじ履歴を見られるようにしてほしい",
      evidence: "Botでおみくじ履歴を見られるようにしてほしい",
      sourceUser: "viewer",
    });

    expect(
      extractBotRequestNote("clipコマンドが使えないから直してほしい", {
        sourceUser: "viewer",
      })
    ).toMatchObject({
      category: "bug",
      summary: "clipコマンドが使えないから直してほしい",
    });

    expect(
      extractBotRequestNote("!lurk コマンド追加してほしい", {
        sourceUser: "viewer",
      })
    ).toMatchObject({
      category: "command",
      summary: "!lurk コマンド追加してほしい",
    });
  });

  it("rejects chat, search, memory, question, and unsafe text", () => {
    const options = { sourceUser: "viewer" };

    expect(extractBotRequestNote("今日は暑いね", options)).toBeNull();
    expect(extractBotRequestNote("レゲエパンチについて調べて", options)).toBeNull();
    expect(extractBotRequestNote("覚えて: 好物=カレー", options)).toBeNull();
    expect(extractBotRequestNote("るか吉は何パーセント？", options)).toBeNull();
    expect(
      extractBotRequestNote("Botで https://example.test を開けるようにしてほしい", options)
    ).toBeNull();
    expect(
      extractBotRequestNote("BotにAPI_KEY=sk-proj-secretを保存してほしい", options)
    ).toBeNull();
  });
});

describe("bot request note store", () => {
  it("stores, deduplicates, lists, and updates request notes", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "bot-request-notes.sqlite");
    const entry = extractBotRequestNote(
      "Botでおみくじ履歴を見られるようにしてほしい",
      { sourceUser: "viewer" }
    );
    expect(entry).not.toBeNull();

    const first = saveBotRequestNoteObservationStore({
      enabled: true,
      dbPath,
      entry: entry!,
      now: () => "2026-07-05T00:00:00.000Z",
    });
    expect(first).toMatchObject({
      saved: true,
      reason: "saved",
      note: {
        id: 1,
        status: "pending",
        observedCount: 1,
        sourceUser: "viewer",
      },
    });

    const second = saveBotRequestNoteObservationStore({
      enabled: true,
      dbPath,
      entry: { ...entry!, sourceUser: "other_viewer" },
      now: () => "2026-07-05T01:00:00.000Z",
    });
    expect(second).toMatchObject({
      saved: true,
      reason: "updated",
      note: {
        id: 1,
        status: "pending",
        observedCount: 2,
        lastObservedAt: "2026-07-05T01:00:00.000Z",
      },
    });

    const pending = listBotRequestNotesStore({
      dbPath,
      status: "pending",
      queryText: "おみくじ",
    });
    expect(pending).toMatchObject({
      totalCount: 1,
      openCount: 1,
      entries: [
        {
          id: 1,
          category: "feature",
          status: "pending",
          observedCount: 2,
          summary: "Botでおみくじ履歴を見られるようにしてほしい",
        },
      ],
    });

    const updated = updateBotRequestNoteStore({
      dbPath,
      id: 1,
      status: "done",
      operatorNote: "実装済み",
      now: () => "2026-07-05T02:00:00.000Z",
    });
    expect(updated).toMatchObject({
      updated: true,
      note: {
        id: 1,
        status: "done",
        operatorNote: "実装済み",
        resolvedAt: "2026-07-05T02:00:00.000Z",
      },
    });
    expect(listBotRequestNotesStore({ dbPath, status: "open" }).openCount).toBe(0);
  });

  it("builds a weekly digest and retries until a successful send is marked", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "bot-request-notes.sqlite");
    const entry = extractBotRequestNote("BotでRaid挨拶を再生成できるようにしてほしい", {
      sourceUser: "viewer",
    });
    expect(entry).not.toBeNull();
    saveBotRequestNoteObservationStore({
      enabled: true,
      dbPath,
      entry: entry!,
      now: () => "2026-07-05T00:00:00.000Z",
    });

    const first = buildBotRequestNotesDigest({
      enabled: true,
      dbPath,
      intervalHours: 168,
      maxItems: 10,
      now: () => "2026-07-05T03:00:00.000Z",
    });
    expect(first).toMatchObject({
      shouldSend: true,
      reason: "ready",
      itemCount: 1,
    });
    expect(first.message).toContain("Bot要望メモ未対応");
    expect(first.message).toContain("Raid挨拶");

    const retryBeforeMark = buildBotRequestNotesDigest({
      enabled: true,
      dbPath,
      intervalHours: 168,
      maxItems: 10,
      now: () => "2026-07-05T03:01:00.000Z",
    });
    expect(retryBeforeMark.shouldSend).toBe(true);

    markBotRequestNotesDigestSent({
      dbPath,
      sentAt: "2026-07-05T03:01:00.000Z",
    });

    const afterMark = buildBotRequestNotesDigest({
      enabled: true,
      dbPath,
      intervalHours: 168,
      maxItems: 10,
      now: () => "2026-07-06T03:01:00.000Z",
    });
    expect(afterMark).toMatchObject({
      shouldSend: false,
      reason: "interval",
    });
  });

  it("writes unresolved request notes to a recovery markdown file", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "bot-request-notes.sqlite");
    const filePath = path.join(dir, "digests", "bot-request-notes-digest.md");
    const entry = extractBotRequestNote(
      "BotでRaid挨拶を再生成できるようにしてほしい",
      { sourceUser: "viewer" }
    );
    expect(entry).not.toBeNull();
    saveBotRequestNoteObservationStore({
      enabled: true,
      dbPath,
      entry: entry!,
      now: () => "2026-07-05T00:00:00.000Z",
    });

    const digest = buildBotRequestNotesDigest({
      enabled: true,
      dbPath,
      intervalHours: 168,
      maxItems: 10,
      now: () => "2026-07-05T03:00:00.000Z",
    });

    const written = writeBotRequestNotesDigestFile({
      filePath,
      generatedAt: "2026-07-05T03:00:00.000Z",
      entries: digest.entries,
    });

    expect(written).toMatchObject({ written: true, reason: "written" });
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("# Bot要望メモ未対応");
    expect(content).toContain("generatedAt: 2026-07-05T03:00:00.000Z");
    expect(content).toContain("BotでRaid挨拶を再生成できるようにしてほしい");
    expect(content).toContain("対応後は");
  });
});
