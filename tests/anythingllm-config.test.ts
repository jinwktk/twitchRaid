import fs from "node:fs";
import http, {
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  main as runAnythingLlmContractCli,
  runAnythingLlmContract,
} from "../scripts/verify-anythingllm-contract.mjs";

const repoRoot = path.resolve(__dirname, "..");
const composePath = path.join(
  repoRoot,
  "ops/sub-ai-services/docker-compose.yml"
);
const expectedImage =
  "mintplexlabs/anythingllm:1.15.0@sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f";

interface RecordedRequest {
  body: string;
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

function getComposeService(compose: string, serviceName: string): string {
  const lines = compose.replace(/\r\n?/gu, "\n").split("\n");
  const serviceStart = lines.findIndex(
    (line) => line === `  ${serviceName}:`
  );
  if (serviceStart < 0) return "";

  const nextService = lines.findIndex(
    (line, index) =>
      index > serviceStart && /^  [a-zA-Z0-9_-]+:\s*$/u.test(line)
  );
  return lines
    .slice(serviceStart, nextService < 0 ? undefined : nextService)
    .join("\n");
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function withMockAnythingLlm<T>(
  handler: (
    request: RecordedRequest,
    response: ServerResponse
  ) => void | Promise<void>,
  action: (
    baseUrl: string,
    requests: RecordedRequest[]
  ) => Promise<T>
): Promise<T> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const recorded = {
      body: Buffer.concat(chunks).toString("utf8"),
      headers: request.headers,
      method: request.method ?? "",
      url: request.url ?? "",
    };
    requests.push(recorded);

    try {
      await handler(recorded, response);
    } catch {
      response.destroy();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    return await action(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function createContractHandler(options: {
  chatStatus?: number;
  foreignUpload?: boolean;
  foreignWorkspaceCreate?: boolean;
  healthOnline?: boolean;
  malformedUpload?: boolean;
  malformedWorkspaceCreate?: boolean;
}): (
  request: RecordedRequest,
  response: ServerResponse
) => void {
  const documentLocation =
    "custom-documents/anythingllm-contract-probe.txt-fixed.json";
  const marker = "TWITCHRAID_ANYTHINGLLM_CONTRACT_fixed";

  return (request, response) => {
    if (request.method === "GET" && request.url === "/api/ping") {
      sendJson(response, 200, { online: options.healthOnline ?? true });
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/v1/workspace/new"
    ) {
      if (options.malformedWorkspaceCreate) {
        sendJson(response, 200, { workspace: null });
        return;
      }
      if (options.foreignWorkspaceCreate) {
        sendJson(response, 200, {
          workspace: {
            name: "unrelated-workspace",
            slug: "victim-workspace",
          },
          message: "Workspace created",
        });
        return;
      }
      sendJson(response, 200, {
        workspace: {
          name: "twitchraid-contract-fixed",
          slug: "twitchraid-contract-fixed",
        },
        message: "Workspace created",
      });
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/v1/document/upload"
    ) {
      if (options.malformedUpload) {
        sendJson(response, 200, { success: true, documents: [] });
        return;
      }
      if (options.foreignUpload) {
        sendJson(response, 200, {
          success: true,
          error: null,
          documents: [
            {
              location: "custom-documents/victim.json",
              title: "unrelated.txt",
            },
          ],
        });
        return;
      }
      sendJson(response, 200, {
        success: true,
        error: null,
        documents: [
          {
            location: documentLocation,
            title: "anythingllm-contract-fixed.txt",
          },
        ],
      });
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/api/v1/workspaces"
    ) {
      sendJson(response, 200, {
        workspaces: options.foreignWorkspaceCreate
          ? []
          : [
              {
                name: "twitchraid-contract-fixed",
                slug: "twitchraid-contract-fixed",
              },
            ],
      });
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/api/v1/documents"
    ) {
      sendJson(response, 200, {
        localFiles: {
          name: "documents",
          type: "folder",
          items: options.foreignUpload
            ? []
            : [
                {
                  name: "custom-documents",
                  type: "folder",
                  items: [
                    {
                      name: "anythingllm-contract-probe.txt-fixed.json",
                      title: "anythingllm-contract-fixed.txt",
                      type: "file",
                    },
                  ],
                },
              ],
        },
      });
      return;
    }
    if (
      options.foreignWorkspaceCreate &&
      request.method === "POST" &&
      request.url === "/api/v1/workspace/victim-workspace/update-embeddings"
    ) {
      sendJson(response, 200, {
        workspace: { slug: "victim-workspace" },
      });
      return;
    }
    if (
      options.foreignWorkspaceCreate &&
      request.method === "POST" &&
      request.url === "/api/v1/workspace/victim-workspace/chat"
    ) {
      sendJson(response, 200, {
        type: "textResponse",
        textResponse: marker,
        sources: [{ title: "anythingllm-contract-probe.txt" }],
      });
      return;
    }
    if (
      request.method === "POST" &&
      request.url ===
        "/api/v1/workspace/twitchraid-contract-fixed/update-embeddings"
    ) {
      sendJson(response, 200, {
        workspace: { slug: "twitchraid-contract-fixed" },
      });
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/api/v1/workspace/twitchraid-contract-fixed/chat"
    ) {
      if (options.chatStatus === 500) {
        sendJson(response, 500, {
          error: "server-secret-response-body",
        });
        return;
      }
      sendJson(response, 200, {
        id: "chat-fixed",
        type: "textResponse",
        textResponse: marker,
        sources: [{ title: "anythingllm-contract-probe.txt" }],
        close: true,
        error: null,
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      request.url === "/api/v1/system/remove-documents"
    ) {
      sendJson(response, 200, {
        success: true,
        message: "Documents removed successfully",
      });
      return;
    }
    if (
      request.method === "DELETE" &&
      request.url === "/api/v1/workspace/twitchraid-contract-fixed"
    ) {
      response.writeHead(200);
      response.end();
      return;
    }
    if (
      options.foreignWorkspaceCreate &&
      request.method === "DELETE" &&
      request.url === "/api/v1/workspace/victim-workspace"
    ) {
      response.writeHead(200);
      response.end();
      return;
    }

    sendJson(response, 404, { error: "unexpected request" });
  };
}

describe("AnythingLLM isolated PoC config", () => {
  it("pins the existing AnythingLLM 1.15.0 image tag and digest", () => {
    const compose = fs.readFileSync(composePath, "utf8");
    const anythingllm = getComposeService(compose, "anythingllm");

    expect(anythingllm).toContain(`image: ${expectedImage}`);
    expect(anythingllm).not.toContain("mintplexlabs/anythingllm:v1.15.0");
    expect(anythingllm).not.toContain("mintplexlabs/anythingllm:latest");
  });

  it("publishes the authenticated AnythingLLM UI through the LAN gateway while reusing SUB AI services", () => {
    const compose = fs.readFileSync(composePath, "utf8");
    const anythingllm = getComposeService(compose, "anythingllm");

    expect(anythingllm).not.toBe("");
    expect(anythingllm).toMatch(/^\s+ports:/mu);
    expect(anythingllm).toContain("target: 3001");
    expect(anythingllm).toContain("published: 3220");
    expect(anythingllm).toContain("mode: host");
    expect(anythingllm).toContain(
      "/home/mlove/dokploy/anythingllm/storage:/app/server/storage"
    );
    expect(anythingllm).toContain("LLM_PROVIDER: ollama");
    expect(anythingllm).toContain(
      "OLLAMA_BASE_PATH: http://ollama:11434"
    );
    expect(anythingllm).toContain("OLLAMA_MODEL_PREF: gemma4:e4b-it-qat");
    expect(anythingllm).toContain('OLLAMA_RESPONSE_TIMEOUT: "180000"');
    expect(anythingllm).toContain("EMBEDDING_ENGINE: ollama");
    expect(anythingllm).toContain(
      "EMBEDDING_BASE_PATH: http://ollama:11434"
    );
    expect(anythingllm).toContain(
      "EMBEDDING_MODEL_PREF: nomic-embed-text:latest"
    );
    expect(anythingllm).toContain("VECTOR_DB: qdrant");
    expect(anythingllm).toContain("QDRANT_ENDPOINT: http://qdrant:6333");
    expect(anythingllm).toContain(
      "AGENT_SEARXNG_API_URL: http://searxng:8080"
    );
    expect(anythingllm).toContain('AGENT_MAX_TOOL_CALLS: "5"');
    expect(anythingllm).toContain(
      "ANYTHINGLLM_CHROMIUM_ARGS: --no-sandbox,--disable-setuid-sandbox"
    );
    expect(anythingllm).toContain('DISABLE_TELEMETRY: "true"');
    expect(anythingllm).toContain('DISABLE_SWAGGER_DOCS: "true"');
    expect(anythingllm).toContain("- anythingllm");
    expect(anythingllm).toContain("update_config:");
    expect(anythingllm).toContain("order: stop-first");
  });

  it("loads authentication secrets only from the protected host env file", () => {
    const compose = fs.readFileSync(composePath, "utf8");
    const anythingllm = getComposeService(compose, "anythingllm");

    expect(anythingllm).toContain(
      "/home/mlove/dokploy/anythingllm/.env:/app/server/.env"
    );
    expect(anythingllm).not.toMatch(
      /^\s+(?:AUTH_TOKEN|JWT_SECRET|SIG_KEY|SIG_SALT):/mu
    );
    expect(anythingllm).not.toContain("ANYTHING_LLM_AUTH_TOKEN");
    expect(anythingllm).not.toContain("ANYTHING_LLM_JWT_SECRET");
    expect(anythingllm).not.toContain("ANYTHING_LLM_SIG_KEY");
    expect(anythingllm).not.toContain("ANYTHING_LLM_SIG_SALT");
    expect(anythingllm).not.toContain("ANYTHING_LLM_API_KEY:");
    expect(anythingllm).not.toMatch(/\b(?:sk-|hunter2|password123)\S*/u);
  });

  it("bootstraps the protected env file without printing generated secrets", () => {
    const bootstrap = fs
      .readFileSync(
        path.join(repoRoot, "scripts/bootstrap-anythingllm-poc-remote.sh"),
        "utf8"
      )
      .replace(/\r\n?/gu, "\n");
    const secretWriteStart = bootstrap.indexOf("printf '%s\\n' \\");
    const secretWriteRedirect = bootstrap.indexOf(
      '>\"${env_file}\"',
      secretWriteStart
    );

    expect(bootstrap).toContain("set -euo pipefail");
    expect(bootstrap).toContain("umask 077");
    expect(bootstrap).toContain(
      'api_dir="${storage_root}/api"'
    );
    expect(bootstrap).toContain(
      'install -d -m 700 "${storage_root}" "${storage_dir}" "${api_dir}"'
    );
    expect(bootstrap.match(/openssl rand -hex 32/gu)).toHaveLength(4);
    expect(secretWriteStart).toBeGreaterThan(-1);
    expect(secretWriteRedirect).toBeGreaterThan(secretWriteStart);
    expect(bootstrap).toContain('chmod 600 "${env_file}"');
    expect(bootstrap).not.toContain("set -x");
    expect(bootstrap).not.toMatch(
      /\b(?:cat|echo)\s+.*\$\{?(?:auth_token|jwt_secret|sig_key|sig_salt)\}?/u
    );
    expect(bootstrap).toContain(
      "printf 'AnythingLLM PoC storage and authentication file are ready.\\n'"
    );
  });

  it("deploys the isolated service with the same AnythingLLM name and runtime contract", () => {
    const deploy = fs
      .readFileSync(
        path.join(repoRoot, "scripts/deploy-anythingllm-poc-remote.sh"),
        "utf8"
      )
      .replace(/\r\n?/gu, "\n");

    expect(deploy).toContain(
      'service_name="${ANYTHING_LLM_SERVICE_NAME:-anythingllm}"'
    );
    expect(deploy).toContain(`image="${expectedImage}"`);
    expect(deploy).toContain('--name "${service_name}"');
    expect(deploy).toContain(
      "--network name=dokploy-network,alias=anythingllm"
    );
    expect(deploy).toContain(
      '--mount "type=bind,source=${storage_dir},target=/app/server/storage"'
    );
    expect(deploy).toContain(
      '--mount "type=bind,source=${env_file},target=/app/server/.env"'
    );
    expect(deploy).toContain("--env LLM_PROVIDER=ollama");
    expect(deploy).toContain(
      "--env OLLAMA_BASE_PATH=http://ollama:11434"
    );
    expect(deploy).toContain("--env VECTOR_DB=qdrant");
    expect(deploy).toContain(
      "--env AGENT_SEARXNG_API_URL=http://searxng:8080"
    );
    expect(deploy).toContain("--update-order stop-first");
    expect(deploy).toContain("--update-failure-action rollback");
    expect(deploy).toContain(
      '--publish-add "published=${lan_ui_port},target=3001,protocol=tcp,mode=host"'
    );
    expect(deploy).not.toMatch(
      /--env (?:AUTH_TOKEN|JWT_SECRET|SIG_KEY|SIG_SALT|ANYTHING_LLM_API_KEY)=/u
    );
  });
});

describe("AnythingLLM contract probe", () => {
  it("fails closed before any request when the API key is absent", async () => {
    await withMockAnythingLlm(
      createContractHandler({}),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow(
          "ANYTHING_LLM_API_KEY or ANYTHING_LLM_API_KEY_FILE is required"
        );
        expect(requests).toEqual([]);
      }
    );
  });

  it("does not accept a 2xx health response when AnythingLLM reports offline", async () => {
    await withMockAnythingLlm(
      createContractHandler({ healthOnline: false }),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow("health check returned an invalid response");
        expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
          "GET /api/ping",
        ]);
      }
    );
  });

  it("uploads, embeds, chats, and removes every probe resource", async () => {
    await withMockAnythingLlm(
      createContractHandler({}),
      async (baseUrl, requests) => {
        const result = await runAnythingLlmContract({
          apiKey: "test-only-api-key",
          baseUrl,
          probeId: "fixed",
        });

        expect(result).toMatchObject({
          status: "passed",
          checks: {
            health: true,
            workspaceCreated: true,
            documentUploaded: true,
            documentEmbedded: true,
            workspaceChat: true,
            documentUnembedded: true,
            documentDeleted: true,
            workspaceDeleted: true,
          },
        });
        expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
          "GET /api/ping",
          "POST /api/v1/workspace/new",
          "POST /api/v1/document/upload",
          "POST /api/v1/workspace/twitchraid-contract-fixed/update-embeddings",
          "POST /api/v1/workspace/twitchraid-contract-fixed/chat",
          "POST /api/v1/workspace/twitchraid-contract-fixed/update-embeddings",
          "DELETE /api/v1/system/remove-documents",
          "DELETE /api/v1/workspace/twitchraid-contract-fixed",
        ]);

        for (const request of requests.slice(1)) {
          expect(request.headers.authorization).toBe(
            "Bearer test-only-api-key"
          );
        }
        expect(requests[2]?.headers["content-type"]).toContain(
          "multipart/form-data; boundary="
        );
        expect(requests[2]?.body).toContain(
          "TWITCHRAID_ANYTHINGLLM_CONTRACT_fixed"
        );
        expect(JSON.parse(requests[3]?.body ?? "{}")).toEqual({
          adds: [
            "custom-documents/anythingllm-contract-probe.txt-fixed.json",
          ],
          deletes: [],
        });
        expect(JSON.parse(requests[4]?.body ?? "{}")).toMatchObject({
          mode: "query",
          sessionId: "anythingllm-contract-fixed",
        });
        expect(JSON.parse(requests[5]?.body ?? "{}")).toEqual({
          adds: [],
          deletes: [
            "custom-documents/anythingllm-contract-probe.txt-fixed.json",
          ],
        });
        expect(JSON.parse(requests[6]?.body ?? "{}")).toEqual({
          names: [
            "custom-documents/anythingllm-contract-probe.txt-fixed.json",
          ],
        });
      }
    );
  });

  it("cleans up after chat failure without exposing credentials or response bodies", async () => {
    await withMockAnythingLlm(
      createContractHandler({ chatStatus: 500 }),
      async (baseUrl, requests) => {
        let failureMessage = "";
        try {
          await runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          });
        } catch (error) {
          failureMessage =
            error instanceof Error ? error.message : String(error);
        }

        expect(failureMessage).toContain(
          "workspace chat failed with HTTP 500"
        );
        expect(failureMessage).not.toContain("test-only-api-key");
        expect(failureMessage).not.toContain("server-secret-response-body");
        expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
          "GET /api/ping",
          "POST /api/v1/workspace/new",
          "POST /api/v1/document/upload",
          "POST /api/v1/workspace/twitchraid-contract-fixed/update-embeddings",
          "POST /api/v1/workspace/twitchraid-contract-fixed/chat",
          "POST /api/v1/workspace/twitchraid-contract-fixed/update-embeddings",
          "DELETE /api/v1/system/remove-documents",
          "DELETE /api/v1/workspace/twitchraid-contract-fixed",
        ]);
      }
    );
  });

  it("rediscovers and deletes a workspace after a malformed create response", async () => {
    await withMockAnythingLlm(
      createContractHandler({ malformedWorkspaceCreate: true }),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow(
          "workspace creation returned an invalid response"
        );

        expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
          "GET /api/ping",
          "POST /api/v1/workspace/new",
          "GET /api/v1/workspaces",
          "DELETE /api/v1/workspace/twitchraid-contract-fixed",
        ]);
      }
    );
  });

  it("rediscovers and deletes a document after a malformed upload response", async () => {
    await withMockAnythingLlm(
      createContractHandler({ malformedUpload: true }),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow("document upload returned an invalid response");

        expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
          "GET /api/ping",
          "POST /api/v1/workspace/new",
          "POST /api/v1/document/upload",
          "GET /api/v1/documents",
          "POST /api/v1/workspace/twitchraid-contract-fixed/update-embeddings",
          "DELETE /api/v1/system/remove-documents",
          "DELETE /api/v1/workspace/twitchraid-contract-fixed",
        ]);
        expect(JSON.parse(requests[5]?.body ?? "{}")).toEqual({
          names: [
            "custom-documents/anythingllm-contract-probe.txt-fixed.json",
          ],
        });
      }
    );
  });

  it("never trusts or deletes a workspace returned for a different name", async () => {
    await withMockAnythingLlm(
      createContractHandler({ foreignWorkspaceCreate: true }),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow(
          "workspace creation returned an invalid response"
        );

        expect(requests.map(({ url }) => url)).not.toContain(
          "/api/v1/workspace/victim-workspace/update-embeddings"
        );
        expect(requests.map(({ url }) => url)).not.toContain(
          "/api/v1/workspace/victim-workspace/chat"
        );
        expect(requests.map(({ url }) => url)).not.toContain(
          "/api/v1/workspace/victim-workspace"
        );
      }
    );
  });

  it("never trusts or deletes a document returned for a different title", async () => {
    await withMockAnythingLlm(
      createContractHandler({ foreignUpload: true }),
      async (baseUrl, requests) => {
        await expect(
          runAnythingLlmContract({
            apiKey: "test-only-api-key",
            baseUrl,
            probeId: "fixed",
          })
        ).rejects.toThrow("document upload returned an invalid response");

        const deletionBodies = requests
          .filter(
            ({ method, url }) =>
              method === "DELETE" &&
              url === "/api/v1/system/remove-documents"
          )
          .map(({ body }) => body);
        expect(deletionBodies).not.toContain(
          JSON.stringify({
            names: ["custom-documents/victim.json"],
          })
        );
      }
    );
  });

  it("exposes the probe as an npm script", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    );

    expect(packageJson.scripts["contract:anythingllm"]).toBe(
      "node scripts/verify-anythingllm-contract.mjs"
    );
  });

  it("reads and trims the API key from a raw secret file without printing it", async () => {
    const secret = "file-only-api-key";
    let receivedApiKey = "";
    let stdout = "";

    await runAnythingLlmContractCli(
      {
        ANYTHING_LLM_API_KEY_FILE:
          "/home/mlove/dokploy/anythingllm/api/api-key",
      },
      {
        readFile: async (filePath: string, encoding: string) => {
          expect(filePath).toBe(
            "/home/mlove/dokploy/anythingllm/api/api-key"
          );
          expect(encoding).toBe("utf8");
          return `  ${secret}\r\n`;
        },
        runContract: async ({ apiKey }: { apiKey: string }) => {
          receivedApiKey = apiKey;
          return { status: "passed", checks: { health: true } };
        },
        writeStdout: (chunk: string) => {
          stdout += chunk;
        },
      }
    );

    expect(receivedApiKey).toBe(secret);
    expect(stdout).toBe(
      `${JSON.stringify({
        status: "passed",
        checks: { health: true },
      })}\n`
    );
    expect(stdout).not.toContain(secret);
  });

  it("prefers the direct API key without reading the configured file", async () => {
    let receivedApiKey = "";
    let readCount = 0;

    await runAnythingLlmContractCli(
      {
        ANYTHING_LLM_API_KEY: " direct-api-key ",
        ANYTHING_LLM_API_KEY_FILE: "/should/not/be/read",
      },
      {
        readFile: async () => {
          readCount += 1;
          return "file-api-key";
        },
        runContract: async ({ apiKey }: { apiKey: string }) => {
          receivedApiKey = apiKey;
          return { status: "passed", checks: { health: true } };
        },
        writeStdout: () => undefined,
      }
    );

    expect(receivedApiKey).toBe("direct-api-key");
    expect(readCount).toBe(0);
  });

  it("does not expose a file API key when the contract fails", async () => {
    const secret = "file-api-key-that-must-stay-private";
    let stdout = "";
    let failure: unknown;

    try {
      await runAnythingLlmContractCli(
        {
          ANYTHING_LLM_API_KEY_FILE:
            "/home/mlove/dokploy/anythingllm/api/api-key",
        },
        {
          readFile: async () => secret,
          runContract: async ({ apiKey }: { apiKey: string }) => {
            expect(apiKey).toBe(secret);
            throw new Error("workspace chat failed with HTTP 500");
          },
          writeStdout: (chunk: string) => {
            stdout += chunk;
          },
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "workspace chat failed with HTTP 500"
    );
    expect((failure as Error).message).not.toContain(secret);
    expect(stdout).not.toContain(secret);
  });

  it("does not invoke the contract when neither API key source is configured", async () => {
    let contractCalls = 0;

    await expect(
      runAnythingLlmContractCli(
        {},
        {
          runContract: async () => {
            contractCalls += 1;
            return { status: "passed", checks: { health: true } };
          },
          writeStdout: () => undefined,
        }
      )
    ).rejects.toThrow(
      "ANYTHING_LLM_API_KEY or ANYTHING_LLM_API_KEY_FILE is required"
    );
    expect(contractCalls).toBe(0);
  });
});
