import { describe, expect, it, vi } from "vitest";
import {
  buildListRequestFromUrl,
  executeRequestNoteOperation,
  renderHtml,
} from "../../scripts/bot-request-notes-web.mjs";

describe("bot request notes web operations", () => {
  it("builds list requests with status and query filters", () => {
    const url = new URL(
      "http://localhost/api/notes?status=planned&q=raid&limit=25"
    );

    expect(buildListRequestFromUrl(url, 100)).toEqual({
      action: "list",
      status: "planned",
      queryText: "raid",
      limit: 25,
    });
  });

  it("lists and updates notes through the provided client", async () => {
    const client = {
      list: vi.fn().mockReturnValue({
        entries: [{ id: 1, summary: "BotでRaid挨拶を再生成したい" }],
        totalCount: 1,
        openCount: 1,
      }),
      update: vi.fn().mockReturnValue({
        updated: true,
        note: { id: 1, status: "planned", operatorNote: "次回対応" },
      }),
    };

    const listed = await executeRequestNoteOperation(
      client,
      { limit: 100 },
      { action: "list", status: "open", queryText: "Raid", limit: 10 }
    );
    expect(client.list).toHaveBeenCalledWith({
      status: "open",
      queryText: "Raid",
      limit: 10,
    });
    expect(listed.openCount).toBe(1);

    const updated = await executeRequestNoteOperation(
      client,
      { limit: 100 },
      {
        action: "update",
        id: 1,
        status: "planned",
        operatorNote: "次回対応",
      }
    );
    expect(client.update).toHaveBeenCalledWith({
      id: 1,
      status: "planned",
      operatorNote: "次回対応",
    });
    expect(updated).toMatchObject({ updated: true });
  });

  it("renders a status-editing UI for bot request notes", () => {
    const html = renderHtml();

    expect(html).toContain("twitchRaid Bot Request Notes");
    expect(html).toContain("/api/notes");
    expect(html).toContain("status");
    expect(html).toContain("operatorNote");
    expect(html).toContain("planned");
    expect(html).toContain("done");
  });
});
