import fs from "node:fs";

export type AnythingLlmClientFailureReason =
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "rejected"
  | "ambiguous";

export type AnythingLlmClientFailureStage =
  | "upload"
  | "embed"
  | "unembed"
  | "source_delete";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface AnythingLlmClientOptions {
  baseUrl: string;
  apiKey?: string;
  apiKeyFile?: string;
  workspaceName: string;
  workspaceSlug: string;
  sessionId: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  readFile?: (filePath: string, encoding: BufferEncoding) => string;
}

export interface AnythingLlmTextDocumentInput {
  documentName: string;
  documentSource: string;
  text: string;
  knownDocumentLocation?: string | null;
}

export interface AnythingLlmIngestResult {
  documentLocation: string;
  recoveredUpload: boolean;
}

export interface AnythingLlmRemoveTextDocumentInput {
  documentName: string;
  documentSource: string;
  knownDocumentLocation: string;
}

export interface AnythingLlmRemoveTextDocumentResult {
  documentLocation: string;
  alreadyDeleted: boolean;
}

export interface AnythingLlmChatInput {
  message: string;
  sessionId?: string;
  reset?: boolean;
}

export interface AnythingLlmChatResult {
  reply: string;
  sourceCount: number;
}

interface WorkspaceRecord {
  name?: unknown;
  slug?: unknown;
}

interface DocumentNode {
  type?: unknown;
  name?: unknown;
  title?: unknown;
  docSource?: unknown;
  items?: unknown;
}

interface RequestOptions {
  body?: unknown;
  method?: "GET" | "POST" | "DELETE";
  operation: string;
  path: string;
}

export class AnythingLlmClientError extends Error {
  readonly stage: AnythingLlmClientFailureStage | null;
  readonly documentLocation: string | null;

  constructor(
    readonly reason: AnythingLlmClientFailureReason,
    message: string,
    options: {
      stage?: AnythingLlmClientFailureStage;
      documentLocation?: string | null;
    } = {}
  ) {
    super(message);
    this.name = "AnythingLlmClientError";
    this.stage = options.stage ?? null;
    this.documentLocation = options.documentLocation?.trim() || null;
  }
}

function annotateIngestFailure(
  error: unknown,
  stage: AnythingLlmClientFailureStage,
  documentLocation: string | null
): AnythingLlmClientError {
  if (error instanceof AnythingLlmClientError) {
    if (
      error.stage === stage &&
      error.documentLocation === documentLocation
    ) {
      return error;
    }
    return new AnythingLlmClientError(error.reason, error.message, {
      stage,
      documentLocation,
    });
  }
  return new AnythingLlmClientError(
    "unavailable",
    `AnythingLLM document ${stage} failed`,
    { stage, documentLocation }
  );
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnythingLlmClientError(
      "rejected",
      "AnythingLLM base URL is invalid"
    );
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AnythingLlmClientError(
      "rejected",
      "AnythingLLM base URL must use HTTP or HTTPS"
    );
  }
  if (url.username || url.password) {
    throw new AnythingLlmClientError(
      "rejected",
      "AnythingLLM base URL must not contain credentials"
    );
  }
  return url.toString().replace(/\/+$/u, "");
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AnythingLlmClientError(
      "rejected",
      `AnythingLLM ${label} is required`
    );
  }
  return normalized;
}

function normalizeTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100) {
    throw new AnythingLlmClientError(
      "rejected",
      "AnythingLLM timeout is invalid"
    );
  }
  return value;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function matchesDocumentTitle(actual: unknown, expected: string): boolean {
  if (actual === expected) return true;
  return (
    typeof actual === "string" &&
    !/\.[^.\s]+$/u.test(expected) &&
    actual === `${expected}.txt`
  );
}

function findDocumentLocation(
  payload: unknown,
  expectedTitle: string,
  expectedSource: string
): string | null {
  const root = (payload as { localFiles?: DocumentNode } | null)?.localFiles;
  if (
    root?.type !== "folder" ||
    root.name !== "documents" ||
    !Array.isArray(root.items)
  ) {
    throw new AnythingLlmClientError(
      "invalid_response",
      "AnythingLLM document discovery returned an invalid response"
    );
  }

  const matches: string[] = [];
  const walk = (node: DocumentNode, parentSegments: string[]): void => {
    if (node.type === "file") {
      if (
        matchesDocumentTitle(node.title, expectedTitle) &&
        node.docSource === expectedSource &&
        typeof node.name === "string" &&
        node.name.trim()
      ) {
        matches.push([...parentSegments, node.name].join("/"));
      }
      return;
    }
    if (node.type !== "folder" || !Array.isArray(node.items)) return;

    const nextSegments =
      node.name === "documents"
        ? parentSegments
        : typeof node.name === "string" && node.name.trim()
          ? [...parentSegments, node.name]
          : parentSegments;
    for (const child of node.items as DocumentNode[]) {
      walk(child, nextSegments);
    }
  }

  walk(root, []);
  if (matches.length > 1) {
    throw new AnythingLlmClientError(
      "ambiguous",
      "AnythingLLM document discovery returned duplicate titles"
    );
  }
  return matches[0] ?? null;
}

function readUploadedDocumentLocation(
  payload: unknown,
  expectedTitle: string,
  expectedSource: string
): string {
  const body = payload as
    | {
        success?: unknown;
        documents?: Array<{
          title?: unknown;
          docSource?: unknown;
          location?: unknown;
        }>;
      }
    | null;
  const document = body?.documents?.[0];
  if (
    body?.success !== true ||
    !matchesDocumentTitle(document?.title, expectedTitle) ||
    document?.docSource !== expectedSource ||
    typeof document.location !== "string" ||
    !document.location.trim()
  ) {
    throw new AnythingLlmClientError(
      "invalid_response",
      "AnythingLLM document upload returned an invalid response"
    );
  }
  return document.location;
}

export class AnythingLlmClient {
  private readonly baseUrl: string;
  private readonly directApiKey: string;
  private readonly apiKeyFile: string;
  private readonly workspaceName: string;
  private readonly expectedWorkspaceSlug: string;
  private readonly sessionId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly readFile: (
    filePath: string,
    encoding: BufferEncoding
  ) => string;
  private cachedApiKey: string | null = null;
  private workspacePromise: Promise<string> | null = null;

  constructor(options: AnythingLlmClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.directApiKey = options.apiKey?.trim() ?? "";
    this.apiKeyFile = options.apiKeyFile?.trim() ?? "";
    this.workspaceName = normalizeRequired(
      options.workspaceName,
      "workspace name"
    );
    this.expectedWorkspaceSlug = normalizeRequired(
      options.workspaceSlug,
      "workspace slug"
    );
    this.sessionId = normalizeRequired(options.sessionId, "session ID");
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.readFile = options.readFile ?? fs.readFileSync;
    if (typeof this.fetchImpl !== "function") {
      throw new AnythingLlmClientError(
        "unavailable",
        "AnythingLLM fetch is unavailable"
      );
    }
  }

  async ingestTextDocument(
    input: AnythingLlmTextDocumentInput
  ): Promise<AnythingLlmIngestResult> {
    const documentName = normalizeRequired(input.documentName, "document name");
    if (
      documentName.includes("/") ||
      documentName.includes("\\") ||
      documentName === "." ||
      documentName === ".."
    ) {
      throw new AnythingLlmClientError(
        "rejected",
        "AnythingLLM document name is invalid"
      );
    }
    if (!input.text.trim()) {
      throw new AnythingLlmClientError(
        "rejected",
        "AnythingLLM document text is required"
      );
    }
    const documentSource = normalizeRequired(
      input.documentSource,
      "document source"
    );
    const knownDocumentLocation =
      input.knownDocumentLocation === undefined ||
      input.knownDocumentLocation === null
        ? null
        : normalizeRequired(
            input.knownDocumentLocation,
            "known document location"
          );

    let workspaceSlug: string;
    try {
      workspaceSlug = await this.ensureWorkspace();
    } catch (error) {
      throw annotateIngestFailure(error, "upload", knownDocumentLocation);
    }
    let documentLocation: string | null;
    try {
      documentLocation = await this.discoverDocument(
        documentName,
        documentSource
      );
    } catch (error) {
      throw annotateIngestFailure(error, "upload", knownDocumentLocation);
    }
    let recoveredUpload = false;
    if (knownDocumentLocation) {
      if (documentLocation !== knownDocumentLocation) {
        throw new AnythingLlmClientError(
          "invalid_response",
          "AnythingLLM known document location did not match discovery",
          {
            stage: "upload",
            documentLocation: knownDocumentLocation,
          }
        );
      }
      documentLocation = knownDocumentLocation;
    } else if (!documentLocation) {
      try {
        const payload = await this.requestJson({
          body: {
            textContent: input.text,
            metadata: {
              title: documentName,
              docSource: documentSource,
              chunkSource: documentSource,
              description: "Untrusted Twitch chat transcript batch",
            },
          },
          method: "POST",
          operation: "document upload",
          path: "/api/v1/document/raw-text",
        });
        documentLocation = readUploadedDocumentLocation(
          payload,
          documentName,
          documentSource
        );
      } catch (uploadError) {
        try {
          documentLocation = await this.discoverDocument(
            documentName,
            documentSource
          );
        } catch (discoveryError) {
          throw annotateIngestFailure(discoveryError, "upload", null);
        }
        if (!documentLocation) {
          throw annotateIngestFailure(uploadError, "upload", null);
        }
        recoveredUpload = true;
      }
    }

    try {
      await this.ensureDocumentEmbedded(workspaceSlug, documentLocation);
    } catch (error) {
      throw annotateIngestFailure(error, "embed", documentLocation);
    }

    return { documentLocation, recoveredUpload };
  }

  async removeTextDocument(
    input: AnythingLlmRemoveTextDocumentInput
  ): Promise<AnythingLlmRemoveTextDocumentResult> {
    const documentName = normalizeRequired(input.documentName, "document name");
    const documentSource = normalizeRequired(
      input.documentSource,
      "document source"
    );
    const documentLocation = normalizeRequired(
      input.knownDocumentLocation,
      "known document location"
    );
    if (
      documentName.includes("/") ||
      documentName.includes("\\") ||
      documentName === "." ||
      documentName === ".."
    ) {
      throw new AnythingLlmClientError(
        "rejected",
        "AnythingLLM document name is invalid",
        { stage: "unembed", documentLocation }
      );
    }

    let workspaceSlug: string;
    try {
      workspaceSlug = await this.ensureWorkspace();
    } catch (error) {
      throw annotateIngestFailure(error, "unembed", documentLocation);
    }

    let discoveredLocation: string | null;
    try {
      discoveredLocation = await this.discoverDocument(
        documentName,
        documentSource
      );
    } catch (error) {
      throw annotateIngestFailure(error, "unembed", documentLocation);
    }
    if (
      discoveredLocation !== null &&
      discoveredLocation !== documentLocation
    ) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM cleanup document location did not match discovery",
        { stage: "unembed", documentLocation }
      );
    }

    try {
      const embeddedCount = await this.countWorkspaceDocument(
        workspaceSlug,
        documentLocation
      );
      if (embeddedCount === 1) {
        const unembedPayload = (await this.requestJson({
          body: { adds: [], deletes: [documentLocation] },
          method: "POST",
          operation: "document unembed",
          path: `/api/v1/workspace/${encodeURIComponent(
            workspaceSlug
          )}/update-embeddings`,
        })) as { workspace?: { slug?: unknown } } | null;
        if (unembedPayload?.workspace?.slug !== workspaceSlug) {
          throw new AnythingLlmClientError(
            "invalid_response",
            "AnythingLLM document unembed returned an invalid response"
          );
        }
      }
      const remainingEmbeddedCount = await this.countWorkspaceDocument(
        workspaceSlug,
        documentLocation
      );
      if (remainingEmbeddedCount !== 0) {
        throw new AnythingLlmClientError(
          "invalid_response",
          "AnythingLLM document unembed was not persisted"
        );
      }
    } catch (error) {
      throw annotateIngestFailure(error, "unembed", documentLocation);
    }

    if (discoveredLocation === null) {
      return { documentLocation, alreadyDeleted: true };
    }

    try {
      const removalPayload = (await this.requestJson({
        body: { names: [documentLocation] },
        method: "DELETE",
        operation: "document source deletion",
        path: "/api/v1/system/remove-documents",
      })) as { success?: unknown } | null;
      if (removalPayload?.success !== true) {
        throw new AnythingLlmClientError(
          "invalid_response",
          "AnythingLLM document source deletion returned an invalid response"
        );
      }
      const remainingLocation = await this.discoverDocument(
        documentName,
        documentSource
      );
      if (remainingLocation !== null) {
        throw new AnythingLlmClientError(
          "invalid_response",
          "AnythingLLM document source deletion was not persisted"
        );
      }
    } catch (error) {
      throw annotateIngestFailure(error, "source_delete", documentLocation);
    }

    return { documentLocation, alreadyDeleted: false };
  }

  async chat(input: AnythingLlmChatInput): Promise<AnythingLlmChatResult> {
    const message = normalizeRequired(input.message, "chat message");
    const sessionId = input.sessionId
      ? normalizeRequired(input.sessionId, "session ID")
      : this.sessionId;
    const workspaceSlug = await this.ensureWorkspace();
    const payload = (await this.requestJson({
      body: {
        message,
        mode: "chat",
        sessionId,
        attachments: [],
        reset: input.reset === true,
      },
      method: "POST",
      operation: "workspace chat",
      path: `/api/v1/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
    })) as
      | {
          type?: unknown;
          textResponse?: unknown;
          sources?: unknown;
          close?: unknown;
          error?: unknown;
        }
      | null;
    if (
      payload?.type !== "textResponse" ||
      typeof payload.textResponse !== "string" ||
      !payload.textResponse.trim() ||
      payload.close !== true ||
      (payload.error !== null && payload.error !== undefined)
    ) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM workspace chat returned an invalid response"
      );
    }
    return {
      reply: payload.textResponse.trim(),
      sourceCount: Array.isArray(payload.sources) ? payload.sources.length : 0,
    };
  }

  private async ensureWorkspace(): Promise<string> {
    if (!this.workspacePromise) {
      this.workspacePromise = this.resolveWorkspace().catch((error) => {
        this.workspacePromise = null;
        throw error;
      });
    }
    return await this.workspacePromise;
  }

  private async resolveWorkspace(): Promise<string> {
    const listPayload = (await this.requestJson({
      operation: "workspace discovery",
      path: "/api/v1/workspaces",
    })) as { workspaces?: WorkspaceRecord[] } | null;
    if (!Array.isArray(listPayload?.workspaces)) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM workspace discovery returned an invalid response"
      );
    }
    const existing = listPayload.workspaces.find(
      (workspace) => workspace.name === this.workspaceName
    );
    if (existing) {
      if (existing.slug !== this.expectedWorkspaceSlug) {
        throw new AnythingLlmClientError(
          "invalid_response",
          "AnythingLLM workspace ownership did not match"
        );
      }
      return this.expectedWorkspaceSlug;
    }

    const createPayload = (await this.requestJson({
      body: {
        name: this.workspaceName,
        chatMode: "chat",
        similarityThreshold: 0.1,
        topN: 8,
      },
      method: "POST",
      operation: "workspace creation",
      path: "/api/v1/workspace/new",
    })) as { workspace?: WorkspaceRecord } | null;
    if (
      createPayload?.workspace?.name !== this.workspaceName ||
      createPayload.workspace.slug !== this.expectedWorkspaceSlug
    ) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM workspace creation returned an invalid response"
      );
    }
    return this.expectedWorkspaceSlug;
  }

  private async discoverDocument(
    documentName: string,
    documentSource: string
  ): Promise<string | null> {
    const payload = await this.requestJson({
      operation: "document discovery",
      path: "/api/v1/documents",
    });
    return findDocumentLocation(payload, documentName, documentSource);
  }

  private async ensureDocumentEmbedded(
    workspaceSlug: string,
    documentLocation: string
  ): Promise<void> {
    const beforeCount = await this.countWorkspaceDocument(
      workspaceSlug,
      documentLocation
    );
    if (beforeCount === 1) return;

    const embeddingPayload = (await this.requestJson({
      body: { adds: [documentLocation], deletes: [] },
      method: "POST",
      operation: "document embedding",
      path: `/api/v1/workspace/${encodeURIComponent(
        workspaceSlug
      )}/update-embeddings`,
    })) as { workspace?: { slug?: unknown } } | null;
    if (embeddingPayload?.workspace?.slug !== workspaceSlug) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM document embedding returned an invalid response"
      );
    }
    const afterCount = await this.countWorkspaceDocument(
      workspaceSlug,
      documentLocation
    );
    if (afterCount !== 1) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM document embedding was not persisted"
      );
    }
  }

  private async countWorkspaceDocument(
    workspaceSlug: string,
    documentLocation: string
  ): Promise<number> {
    const payload = (await this.requestJson({
      operation: "workspace detail",
      path: `/api/v1/workspace/${encodeURIComponent(workspaceSlug)}`,
    })) as
      | {
          workspace?: Array<{
            name?: unknown;
            slug?: unknown;
            documents?: unknown;
          }>;
        }
      | null;
    if (
      !Array.isArray(payload?.workspace) ||
      payload.workspace.length !== 1 ||
      payload.workspace[0]?.name !== this.workspaceName ||
      payload.workspace[0]?.slug !== workspaceSlug ||
      !Array.isArray(payload.workspace[0]?.documents)
    ) {
      throw new AnythingLlmClientError(
        "invalid_response",
        "AnythingLLM workspace detail returned an invalid response"
      );
    }
    const count = (
      payload.workspace[0].documents as Array<{ docpath?: unknown }>
    ).filter((document) => document?.docpath === documentLocation).length;
    if (count > 1) {
      throw new AnythingLlmClientError(
        "ambiguous",
        "AnythingLLM workspace contains duplicate document embeddings"
      );
    }
    return count;
  }

  private readApiKey(): string {
    if (this.cachedApiKey) return this.cachedApiKey;
    let value = this.directApiKey;
    if (!value && this.apiKeyFile) {
      try {
        value = this.readFile(this.apiKeyFile, "utf8").trim();
      } catch {
        throw new AnythingLlmClientError(
          "rejected",
          "AnythingLLM API key file could not be read"
        );
      }
    }
    if (!value) {
      throw new AnythingLlmClientError(
        "rejected",
        "AnythingLLM API key is required"
      );
    }
    this.cachedApiKey = value;
    return value;
  }

  private async requestJson(options: RequestOptions): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.readApiKey()}`,
    };
    let body: RequestInit["body"];
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${options.path}`, {
        body,
        headers,
        method: options.method ?? "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof AnythingLlmClientError) throw error;
      if (isTimeoutError(error)) {
        throw new AnythingLlmClientError(
          "timeout",
          `AnythingLLM ${options.operation} timed out`
        );
      }
      throw new AnythingLlmClientError(
        "unavailable",
        `AnythingLLM ${options.operation} request failed`
      );
    }
    if (!response.ok) {
      const reason: AnythingLlmClientFailureReason =
        response.status >= 500 ? "unavailable" : "rejected";
      throw new AnythingLlmClientError(
        reason,
        `AnythingLLM ${options.operation} failed with HTTP ${response.status}`
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AnythingLlmClientError(
        "invalid_response",
        `AnythingLLM ${options.operation} returned invalid JSON`
      );
    }
  }
}
