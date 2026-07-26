import { describe, expect, it, vi } from "vitest";
import {
  AnythingLlmClient,
  AnythingLlmClientError,
} from "../../src/commands/anythingllm-client";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestPath(input: string | URL | Request): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(raw).pathname;
}

describe("AnythingLlmClient", () => {
  it("synchronizes the configured workspace system prompt before chatting", async () => {
    const requests: string[] = [];
    let workspacePrompt = "old prompt";
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        requests.push(pathname);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{
              name: "Twitch rukalun",
              slug: "twitch-rukalun",
              openAiPrompt: workspacePrompt,
            }],
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun/update") {
          const body = JSON.parse(String(init?.body)) as { openAiPrompt: string };
          workspacePrompt = body.openAiPrompt;
          return jsonResponse({
            workspace: {
              name: "Twitch rukalun",
              slug: "twitch-rukalun",
              openAiPrompt: workspacePrompt,
            },
            message: null,
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun/chat") {
          return jsonResponse({
            type: "textResponse",
            textResponse: "具体的に答えるD！",
            sources: [],
            close: true,
            error: null,
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      workspaceSystemPrompt: "retrieved documents must be used",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(client.chat({ message: "dynamic question" })).resolves.toEqual({
      reply: "具体的に答えるD！",
      sourceCount: 0,
    });
    expect(workspacePrompt).toBe("retrieved documents must be used");
    expect(requests).toEqual([
      "/api/v1/workspaces",
      "/api/v1/workspace/twitch-rukalun/update",
      "/api/v1/workspace/twitch-rukalun/chat",
    ]);
  });

  it("accepts AnythingLLM adding .txt to an extensionless batch title", async () => {
    const documentLocation =
      "custom-documents/raw-twitch-comments-1-1-probe.json";
    let uploaded = false;
    let embedded = false;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: uploaded
                ? [{
                    type: "file",
                    title: "twitch-comments-1-1-probe.txt",
                    docSource: "twitchraid://batch/extensionless",
                    name: documentLocation,
                  }]
                : [],
            },
          });
        }
        if (pathname === "/api/v1/document/raw-text") {
          uploaded = true;
          return jsonResponse({
            success: true,
            documents: [{
              title: "twitch-comments-1-1-probe.txt",
              docSource: "twitchraid://batch/extensionless",
              location: documentLocation,
            }],
          });
        }
        if (pathname.endsWith("/update-embeddings")) {
          embedded = true;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [{
              name: "Twitch rukalun",
              slug: "twitch-rukalun",
              documents: embedded ? [{ docpath: documentLocation }] : [],
            }],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(client.ingestTextDocument({
      documentName: "twitch-comments-1-1-probe",
      documentSource: "twitchraid://batch/extensionless",
      text: "untrusted synthetic comment",
    })).resolves.toEqual({ documentLocation, recoveredUpload: false });
  });

  it("recovers an existing .txt-normalized document without uploading it again", async () => {
    const documentLocation =
      "custom-documents/raw-twitch-comments-2-2-existing.json";
    let embedded = false;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [{
                type: "file",
                title: "twitch-comments-2-2-existing.txt",
                docSource: "twitchraid://batch/existing-extensionless",
                name: documentLocation,
              }],
            },
          });
        }
        if (pathname === "/api/v1/document/raw-text") {
          return jsonResponse({ error: "must not upload" }, 500);
        }
        if (pathname.endsWith("/update-embeddings")) {
          embedded = true;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [{
              name: "Twitch rukalun",
              slug: "twitch-rukalun",
              documents: embedded ? [{ docpath: documentLocation }] : [],
            }],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(client.ingestTextDocument({
      documentName: "twitch-comments-2-2-existing",
      documentSource: "twitchraid://batch/existing-extensionless",
      text: "untrusted existing synthetic comment",
    })).resolves.toEqual({ documentLocation, recoveredUpload: false });
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        requestPath(input) === "/api/v1/document/raw-text"
      )
    ).toBe(false);
  });

  it("reconciles a lost upload response by stable document title before embedding", async () => {
    const documentLocation =
      "custom-documents/twitch-comment-stable-message.json";
    let uploaded = false;
    let embedded = false;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: uploaded
                ? [
                    {
                      type: "file",
                      title: "twitch-comment-stable-message.txt",
                      docSource: "twitchraid://batch/stable-message",
                      name: documentLocation,
                    },
                  ]
                : [],
            },
          });
        }
        if (pathname === "/api/v1/document/raw-text") {
          expect(JSON.parse(String(init?.body))).toEqual({
            textContent: "untrusted synthetic comment",
            metadata: {
              title: "twitch-comment-stable-message.txt",
              docSource: "twitchraid://batch/stable-message",
              chunkSource: "twitchraid://batch/stable-message",
              description: "Untrusted Twitch chat transcript batch",
            },
          });
          uploaded = true;
          throw new TypeError("socket closed after server commit");
        }
        if (
          pathname ===
          "/api/v1/workspace/twitch-rukalun/update-embeddings"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            adds: [documentLocation],
            deletes: [],
          });
          embedded = true;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: embedded ? [{ docpath: documentLocation }] : [],
              },
            ],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.ingestTextDocument({
        documentName: "twitch-comment-stable-message.txt",
        documentSource: "twitchraid://batch/stable-message",
        text: "untrusted synthetic comment",
      })
    ).resolves.toEqual({
      documentLocation,
      recoveredUpload: true,
    });

    expect(
      fetchImpl.mock.calls.filter(
        ([input]) => requestPath(input) === "/api/v1/document/raw-text"
      )
    ).toHaveLength(1);
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toHaveLength(1);
  });

  it("resumes embedding from a known exact document location without uploading again", async () => {
    const documentLocation =
      "custom-documents/twitch-comment-known-location.json";
    let embedded = false;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [
                {
                  type: "file",
                  title: "twitch-comment-known-location.txt",
                  docSource: "twitchraid://batch/known-location",
                  name: documentLocation,
                },
              ],
            },
          });
        }
        if (
          pathname ===
          "/api/v1/workspace/twitch-rukalun/update-embeddings"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            adds: [documentLocation],
            deletes: [],
          });
          embedded = true;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: embedded ? [{ docpath: documentLocation }] : [],
              },
            ],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.ingestTextDocument({
        documentName: "twitch-comment-known-location.txt",
        documentSource: "twitchraid://batch/known-location",
        text: "untrusted synthetic comment",
        knownDocumentLocation: documentLocation,
      })
    ).resolves.toEqual({
      documentLocation,
      recoveredUpload: false,
    });

    expect(
      fetchImpl.mock.calls.filter(
        ([input]) => requestPath(input) === "/api/v1/document/raw-text"
      )
    ).toHaveLength(0);
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toHaveLength(1);
  });

  it("fails closed when a known document location does not match exact discovery", async () => {
    const knownDocumentLocation =
      "custom-documents/twitch-comment-known-location.json";
    const discoveredDocumentLocation =
      "custom-documents/twitch-comment-foreign-location.json";
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [
                {
                  type: "file",
                  title: "twitch-comment-known-location.txt",
                  docSource: "twitchraid://batch/known-location",
                  name: discoveredDocumentLocation,
                },
              ],
            },
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.ingestTextDocument({
        documentName: "twitch-comment-known-location.txt",
        documentSource: "twitchraid://batch/known-location",
        text: "untrusted synthetic comment",
        knownDocumentLocation,
      })
    ).rejects.toMatchObject({
      reason: "invalid_response",
      stage: "upload",
      documentLocation: knownDocumentLocation,
    });
    expect(
      fetchImpl.mock.calls.some(
        ([input]) => requestPath(input) === "/api/v1/document/raw-text"
      )
    ).toBe(false);
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toBe(false);
  });

  it("uses the stable channel session for workspace chat without calling Ollama directly", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        requests.push({
          path: pathname,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun/chat") {
          return jsonResponse({
            id: "chat-1",
            type: "textResponse",
            textResponse: "さっきはマグロの話をしていたD！",
            sources: [{ title: "twitch-comment-stable-message.txt" }],
            close: true,
            error: null,
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.chat({ message: "さっき何の話？", reset: true })
    ).resolves.toMatchObject({
      reply: "さっきはマグロの話をしていたD！",
      sourceCount: 1,
    });
    expect(requests.at(-1)).toEqual({
      path: "/api/v1/workspace/twitch-rukalun/chat",
      body: {
        message: "さっき何の話？",
        mode: "chat",
        sessionId: "twitch-rukalun",
        attachments: [],
        reset: true,
      },
    });
    expect(requests.some(({ path }) => path === "/api/generate")).toBe(false);
  });

  it("rejects a workspace response owned by another configured name", async () => {
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({ workspaces: [] });
        }
        if (pathname === "/api/v1/workspace/new") {
          return jsonResponse({
            workspace: { name: "Victim workspace", slug: "victim-workspace" },
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(client.chat({ message: "こんにちは" })).rejects.toMatchObject({
      reason: "invalid_response",
    });
    expect(
      fetchImpl.mock.calls.some(
        ([input]) =>
          requestPath(input) === "/api/v1/workspace/victim-workspace/chat"
      )
    ).toBe(false);
  });

  it("classifies HTTP failures without exposing credentials or response bodies", async () => {
    const apiKey = "api-key-that-must-not-leak";
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "private-upstream-detail" }, 503)
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey,
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    let failure: unknown;
    try {
      await client.chat({ message: "こんにちは" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AnythingLlmClientError);
    expect(failure).toMatchObject({ reason: "unavailable" });
    expect(String(failure)).not.toContain(apiKey);
    expect(String(failure)).not.toContain("private-upstream-detail");
  });

  it("rejects an HTTP 200 embed response when the workspace has no exact document", async () => {
    const documentLocation = "custom-documents/missing-after-embed.json";
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [
                {
                  type: "file",
                  title: "twitch-comment-stable-message.txt",
                  docSource: "twitchraid://batch/stable-message",
                  name: documentLocation,
                },
              ],
            },
          });
        }
        if (
          pathname ===
          "/api/v1/workspace/twitch-rukalun/update-embeddings"
        ) {
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: [],
              },
            ],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.ingestTextDocument({
        documentName: "twitch-comment-stable-message.txt",
        documentSource: "twitchraid://batch/stable-message",
        text: "untrusted synthetic comment",
      })
    ).rejects.toMatchObject({
      reason: "invalid_response",
      stage: "embed",
      documentLocation,
    });
  });

  it("removes only the exact ledger-owned location in unembed, source-delete, verification order", async () => {
    const documentName = "twitch-comments-retention-batch.txt";
    const documentSource = "twitchraid://batch/retention-batch";
    const documentLocation =
      "custom-documents/twitch-comments-retention-batch.json";
    let embedded = true;
    let sourceExists = true;
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        calls.push({
          method: init?.method ?? "GET",
          path: pathname,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: sourceExists
                ? [
                    {
                      type: "file",
                      title: documentName,
                      docSource: documentSource,
                      name: documentLocation,
                    },
                  ]
                : [],
            },
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: embedded ? [{ docpath: documentLocation }] : [],
              },
            ],
          });
        }
        if (
          pathname ===
          "/api/v1/workspace/twitch-rukalun/update-embeddings"
        ) {
          expect(JSON.parse(String(init?.body))).toEqual({
            adds: [],
            deletes: [documentLocation],
          });
          embedded = false;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/system/remove-documents") {
          expect(init?.method).toBe("DELETE");
          expect(JSON.parse(String(init?.body))).toEqual({
            names: [documentLocation],
          });
          sourceExists = false;
          return jsonResponse({ success: true });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.removeTextDocument({
        documentName,
        documentSource,
        knownDocumentLocation: documentLocation,
      })
    ).resolves.toEqual({
      documentLocation,
      alreadyDeleted: false,
    });

    expect(
      calls.map(({ method, path }) => `${method} ${path}`)
    ).toEqual([
      "GET /api/v1/workspaces",
      "GET /api/v1/documents",
      "GET /api/v1/workspace/twitch-rukalun",
      "POST /api/v1/workspace/twitch-rukalun/update-embeddings",
      "GET /api/v1/workspace/twitch-rukalun",
      "DELETE /api/v1/system/remove-documents",
      "GET /api/v1/documents",
    ]);
  });

  it("treats an already removed exact document as an idempotent cleanup success", async () => {
    const documentLocation = "custom-documents/already-removed.json";
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [],
            },
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: [],
              },
            ],
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.removeTextDocument({
        documentName: "already-removed.txt",
        documentSource: "twitchraid://batch/already-removed",
        knownDocumentLocation: documentLocation,
      })
    ).resolves.toEqual({
      documentLocation,
      alreadyDeleted: true,
    });
    expect(
      fetchImpl.mock.calls.some(
        ([input]) => requestPath(input) === "/api/v1/system/remove-documents"
      )
    ).toBe(false);
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toBe(false);
  });

  it("returns a safe source-delete stage after partial cleanup and can resume", async () => {
    const documentName = "partial-cleanup.txt";
    const documentSource = "twitchraid://batch/partial-cleanup";
    const documentLocation = "custom-documents/partial-cleanup.json";
    let embedded = true;
    let sourceExists = true;
    let deletionAttempts = 0;
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: sourceExists
                ? [
                    {
                      type: "file",
                      title: documentName,
                      docSource: documentSource,
                      name: documentLocation,
                    },
                  ]
                : [],
            },
          });
        }
        if (pathname === "/api/v1/workspace/twitch-rukalun") {
          return jsonResponse({
            workspace: [
              {
                name: "Twitch rukalun",
                slug: "twitch-rukalun",
                documents: embedded ? [{ docpath: documentLocation }] : [],
              },
            ],
          });
        }
        if (
          pathname ===
          "/api/v1/workspace/twitch-rukalun/update-embeddings"
        ) {
          embedded = false;
          return jsonResponse({ workspace: { slug: "twitch-rukalun" } });
        }
        if (pathname === "/api/v1/system/remove-documents") {
          deletionAttempts += 1;
          if (deletionAttempts === 1) {
            return jsonResponse({ error: "private deletion detail" }, 503);
          }
          sourceExists = false;
          return jsonResponse({ success: true });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });
    const input = {
      documentName,
      documentSource,
      knownDocumentLocation: documentLocation,
    };

    let failure: unknown;
    try {
      await client.removeTextDocument(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      reason: "unavailable",
      stage: "source_delete",
      documentLocation,
    });
    expect(String(failure)).not.toContain("private deletion detail");

    await expect(client.removeTextDocument(input)).resolves.toEqual({
      documentLocation,
      alreadyDeleted: false,
    });
    expect(
      fetchImpl.mock.calls.filter(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toHaveLength(1);
    expect(deletionAttempts).toBe(2);
  });

  it("fails closed before remote cleanup when exact discovery belongs to another location", async () => {
    const knownDocumentLocation = "custom-documents/ledger-owned.json";
    const fetchImpl = vi.fn(
      async (input: string | URL | Request) => {
        const pathname = requestPath(input);
        if (pathname === "/api/v1/workspaces") {
          return jsonResponse({
            workspaces: [{ name: "Twitch rukalun", slug: "twitch-rukalun" }],
          });
        }
        if (pathname === "/api/v1/documents") {
          return jsonResponse({
            localFiles: {
              type: "folder",
              name: "documents",
              items: [
                {
                  type: "file",
                  title: "owned.txt",
                  docSource: "twitchraid://batch/owned",
                  name: "custom-documents/foreign.json",
                },
              ],
            },
          });
        }
        return jsonResponse({ error: "unexpected" }, 404);
      }
    );
    const client = new AnythingLlmClient({
      baseUrl: "http://anythingllm:3001",
      apiKey: "test-only-api-key",
      workspaceName: "Twitch rukalun",
      workspaceSlug: "twitch-rukalun",
      sessionId: "twitch-rukalun",
      timeoutMs: 3000,
      fetchImpl,
    });

    await expect(
      client.removeTextDocument({
        documentName: "owned.txt",
        documentSource: "twitchraid://batch/owned",
        knownDocumentLocation,
      })
    ).rejects.toMatchObject({
      reason: "invalid_response",
      stage: "unembed",
      documentLocation: knownDocumentLocation,
    });
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        requestPath(input).endsWith("/update-embeddings")
      )
    ).toBe(false);
    expect(
      fetchImpl.mock.calls.some(
        ([input]) => requestPath(input) === "/api/v1/system/remove-documents"
      )
    ).toBe(false);
  });
});
