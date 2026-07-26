import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildMemoryRequestFromUrl,
  createMemoryReader,
  parseArgs,
  renderMemoryHtml,
} from "../../scripts/anythingllm-memory-web.mjs";

const dirs: string[] = [];

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "memory-web-"));
  dirs.push(dir);
  const ledgerPath = path.join(dir, "ledger.sqlite");
  const knowledgePath = path.join(dir, "knowledge.sqlite");
  const ledger = new DatabaseSync(ledgerPath);
  ledger.exec(`
    CREATE TABLE anythingllm_comment_events (
      accepted_sequence INTEGER PRIMARY KEY, event_id TEXT, batch_id TEXT,
      channel TEXT, stream_id TEXT, user_login TEXT, user_display_name TEXT,
      occurred_at TEXT, body TEXT, accepted_at TEXT, body_purged_at TEXT
    );
    CREATE TABLE anythingllm_ingestion_batches (
      batch_id TEXT PRIMARY KEY, status TEXT, event_count INTEGER,
      retry_count INTEGER, last_failure_reason TEXT, next_attempt_at TEXT,
      cleanup_status TEXT, updated_at TEXT
    );
    INSERT INTO anythingllm_comment_events VALUES
      (2, 'e2', 'b1', 'rukalun', 's1', 'bob', 'Bob', '2026-07-26T02:00:00Z', '釣りが好き', '2026-07-26T02:00:01Z', NULL),
      (1, 'e1', 'b1', 'rukalun', 's1', 'alice', 'Alice', '2026-07-26T01:00:00Z', 'こんにちは', '2026-07-26T01:00:01Z', NULL);
    INSERT INTO anythingllm_ingestion_batches VALUES
      ('b1', 'embedded', 2, 0, NULL, NULL, 'retained', '2026-07-26T02:01:00Z'),
      ('b2', 'uploaded', 1, 0, NULL, NULL, 'retained', '2026-07-26T02:02:00Z');
  `);
  ledger.close();
  const knowledge = new DatabaseSync(knowledgePath);
  knowledge.exec(`
    CREATE TABLE anythingllm_stream_knowledge_jobs (
      stream_id TEXT PRIMARY KEY, channel TEXT, title TEXT, game_name TEXT,
      started_at TEXT, ended_at TEXT, status TEXT, final_summary TEXT,
      final_facts_json TEXT, fact_count INTEGER, summary_embedded INTEGER,
      facts_embedded INTEGER, last_failure_reason TEXT, updated_at TEXT,
      completed_at TEXT
    );
    INSERT INTO anythingllm_stream_knowledge_jobs VALUES
      ('s1', 'rukalun', '雑談', 'Just Chatting', '2026-07-26T01:00:00Z',
       '2026-07-26T03:00:00Z', 'complete', '釣りの話をした。',
       '[{"subject":"Bob","key":"趣味","value":"釣り","sourceEventIds":["e2"]}]',
       1, 1, 1, NULL, '2026-07-26T03:10:00Z', '2026-07-26T03:10:00Z');
  `);
  knowledge.close();
  return { ledgerPath, knowledgePath };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("AnythingLLM記憶閲覧WebUI", () => {
  it("コメントを新しい順で検索し、取込状態を返す", () => {
    const reader = createMemoryReader(fixture());
    expect(reader.list({ type: "comments", queryText: "釣り", limit: 20 })).toEqual({
      entries: [expect.objectContaining({ sequence: 2, userDisplayName: "Bob", body: "釣りが好き" })],
      counts: { comments: 2, streams: 1, facts: 1 },
      ingestion: { embedded: 1, pending: 1, failed: 0 },
    });
  });

  it("配信要約と出典付き事実を閲覧できる", () => {
    const reader = createMemoryReader(fixture());
    expect(reader.list({ type: "streams", queryText: "", limit: 20 }).entries[0]).toEqual(
      expect.objectContaining({ streamId: "s1", summary: "釣りの話をした。", factCount: 1 })
    );
    expect(reader.list({ type: "facts", queryText: "Bob", limit: 20 }).entries[0]).toEqual(
      expect.objectContaining({ subject: "Bob", key: "趣味", value: "釣り", sourceEventIds: ["e2"] })
    );
  });

  it("URL入力を許可された種別と上限へ正規化する", () => {
    expect(buildMemoryRequestFromUrl(new URL("http://localhost/api/memory?type=bad&q=%20Bob%20&limit=9999"), 100))
      .toEqual({ type: "comments", queryText: "Bob", limit: 500 });
  });

  it("LAN用ポート3221を上限件数500へ丸めない", () => {
    expect(parseArgs(["--port", "3221"]).port).toBe(3221);
  });

  it("HTMLは検索UIを持ち、変更操作を持たない", () => {
    const html = renderMemoryHtml();
    expect(html).toContain("記憶を検索");
    expect(html).toContain("配信要約");
    expect(html).not.toContain(">削除<");
    expect(html).not.toContain("method=\"POST\"");
  });

  it("LAN公開ルールは3220のAnythingLLM UIとポートごとに共存する", () => {
    const script = readFileSync(path.resolve("scripts/configure-anythingllm-lan-ui.ps1"), "utf8");
    expect(script).toContain('$ruleName = "twitchRaid LAN UI ${Port}"');
    expect(script).toContain("-Profile Any");
  });
});
