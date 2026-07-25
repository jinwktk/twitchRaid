import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AnythingLlmStreamKnowledge,
  type AnythingLlmStreamKnowledgeClient,
} from "../../src/commands/anythingllm-stream-knowledge";
import {
  AnythingLlmClientError,
  type AnythingLlmChatInput,
  type AnythingLlmTextDocumentInput,
} from "../../src/commands/anythingllm-client";
import {
  AnythingLlmLedger,
  type AnythingLlmCommentEvent,
} from "../../src/commands/anythingllm-ledger";
import logger from "../../src/utils/logger";

let tempDir: string | null = null;

function makePaths(): { ledgerPath: string; statePath: string } {
  tempDir ??= fs.mkdtempSync(
    path.join(os.tmpdir(), "anythingllm-stream-knowledge-")
  );
  return {
    ledgerPath: path.join(tempDir, "ledger.sqlite"),
    statePath: path.join(tempDir, "stream-knowledge.sqlite"),
  };
}

function makeEvent(
  overrides: Partial<AnythingLlmCommentEvent> = {}
): AnythingLlmCommentEvent {
  return {
    eventId: "message-1",
    channel: "rukalun",
    channelId: "channel-1",
    streamId: "stream-1",
    userId: "user-1",
    userLogin: "viewer",
    userDisplayName: "視聴者",
    occurredAt: "2026-07-25T08:00:00.000Z",
    body: "赤が好き",
    ...overrides,
  };
}

function makeClient(
  overrides: Partial<AnythingLlmStreamKnowledgeClient> = {}
): AnythingLlmStreamKnowledgeClient {
  return {
    chat: vi.fn(async (_input: AnythingLlmChatInput) => ({
      reply: JSON.stringify({
        summary: "赤が好きという話題。",
        facts: [
          {
            subject: "viewer",
            key: "好きな色",
            value: "赤",
            source_event_ids: ["message-1"],
          },
        ],
      }),
      sourceCount: 1,
    })),
    ingestTextDocument: vi.fn(
      async (input: AnythingLlmTextDocumentInput) => ({
        documentLocation: `custom-documents/${input.documentName}.json`,
        recoveredUpload: false,
      })
    ),
    ...overrides,
  };
}

function captureInput() {
  return {
    streamId: "stream-1",
    channel: "rukalun",
    title: "今日の配信",
    gameName: "Just Chatting",
    startedAt: "2026-07-25T07:00:00.000Z",
    endedAt: "2026-07-25T09:00:00.000Z",
  };
}

function embedAll(ledger: AnythingLlmLedger): void {
  while (true) {
    const batch = ledger.sealNextBatch({
      workspaceSlug: "twitch-rukalun",
      maxComments: 200,
    });
    if (!batch) return;
    ledger.markBatchUploaded(
      batch.batchId,
      batch.documentName,
      `custom-documents/${batch.documentName}.json`
    );
    ledger.markBatchEmbedded(batch.batchId, "twitch-rukalun");
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("AnythingLlmStreamKnowledge", () => {
  it("captures one immutable final accepted-sequence watermark synchronously", () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent());
    ledger.acceptComment(
      makeEvent({
        eventId: "message-2",
        occurredAt: "2026-07-25T08:00:01.000Z",
        body: "青も好き",
      })
    );
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient(),
      stateDbPath: paths.statePath,
    });

    const captured = knowledge.captureStreamEnd(captureInput());
    ledger.acceptComment(
      makeEvent({
        eventId: "message-after-capture",
        occurredAt: "2026-07-25T09:00:01.000Z",
        body: "終了captureより後",
      })
    );
    const repeated = knowledge.captureStreamEnd({
      ...captureInput(),
      endedAt: "2026-07-25T09:01:00.000Z",
    });

    expect(captured).toMatchObject({
      streamId: "stream-1",
      finalAcceptedSequence: 2,
      status: "captured",
    });
    expect(repeated.finalAcceptedSequence).toBe(2);
    expect(repeated.endedAt).toBe("2026-07-25T09:00:00.000Z");

    knowledge.close();
    ledger.close();
  });

  it("does not call AnythingLLM chat until every target batch is embedded", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent());
    const client = makeClient();
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client,
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    const waiting = await knowledge.processStream("stream-1");

    expect(waiting.status).toBe("waiting_batches");
    expect(client.chat).not.toHaveBeenCalled();
    expect(client.ingestTextDocument).not.toHaveBeenCalled();

    embedAll(ledger);
    const complete = await knowledge.processStream("stream-1");

    expect(complete.status).toBe("complete");
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(client.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.stringMatching(/^twitchraid-stream-/u),
      })
    );
    expect(client.ingestTextDocument).toHaveBeenCalledTimes(2);

    knowledge.close();
    ledger.close();
  });

  it("accepts a completed think block and fenced JSON from AnythingLLM", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent());
    embedAll(ledger);
    const payload = JSON.stringify({
      summary: "赤が好きという話題。",
      facts: [{
        subject: "viewer",
        key: "好きな色",
        value: "赤",
        source_event_ids: ["message-1"],
      }],
    });
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({
        chat: vi.fn(async () => ({
          reply: `<think>Internal reasoning in English</think>\n\`\`\`json\n${payload}\n\`\`\``,
          sourceCount: 1,
        })),
      }),
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    await expect(knowledge.processStream("stream-1")).resolves.toMatchObject({
      status: "complete",
      finalSummary: "赤が好きという話題。",
      factCount: 1,
    });

    knowledge.close();
    ledger.close();
  });

  it("rejects an unclosed think block before parsing stream knowledge JSON", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent());
    embedAll(ledger);
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({
        chat: vi.fn(async () => ({
          reply: '<THINK>未完了 {"summary":"危険","facts":[]}',
          sourceCount: 1,
        })),
      }),
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    await expect(knowledge.processStream("stream-1")).resolves.toMatchObject({
      status: "failed",
      lastFailureReason: "invalid_json",
    });

    knowledge.close();
    ledger.close();
  });

  it("resumes cached leaf nodes after restart and reduces in accepted-sequence order", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent({ eventId: "message-1", body: "一番目" }));
    ledger.acceptComment(
      makeEvent({
        eventId: "message-2",
        occurredAt: "2026-07-25T08:00:01.000Z",
        body: "二番目",
      })
    );
    embedAll(ledger);

    const firstChat = vi
      .fn<AnythingLlmStreamKnowledgeClient["chat"]>()
      .mockResolvedValueOnce({
        reply: JSON.stringify({
          summary: "一番目の要約",
          facts: [],
        }),
        sourceCount: 1,
      })
      .mockRejectedValueOnce(
        new AnythingLlmClientError(
          "unavailable",
          "AnythingLLM workspace chat failed"
        )
      );
    const first = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({ chat: firstChat }),
      stateDbPath: paths.statePath,
      leafMaxComments: 1,
      reduceFanIn: 2,
    });
    first.captureStreamEnd(captureInput());
    expect((await first.processStream("stream-1")).status).toBe("failed");
    first.close();

    const secondChat = vi.fn(async (input: AnythingLlmChatInput) => {
      if (input.message.includes("TWITCH_STREAM_LEAF_V1")) {
        expect(input.message).toContain('"accepted_sequence":2');
        expect(input.message).not.toContain('"accepted_sequence":1');
        return {
          reply: JSON.stringify({
            summary: "二番目の要約",
            facts: [],
          }),
          sourceCount: 1,
        };
      }
      expect(input.message.indexOf("一番目の要約")).toBeLessThan(
        input.message.indexOf("二番目の要約")
      );
      return {
        reply: JSON.stringify({ summary: "順序どおりの最終要約" }),
        sourceCount: 0,
      };
    });
    const second = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({ chat: secondChat }),
      stateDbPath: paths.statePath,
      leafMaxComments: 1,
      reduceFanIn: 2,
    });

    const complete = await second.processStream("stream-1");

    expect(complete).toMatchObject({
      status: "complete",
      finalSummary: "順序どおりの最終要約",
    });
    expect(secondChat).toHaveBeenCalledTimes(2);

    second.close();
    ledger.close();
  });

  it("rejects any fact citation that is not an accepted local event ID", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent());
    embedAll(ledger);
    const client = makeClient({
      chat: vi.fn(async () => ({
        reply: JSON.stringify({
          summary: "不正な出典",
          facts: [
            {
              subject: "viewer",
              key: "好きな色",
              value: "赤",
              source_event_ids: ["invented-event"],
            },
          ],
        }),
        sourceCount: 1,
      })),
    });
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client,
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    const result = await knowledge.processStream("stream-1");

    expect(result).toMatchObject({
      status: "failed",
      lastFailureReason: "invalid_citation",
    });
    expect(client.ingestTextDocument).not.toHaveBeenCalled();

    knowledge.close();
    ledger.close();
  });

  it("preserves contradictory facts with source attribution instead of overwriting", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(makeEvent({ eventId: "red", body: "赤が好き" }));
    ledger.acceptComment(
      makeEvent({
        eventId: "blue",
        occurredAt: "2026-07-25T08:00:01.000Z",
        body: "青が好き",
      })
    );
    embedAll(ledger);
    const chat = vi.fn(async (input: AnythingLlmChatInput) => {
      if (input.message.includes('"event_id":"red"')) {
        return {
          reply: JSON.stringify({
            summary: "赤が好き",
            facts: [
              {
                subject: "viewer",
                key: "好きな色",
                value: "赤",
                source_event_ids: ["red"],
              },
            ],
          }),
          sourceCount: 1,
        };
      }
      if (input.message.includes('"event_id":"blue"')) {
        return {
          reply: JSON.stringify({
            summary: "青が好き",
            facts: [
              {
                subject: "viewer",
                key: "好きな色",
                value: "青",
                source_event_ids: ["blue"],
              },
            ],
          }),
          sourceCount: 1,
        };
      }
      return {
        reply: JSON.stringify({
          summary: "好きな色について相反する発言があった。",
        }),
        sourceCount: 0,
      };
    });
    const ingest = vi.fn(
      async (input: AnythingLlmTextDocumentInput) => ({
        documentLocation: `custom-documents/${input.documentName}.json`,
        recoveredUpload: false,
      })
    );
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({ chat, ingestTextDocument: ingest }),
      stateDbPath: paths.statePath,
      leafMaxComments: 1,
      reduceFanIn: 2,
    });
    knowledge.captureStreamEnd(captureInput());

    const result = await knowledge.processStream("stream-1");

    expect(result.status).toBe("complete");
    const factsInput = ingest.mock.calls
      .map(([input]) => input)
      .find(({ documentName }) => documentName.endsWith("-facts"));
    expect(factsInput?.documentSource).toBe(
      "twitchraid://stream/stream-1/facts"
    );
    expect(factsInput?.text).toContain('"value":"赤"');
    expect(factsInput?.text).toContain('"source_event_ids":["red"]');
    expect(factsInput?.text).toContain('"value":"青"');
    expect(factsInput?.text).toContain('"source_event_ids":["blue"]');

    knowledge.close();
    ledger.close();
  });

  it("completes a zero-comment stream without calling chat", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    const client = makeClient();
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client,
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    const result = await knowledge.processStream("stream-1");

    expect(result).toMatchObject({
      status: "complete",
      finalAcceptedSequence: 0,
      finalSummary: "記録されたコメントはありません。",
      factCount: 0,
    });
    expect(client.chat).not.toHaveBeenCalled();
    expect(client.ingestTextDocument).toHaveBeenCalledTimes(2);

    knowledge.close();
    ledger.close();
  });

  it("never logs raw comments or provider response bodies on failure", async () => {
    const paths = makePaths();
    const ledger = new AnythingLlmLedger(paths.ledgerPath);
    ledger.acceptComment(
      makeEvent({ body: "ログ禁止の秘密コメント本文" })
    );
    embedAll(ledger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const knowledge = new AnythingLlmStreamKnowledge({
      ledger,
      client: makeClient({
        chat: vi.fn(async () => {
          throw new Error("プロバイダー秘密応答本文");
        }),
      }),
      stateDbPath: paths.statePath,
    });
    knowledge.captureStreamEnd(captureInput());

    await knowledge.processStream("stream-1");

    const logs = warn.mock.calls.flat().map(String).join("\n");
    expect(logs).not.toContain("ログ禁止の秘密コメント本文");
    expect(logs).not.toContain("プロバイダー秘密応答本文");
    expect(logs).toContain("stream=stream-1");

    knowledge.close();
    ledger.close();
  });
});
