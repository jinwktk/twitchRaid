import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANYTHING_LLM_LEGACY_MIGRATION_DOCUMENT_SOURCE,
  migrateLegacyMemoryToAnythingLlm,
} from "../../src/commands/anythingllm-legacy-migration";

const temporaryDirectories: string[] = [];

function temporaryPath(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-migration-"));
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

function createSourceDatabase(
  rows: Array<[string, string, string, string]>,
  tombstones: string[] = []
): string {
  const filePath = temporaryPath("memory.sqlite");
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE mention_chat_memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE mention_chat_memory_tombstones (
      key TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO mention_chat_memory (key, value, kind, status) VALUES (?, ?, ?, ?)"
  );
  for (const row of rows) insert.run(...row);
  const insertTombstone = db.prepare(
    "INSERT INTO mention_chat_memory_tombstones (key, deleted_at) VALUES (?, ?)"
  );
  for (const key of tombstones) insertTombstone.run(key, "2026-07-25T00:00:00Z");
  db.close();
  return filePath;
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    sourceSqlitePath: createSourceDatabase([
      ["viewer:好物", "カレー", "semantic", "active"],
    ]),
    migrationSqlitePath: temporaryPath("migration.sqlite"),
    anythingLlmClient: {
      ingestTextDocument: vi.fn().mockResolvedValue({
        documentLocation: "custom-documents/legacy-memory-v1.txt",
        recoveredUpload: false,
      }),
    },
    mem0Endpoint: "http://mem0:8888",
    mem0UserId: "rukalun",
    mem0AgentId: "twitchRaid",
    mem0AppId: "chat",
    mem0Limit: 100,
    mem0TimeoutMs: 1000,
    fetchImpl: vi.fn().mockResolvedValue(response({ results: [] })),
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("migrateLegacyMemoryToAnythingLlm", () => {
  it("reads the scoped Mem0 collection and merges only eligible safe memories", async () => {
    const sourceSqlitePath = createSourceDatabase(
      [
        ["viewer:好物", "カレー", "semantic", "active"],
        ["viewer:候補", "候補値", "implicit", "candidate"],
        ["viewer:停止", "停止値", "semantic", "inactive"],
        ["viewer:削除", "削除値", "semantic", "active"],
        ["viewer:api_key", "secret-value", "semantic", "active"],
      ],
      ["viewer:削除"]
    );
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        results: [
          {
            memory: "viewer:好物: カレー",
            metadata: { key: "viewer:好物" },
          },
          {
            memory: "viewer:好物: ラーメン",
            metadata: { key: "viewer:好物" },
          },
          {
            memory: "viewer:候補: 復活禁止",
            metadata: { key: "viewer:候補" },
          },
          {
            memory: "viewer:新情報: コーヒー",
            metadata: { key: "viewer:新情報" },
          },
        ],
      })
    );
    const ingestTextDocument = vi.fn().mockResolvedValue({
      documentLocation: "custom-documents/legacy-memory-v1.txt",
      recoveredUpload: false,
    });

    const result = await migrateLegacyMemoryToAnythingLlm(
      options({
        sourceSqlitePath,
        fetchImpl,
        anythingLlmClient: { ingestTextDocument },
      })
    );

    const requestUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/memories");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      user_id: "rukalun",
      agent_id: "twitchRaid",
      app_id: "chat",
      limit: "100",
    });
    const document = ingestTextDocument.mock.calls[0][0];
    expect(document.documentSource).toBe(
      ANYTHING_LLM_LEGACY_MIGRATION_DOCUMENT_SOURCE
    );
    expect(document.text).toContain('"viewer:好物": "カレー" [source=local]');
    expect(document.text).toContain('"viewer:好物": "ラーメン" [source=mem0]');
    expect(document.text).toContain(
      '"viewer:新情報": "コーヒー" [source=mem0]'
    );
    expect(document.text).not.toContain("復活禁止");
    expect(document.text).not.toContain("secret-value");
    expect(result.entryCount).toBe(3);
  });

  it("fails closed for missing and invalid databases", async () => {
    const invalid = temporaryPath("invalid.sqlite");
    new DatabaseSync(invalid).close();
    for (const sourceSqlitePath of [
      temporaryPath("missing.sqlite"),
      invalid,
    ]) {
      const configured = options({ sourceSqlitePath });
      await expect(
        migrateLegacyMemoryToAnythingLlm(configured)
      ).rejects.toThrow(/database|schema/iu);
      expect(
        configured.anythingLlmClient.ingestTextDocument
      ).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["unknown status", "semantic", "future"],
    ["unknown kind", "future", "active"],
  ])("fails closed for %s", async (_label, kind, status) => {
    const configured = options({
      sourceSqlitePath: createSourceDatabase([
        ["viewer:key", "value", kind, status],
      ]),
    });
    await expect(
      migrateLegacyMemoryToAnythingLlm(configured)
    ).rejects.toThrow(/unknown/iu);
  });

  it("fails closed when the Mem0 limit is reached", async () => {
    const configured = options({
      mem0Limit: 2,
      fetchImpl: vi.fn().mockResolvedValue(
        response({
          results: [
            { memory: "a: 1", metadata: { key: "a" } },
            { memory: "b: 2", metadata: { key: "b" } },
          ],
        })
      ),
    });
    await expect(
      migrateLegacyMemoryToAnythingLlm(configured)
    ).rejects.toThrow(/truncated/iu);
    expect(configured.anythingLlmClient.ingestTextDocument).not.toHaveBeenCalled();
  });

  it("freezes the snapshot before upload and reuses it after a failed attempt", async () => {
    const migrationSqlitePath = temporaryPath("migration.sqlite");
    const firstClient = {
      ingestTextDocument: vi.fn().mockRejectedValue(new Error("lost response")),
    };
    const first = options({ migrationSqlitePath, anythingLlmClient: firstClient });

    await expect(migrateLegacyMemoryToAnythingLlm(first)).rejects.toThrow(
      "lost response"
    );

    const changedSource = createSourceDatabase([
      ["viewer:変更後", "混ぜない", "semantic", "active"],
    ]);
    const secondClient = {
      ingestTextDocument: vi.fn().mockResolvedValue({
        documentLocation: "custom-documents/legacy-memory-v1.txt",
        recoveredUpload: true,
      }),
    };
    const result = await migrateLegacyMemoryToAnythingLlm(
      options({
        sourceSqlitePath: changedSource,
        migrationSqlitePath,
        anythingLlmClient: secondClient,
        fetchImpl: vi.fn().mockRejectedValue(new Error("must not refetch")),
      })
    );

    expect(secondClient.ingestTextDocument.mock.calls[0][0].text).toContain(
      "viewer:好物"
    );
    expect(secondClient.ingestTextDocument.mock.calls[0][0].text).not.toContain(
      "変更後"
    );
    expect(result.status).toBe("migrated");

    const thirdClient = { ingestTextDocument: vi.fn() };
    const rerun = await migrateLegacyMemoryToAnythingLlm(
      options({
        sourceSqlitePath: temporaryPath("absent.sqlite"),
        migrationSqlitePath,
        anythingLlmClient: thirdClient,
        fetchImpl: vi.fn().mockRejectedValue(new Error("must not refetch")),
      })
    );
    expect(rerun.status).toBe("already_migrated");
    expect(thirdClient.ingestTextDocument).not.toHaveBeenCalled();
  });
});
