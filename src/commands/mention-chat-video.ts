const VIDEO_DURATION_SECONDS = 30;
const VIDEO_FRAME_COUNT = 30;
const VIDEO_QUESTION_MAX_CHARS = 500;
const VIDEO_ANALYSIS_MAX_CHARS = 4_000;
const VIDEO_TRANSCRIPT_MAX_CHARS = 2_000;
const VIDEO_RESPONSE_MAX_BYTES = 16_384;
const VIDEO_ANALYZE_PATH = "/v1/analyze-live";

export type MentionChatVideoUnavailableReason =
  | "disabled"
  | "not_live"
  | "busy"
  | "timeout"
  | "network_error"
  | "http_error"
  | "service_unavailable"
  | "invalid_response"
  | "oversize_response"
  | "identity_mismatch"
  | "aborted"
  | "stale";

export interface MentionChatVideoAnalysis {
  status: "ok";
  requestId: string;
  channel: string;
  streamId: string;
  requestedAt: string;
  windowEnd: string;
  durationSeconds: 30;
  frameCount: 30;
  analysis: string;
  transcript: string;
  timings: {
    captureMs: number;
    decodeMs: number;
    visionMs: number;
    transcribeMs: number;
    totalMs: number;
  };
}

export interface MentionChatVideoUnavailable {
  status: "unavailable";
  reason: MentionChatVideoUnavailableReason;
  requestId: string;
}

export type MentionChatVideoResult =
  | MentionChatVideoAnalysis
  | MentionChatVideoUnavailable;

export interface MentionChatVideoCaptureInput {
  requestId: string;
  channel: string;
  streamId: string;
  requestedAt: string;
  question: string;
}

export interface MentionChatVideoCaptureJob {
  requestId: string;
  streamId: string;
  requestedAt: string;
  promise: Promise<MentionChatVideoResult>;
  abort: () => void;
}

export interface MentionChatVideoClientOptions {
  enabled: boolean;
  endpoint: string;
  timeoutMs: number;
  maxPending: number;
  fetchImpl?: typeof fetch;
}

function unavailable(
  requestId: string,
  reason: MentionChatVideoUnavailableReason
): MentionChatVideoUnavailable {
  return { status: "unavailable", reason, requestId };
}

function resolveVideoAnalyzeEndpoint(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/+$/u, "");
  return normalized.endsWith(VIDEO_ANALYZE_PATH)
    ? normalized
    : `${normalized}${VIDEO_ANALYZE_PATH}`;
}

function isBoundedString(
  value: unknown,
  maxChars: number,
  allowEmpty = true
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxChars &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseSuccessfulResponse(
  value: unknown,
  input: MentionChatVideoCaptureInput
): MentionChatVideoResult {
  if (!value || typeof value !== "object") {
    return unavailable(input.requestId, "invalid_response");
  }
  const body = value as Record<string, unknown>;
  if (body.status === "unavailable") {
    if (body.requestId !== input.requestId) {
      return unavailable(input.requestId, "identity_mismatch");
    }
    if (
      typeof body.reason !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/u.test(body.reason)
    ) {
      return unavailable(input.requestId, "invalid_response");
    }
    return unavailable(input.requestId, "service_unavailable");
  }
  if (body.status !== "ok") {
    return unavailable(input.requestId, "invalid_response");
  }

  const expectedWindowEnd = new Date(
    Date.parse(input.requestedAt) + VIDEO_DURATION_SECONDS * 1_000
  ).toISOString();
  if (
    body.requestId !== input.requestId ||
    body.channel !== input.channel ||
    body.streamId !== input.streamId ||
    body.requestedAt !== input.requestedAt ||
    body.windowEnd !== expectedWindowEnd
  ) {
    return unavailable(input.requestId, "identity_mismatch");
  }
  if (
    body.durationSeconds !== VIDEO_DURATION_SECONDS ||
    body.frameCount !== VIDEO_FRAME_COUNT ||
    !isBoundedString(body.analysis, VIDEO_ANALYSIS_MAX_CHARS) ||
    !isBoundedString(body.transcript, VIDEO_TRANSCRIPT_MAX_CHARS) ||
    (!body.analysis.trim() && !body.transcript.trim())
  ) {
    return unavailable(input.requestId, "invalid_response");
  }
  if (!body.timings || typeof body.timings !== "object") {
    return unavailable(input.requestId, "invalid_response");
  }
  const timings = body.timings as Record<string, unknown>;
  if (
    !isNonNegativeFinite(timings.captureMs) ||
    !isNonNegativeFinite(timings.decodeMs) ||
    !isNonNegativeFinite(timings.visionMs) ||
    !isNonNegativeFinite(timings.transcribeMs) ||
    !isNonNegativeFinite(timings.totalMs)
  ) {
    return unavailable(input.requestId, "invalid_response");
  }

  return {
    status: "ok",
    requestId: input.requestId,
    channel: input.channel,
    streamId: input.streamId,
    requestedAt: input.requestedAt,
    windowEnd: expectedWindowEnd,
    durationSeconds: VIDEO_DURATION_SECONDS,
    frameCount: VIDEO_FRAME_COUNT,
    analysis: body.analysis,
    transcript: body.transcript,
    timings: {
      captureMs: timings.captureMs,
      decodeMs: timings.decodeMs,
      visionMs: timings.visionMs,
      transcribeMs: timings.transcribeMs,
      totalMs: timings.totalMs,
    },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function formatMentionChatVideoContext(
  result: MentionChatVideoAnalysis
): string {
  const lines = [
    `観測時間: ${result.requestedAt} から ${result.windowEnd} までの30秒`,
    result.analysis.trim() ? `映像観測: ${result.analysis.trim()}` : null,
    result.transcript.trim() ? `音声文字起こし: ${result.transcript.trim()}` : null,
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export class MentionChatVideoClient {
  private readonly enabled: boolean;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly fetchImpl: typeof fetch;
  private readonly pending = new Map<string, AbortController>();

  constructor(options: MentionChatVideoClientOptions) {
    this.enabled = options.enabled;
    this.endpoint = resolveVideoAnalyzeEndpoint(options.endpoint);
    this.timeoutMs = options.timeoutMs;
    this.maxPending = options.maxPending;
    this.fetchImpl =
      options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  start(input: MentionChatVideoCaptureInput): MentionChatVideoCaptureJob {
    const controller = new AbortController();
    const baseJob = {
      requestId: input.requestId,
      streamId: input.streamId,
      requestedAt: input.requestedAt,
      abort: () => controller.abort(),
    };
    if (!this.enabled) {
      return {
        ...baseJob,
        promise: Promise.resolve(unavailable(input.requestId, "disabled")),
      };
    }
    if (this.pending.has(input.requestId) || this.pending.size >= this.maxPending) {
      return {
        ...baseJob,
        promise: Promise.resolve(unavailable(input.requestId, "busy")),
      };
    }

    this.pending.set(input.requestId, controller);
    const promise = this.execute(input, controller)
      .catch(() => unavailable(input.requestId, "network_error"))
      .finally(() => {
        if (this.pending.get(input.requestId) === controller) {
          this.pending.delete(input.requestId);
        }
      });
    return { ...baseJob, promise };
  }

  abortAll(): void {
    for (const controller of this.pending.values()) controller.abort();
  }

  private async execute(
    input: MentionChatVideoCaptureInput,
    controller: AbortController
  ): Promise<MentionChatVideoResult> {
    if (
      !/^[A-Za-z0-9._-]{1,128}$/u.test(input.requestId) ||
      !/^[A-Za-z0-9_]{1,64}$/u.test(input.channel) ||
      input.channel.includes("#") ||
      !/^[A-Za-z0-9._-]{1,128}$/u.test(input.streamId) ||
      !isBoundedString(input.question, VIDEO_QUESTION_MAX_CHARS, false) ||
      !Number.isFinite(Date.parse(input.requestedAt)) ||
      new Date(Date.parse(input.requestedAt)).toISOString() !== input.requestedAt
    ) {
      return unavailable(input.requestId, "invalid_response");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: input.requestId,
          channel: input.channel,
          streamId: input.streamId,
          requestedAt: input.requestedAt,
          durationSeconds: VIDEO_DURATION_SECONDS,
          question: input.question,
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(this.timeoutMs),
        ]),
      });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return unavailable(input.requestId, "aborted");
      }
      return unavailable(
        input.requestId,
        isTimeoutError(error) ? "timeout" : "network_error"
      );
    }

    const bytes = await readBoundedResponseBytes(
      response,
      VIDEO_RESPONSE_MAX_BYTES
    );
    if (!bytes) {
      return unavailable(input.requestId, "oversize_response");
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return unavailable(input.requestId, "invalid_response");
    }
    if (!response.ok) {
      if (body && typeof body === "object") {
        const errorBody = body as Record<string, unknown>;
        if (errorBody.status === "unavailable") {
          if (errorBody.requestId !== input.requestId) {
            return unavailable(input.requestId, "identity_mismatch");
          }
          if (
            typeof errorBody.reason !== "string" ||
            !/^[a-z][a-z0-9_]{0,63}$/u.test(errorBody.reason)
          ) {
            return unavailable(input.requestId, "invalid_response");
          }
          return unavailable(input.requestId, "service_unavailable");
        }
      }
      return unavailable(input.requestId, "http_error");
    }
    return parseSuccessfulResponse(body, input);
  }
}
