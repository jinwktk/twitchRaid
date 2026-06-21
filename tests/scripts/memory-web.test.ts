import { describe, expect, it, vi } from "vitest";
import {
  buildListRequestFromUrl,
  executeMemoryOperation,
  normalizeMemoryEntries,
  renderHtml,
} from "../../scripts/memory-web.mjs";

describe("memory web operations", () => {
  it("normalizes mem0 list/search payloads for the existing memory table", () => {
    const result = normalizeMemoryEntries({
      results: [
        {
          id: "mem-1",
          memory: "好物: カレー",
          metadata: { key: "好物", kind: "semantic", sourceUser: "viewer" },
          updated_at: "2026-06-21T12:00:00Z",
        },
        {
          id: "mem-2",
          text: "口調: 短くD",
          payload: { metadata: { key: "口調" } },
        },
      ],
    });

    expect(result).toEqual({
      entries: [
        {
          id: "mem-1",
          key: "好物",
          value: "カレー",
          kind: "semantic",
          status: "active",
          sourceUser: "viewer",
          updatedAt: "2026-06-21T12:00:00Z",
        },
        {
          id: "mem-2",
          key: "口調",
          value: "短くD",
          kind: "",
          status: "active",
          sourceUser: "",
          updatedAt: "",
        },
      ],
      totalCount: 2,
      activeCount: 2,
    });
  });

  it("lists scoped mem0 memories", async () => {
    const client = {
      list: vi.fn().mockResolvedValue({ results: [{ id: "1", memory: "好物: カレー" }] }),
      search: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = await executeMemoryOperation(
      client,
      { userId: "rukalun", agentId: "twitchRaid", runId: "", appId: "twitchRaid", limit: 100 },
      { action: "list" }
    );

    expect(client.list).toHaveBeenCalledWith({
      userId: "rukalun",
      agentId: "twitchRaid",
      runId: "",
      limit: 100,
    });
    expect(result.entries[0]).toMatchObject({ id: "1", key: "好物", value: "カレー" });
  });

  it("searches scoped mem0 memories when query text is provided", async () => {
    const client = {
      list: vi.fn(),
      search: vi.fn().mockResolvedValue({ results: [{ id: "1", memory: "検索結果" }] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    await executeMemoryOperation(
      client,
      { userId: "rukalun", agentId: "twitchRaid", runId: "", appId: "twitchRaid", limit: 100 },
      { action: "list", queryText: "好きな食べ物", limit: 10 }
    );

    expect(client.search).toHaveBeenCalledWith({
      queryText: "好きな食べ物",
      userId: "rukalun",
      agentId: "twitchRaid",
      runId: "",
      limit: 10,
    });
  });

  it("keeps list requests as plain list even when the search box still has text", () => {
    const listUrl = new URL(
      "http://localhost/api/memory?mode=list&q=%E5%A5%BD%E3%81%8D&limit=50"
    );
    const searchUrl = new URL(
      "http://localhost/api/memory?mode=search&q=%E5%A5%BD%E3%81%8D&limit=50"
    );

    expect(buildListRequestFromUrl(listUrl, 100)).toEqual({
      action: "list",
      queryText: "",
      limit: 50,
    });
    expect(buildListRequestFromUrl(searchUrl, 100)).toEqual({
      action: "list",
      queryText: "好き",
      limit: 50,
    });
  });

  it("creates extracted key-value memory with infer disabled metadata", async () => {
    const client = {
      list: vi.fn(),
      search: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "created" }),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = await executeMemoryOperation(
      client,
      { userId: "rukalun", agentId: "twitchRaid", runId: "", appId: "twitchRaid", limit: 100 },
      {
        action: "upsert",
        mode: "create",
        key: "好物",
        value: "カレー",
        kind: "semantic",
      }
    );

    expect(client.create).toHaveBeenCalledWith({
      userId: "rukalun",
      agentId: "twitchRaid",
      runId: "",
      appId: "twitchRaid",
      key: "好物",
      value: "カレー",
      kind: "semantic",
      sourceUser: "memory-web",
    });
    expect(result).toEqual({ saved: true, reason: "saved", raw: { id: "created" } });
  });

  it("updates existing mem0 memory key and value by id", async () => {
    const client = {
      list: vi.fn(),
      search: vi.fn(),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "mem-1", memory: "好物: ラーメン" }),
      delete: vi.fn(),
    };

    const result = await executeMemoryOperation(
      client,
      { userId: "rukalun", agentId: "twitchRaid", runId: "", appId: "twitchRaid", limit: 100 },
      {
        action: "upsert",
        mode: "update",
        id: "mem-1",
        key: "好きな食べ物",
        value: "ラーメン",
        kind: "semantic",
      }
    );

    expect(client.update).toHaveBeenCalledWith({
      id: "mem-1",
      key: "好きな食べ物",
      value: "ラーメン",
      kind: "semantic",
      sourceUser: "memory-web",
      appId: "twitchRaid",
    });
    expect(result).toEqual({
      saved: true,
      reason: "saved",
      raw: { id: "mem-1", memory: "好物: ラーメン" },
    });
  });

  it("deletes existing mem0 memory by id", async () => {
    const client = {
      list: vi.fn(),
      search: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({ deleted: true }),
    };

    const result = await executeMemoryOperation(
      client,
      { userId: "rukalun", agentId: "twitchRaid", runId: "", appId: "twitchRaid", limit: 100 },
      { action: "delete", id: "mem-1" }
    );

    expect(client.delete).toHaveBeenCalledWith({ id: "mem-1" });
    expect(result).toEqual({ deleted: true, reason: "deleted", raw: { deleted: true } });
  });

  it("keeps the existing memory UI while switching internals to mem0", () => {
    const html = renderHtml();

    expect(html).toContain("twitchRaid Memory");
    expect(html).toContain("/api/memory");
    expect(html).toContain("Semantic Search");
    expect(html).toContain('mode: state.editingId ? "update" : "create"');
    expect(html).toContain("formKey.readOnly = false;");
    expect(html).not.toContain("formKey.readOnly = Boolean(row);");
  });
});
