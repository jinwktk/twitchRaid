import { describe, expect, it, vi } from "vitest";
import {
  MentionChatVideoClient,
  formatMentionChatVideoContext,
} from "../../src/commands/mention-chat-video";

const requestedAt = "2026-11-03T01:02:03.000Z";
const baseInput = {
  requestId: "mention-1",
  channel: "rukalun",
  streamId: "stream-123",
  requestedAt,
  question: "今の場面はどうなってる？",
};

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    ...baseInput,
    question: undefined,
    windowEnd: "2026-11-03T01:02:33.000Z",
    durationSeconds: 30,
    frameCount: 30,
    analysis: "画面中央でボスと戦っている。",
    transcript: "危ない、と話している。",
    timings: {
      captureMs: 30_000,
      decodeMs: 100,
      visionMs: 2_000,
      transcribeMs: 500,
      totalMs: 32_600,
    },
    ...overrides,
  };
}

describe("MentionChatVideoClient", () => {
  it("starts the exact 30-second request immediately and validates the response", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify(okBody()), { status: 200 })
    );
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090",
      timeoutMs: 180_000,
      maxPending: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const job = client.start(baseInput);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://video-analysis:8090/v1/analyze-live"
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      ...baseInput,
      durationSeconds: 30,
    });
    await expect(job.promise).resolves.toMatchObject({
      status: "ok",
      durationSeconds: 30,
      frameCount: 30,
      windowEnd: "2026-11-03T01:02:33.000Z",
    });
  });

  it.each([
    ["requestId", "mention-other"],
    ["channel", "other_channel"],
    ["streamId", "other-stream"],
    ["requestedAt", "2026-11-03T01:02:04.000Z"],
    ["windowEnd", "2026-11-03T01:02:34.000Z"],
    ["frameCount", 29],
    ["durationSeconds", 29],
  ])("rejects a mismatched %s", async (key, value) => {
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090/v1/analyze-live",
      timeoutMs: 180_000,
      maxPending: 2,
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify(okBody({ [key]: value })), { status: 200 })
      ) as typeof fetch,
    });
    const result = await client.start(baseInput).promise;
    expect(result).toMatchObject({ status: "unavailable" });
    expect(result.status === "unavailable" && result.reason).toMatch(
      /identity_mismatch|invalid_response/
    );
  });

  it("bounds concurrent captures and releases the slot after completion", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => await firstResponse)
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify(okBody({ requestId: "mention-3" })))
      );
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090/v1/analyze-live",
      timeoutMs: 180_000,
      maxPending: 1,
      fetchImpl,
    });

    const first = client.start(baseInput);
    await expect(
      client.start({ ...baseInput, requestId: "mention-2" }).promise
    ).resolves.toMatchObject({ status: "unavailable", reason: "busy" });
    resolveFirst(new Response(JSON.stringify(okBody())));
    await first.promise;
    await expect(
      client.start({ ...baseInput, requestId: "mention-3" }).promise
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("aborts all captures on stop without rejecting the promise", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090/v1/analyze-live",
      timeoutMs: 180_000,
      maxPending: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const job = client.start(baseInput);
    client.abortAll();
    await expect(job.promise).resolves.toMatchObject({
      status: "unavailable",
      reason: "aborted",
    });
  });

  it.each([
    ["network_error", vi.fn(async () => { throw new Error("offline"); })],
    ["http_error", vi.fn(async () => new Response("{}", { status: 500 }))],
    ["invalid_response", vi.fn(async () => new Response("not-json"))],
    [
      "oversize_response",
      vi.fn(async () => new Response("x".repeat(16_385))),
    ],
  ])("converts %s failures to a resolved typed result", async (reason, fetchImpl) => {
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090/v1/analyze-live",
      timeoutMs: 180_000,
      maxPending: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(client.start(baseInput).promise).resolves.toMatchObject({
      status: "unavailable",
      reason,
    });
  });

  it("converts the finite deadline into a timeout result", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        })
    );
    const client = new MentionChatVideoClient({
      enabled: true,
      endpoint: "http://video-analysis:8090/v1/analyze-live",
      timeoutMs: 5,
      maxPending: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(client.start(baseInput).promise).resolves.toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
  });

  it("formats bounded observations without embedding frames", () => {
    const result = okBody() as never;
    const context = formatMentionChatVideoContext(result);
    expect(context).toContain("30秒");
    expect(context).toContain("映像観測");
    expect(context).toContain("音声文字起こし");
    expect(context).not.toContain("base64");
  });
});
