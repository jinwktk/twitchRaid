import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClipHistoryStore } from "../../src/commands/clip-history";

describe("ClipHistoryStore", () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clip-history-"));
    historyPath = path.join(tmpDir, "clip_history.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores recent clip ids newest first without duplicates", () => {
    const store = new ClipHistoryStore(historyPath, 3);

    store.record("clip", "a");
    store.record("clip", "b");
    store.record("clip", "a");

    expect(store.getRecentIds("clip")).toEqual(["a", "b"]);
  });

  it("limits each history bucket independently", () => {
    const store = new ClipHistoryStore(historyPath, 2);

    store.record("clip", "a");
    store.record("clip", "b");
    store.record("clip", "c");
    store.record("myclip:viewer", "mine");

    expect(store.getRecentIds("clip")).toEqual(["c", "b"]);
    expect(store.getRecentIds("myclip:viewer")).toEqual(["mine"]);
  });
});
