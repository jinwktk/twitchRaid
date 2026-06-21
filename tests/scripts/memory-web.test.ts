import { describe, expect, it, vi } from "vitest";
import {
  executeMemoryOperation,
  renderHtml,
} from "../../scripts/memory-web.mjs";

describe("memory web operations", () => {
  it("rejects create requests for existing keys without upserting", () => {
    const memory = {
      listMentionChatMemoryEntriesStore: vi.fn(() => ({
        entries: [{ key: "先頭", value: "古い値" }],
      })),
      upsertMentionChatMemoryEntryStore: vi.fn(() => ({
        saved: true,
        reason: "saved",
      })),
    };

    const result = executeMemoryOperation(
      memory,
      { store: "sqlite", jsonPath: "memory.json", sqlitePath: "memory.sqlite" },
      {
        action: "upsert",
        mode: "create",
        key: "先頭",
        value: "新しい値",
        kind: "semantic",
        status: "active",
      }
    );

    expect(result).toEqual({
      saved: false,
      reason: "already_exists",
      key: "先頭",
    });
    expect(memory.upsertMentionChatMemoryEntryStore).not.toHaveBeenCalled();
  });

  it("allows edit requests to update an existing key", () => {
    const memory = {
      listMentionChatMemoryEntriesStore: vi.fn(),
      upsertMentionChatMemoryEntryStore: vi.fn(() => ({
        saved: true,
        reason: "saved",
        key: "先頭",
      })),
    };

    const result = executeMemoryOperation(
      memory,
      { store: "sqlite", jsonPath: "memory.json", sqlitePath: "memory.sqlite" },
      {
        action: "upsert",
        mode: "update",
        key: " 先頭 ",
        value: "新しい値",
        kind: "semantic",
        status: "active",
      }
    );

    expect(result).toEqual({
      saved: true,
      reason: "saved",
      key: "先頭",
    });
    expect(memory.listMentionChatMemoryEntriesStore).not.toHaveBeenCalled();
    expect(memory.upsertMentionChatMemoryEntryStore).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "先頭",
        value: "新しい値",
      })
    );
  });

  it("renders client code that separates New creates from Edit updates", () => {
    const html = renderHtml();

    expect(html).toContain("state.editingKey = row?.key || null;");
    expect(html).toContain("form.reset();");
    expect(html).toContain('mode: state.editingKey ? "update" : "create"');
    expect(html).toContain("formKey.readOnly = Boolean(row);");
    expect(html).toContain("key already exists");
  });
});
