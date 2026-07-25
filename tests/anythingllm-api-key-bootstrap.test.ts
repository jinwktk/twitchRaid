import http, { type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  createAnythingLlmApiKey,
  main,
  prepareExistingApiKeyFile,
  writeSecretFileAtomically,
} from "../scripts/bootstrap-anythingllm-api-key.mjs";

interface RecordedRequest {
  body: string;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
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
  action: (baseUrl: string, requests: RecordedRequest[]) => Promise<T>,
  options: {
    apiKeyId?: number | string;
    apiKeySecret?: string;
    sessionToken?: string;
  } = {}
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

    if (
      recorded.method === "POST" &&
      recorded.url === "/api/request-token"
    ) {
      sendJson(response, 200, {
        valid: true,
        token:
          options.sessionToken ??
          "session-token-that-must-not-be-logged",
      });
      return;
    }
    if (
      recorded.method === "POST" &&
      recorded.url === "/api/system/generate-api-key"
    ) {
      sendJson(response, 200, {
        apiKey: {
          id: options.apiKeyId ?? 7,
          secret:
            options.apiKeySecret ??
            "api-key-that-must-not-be-logged",
        },
        error: null,
      });
      return;
    }
    if (
      recorded.method === "DELETE" &&
      recorded.url === "/api/system/api-key/7"
    ) {
      sendJson(response, 200, { success: true });
      return;
    }
    sendJson(response, 404, { error: "unexpected request" });
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

describe("AnythingLLM API key bootstrap", () => {
  it("logs in internally and creates a named developer API key", async () => {
    await withMockAnythingLlm(async (baseUrl, requests) => {
      const result = await createAnythingLlmApiKey({
        authToken: "auth-token-that-must-not-be-logged",
        baseUrl,
        name: "twitchraid-poc-contract",
      });

      expect(result).toEqual({
        id: 7,
        secret: "api-key-that-must-not-be-logged",
      });
      expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
        "POST /api/request-token",
        "POST /api/system/generate-api-key",
      ]);
      expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
        password: "auth-token-that-must-not-be-logged",
      });
      expect(requests[0]?.headers.authorization).toBeUndefined();
      expect(requests[1]?.headers.authorization).toBe(
        "Bearer session-token-that-must-not-be-logged"
      );
      expect(JSON.parse(requests[1]?.body ?? "{}")).toEqual({
        name: "twitchraid-poc-contract",
      });
    });
  });

  it("writes the key with mode 0600 and never prints credentials", async () => {
    await withMockAnythingLlm(async (baseUrl) => {
      const writes: Array<{
        data: string;
        mode?: number;
        path: string;
      }> = [];
      const output: string[] = [];

      const result = await main(
        {
          ANYTHING_LLM_AUTH_TOKEN: "auth-token-that-must-not-be-logged",
          ANYTHING_LLM_BASE_URL: baseUrl,
          ANYTHING_LLM_API_KEY_NAME: "twitchraid-poc-contract",
          ANYTHING_LLM_API_KEY_OUTPUT: "/run/output/api-key",
        },
        {
          fileExists: async () => false,
          writeSecretFile: async (filePath, data, mode) => {
            writes.push({ data, mode, path: filePath });
          },
          writeStdout: (text) => output.push(text),
        }
      );

      expect(result).toEqual({
        status: "created",
        outputPath: "/run/output/api-key",
      });
      expect(writes).toEqual([
        {
          data: "api-key-that-must-not-be-logged\n",
          mode: 0o600,
          path: "/run/output/api-key",
        },
      ]);
      const logged = output.join("");
      expect(logged).toContain('"status":"created"');
      expect(logged).not.toContain("auth-token-that-must-not-be-logged");
      expect(logged).not.toContain("session-token-that-must-not-be-logged");
      expect(logged).not.toContain("api-key-that-must-not-be-logged");
    });
  });

  it("reuses an existing non-empty key file without making API calls", async () => {
    const output: string[] = [];
    const result = await main(
      {
        ANYTHING_LLM_AUTH_TOKEN: "unused-auth-token",
        ANYTHING_LLM_BASE_URL: "http://127.0.0.1:9",
        ANYTHING_LLM_API_KEY_OUTPUT: "/run/output/api-key",
      },
      {
        fileExists: async () => true,
        writeSecretFile: async () => {
          throw new Error("must not write");
        },
        writeStdout: (text) => output.push(text),
      }
    );

    expect(result).toEqual({
      status: "reused",
      outputPath: "/run/output/api-key",
    });
    expect(output.join("")).toContain('"status":"reused"');
  });

  it("repairs mode 0600 only for an owned readable non-blank key file", async () => {
    const chmodCalls: Array<{ mode: number; path: string }> = [];
    const result = await prepareExistingApiKeyFile(
      "/run/output/api-key",
      {
        chmodFile: async (filePath: string, mode: number) => {
          chmodCalls.push({ mode, path: filePath });
        },
        expectedUid: 1000,
        readFile: async () => " existing-key \n",
        statFile: async () => ({
          isFile: () => true,
          uid: 1000,
        }),
      }
    );

    expect(result).toBe(true);
    expect(chmodCalls).toEqual([
      { mode: 0o600, path: "/run/output/api-key" },
    ]);
  });

  it("rejects an existing key file owned by another user", async () => {
    await expect(
      prepareExistingApiKeyFile("/run/output/api-key", {
        chmodFile: async () => undefined,
        expectedUid: 1000,
        readFile: async () => "existing-key",
        statFile: async () => ({
          isFile: () => true,
          uid: 0,
        }),
      })
    ).rejects.toThrow(
      "Existing AnythingLLM API key file has an unexpected owner"
    );
  });

  it("treats a whitespace-only existing key file as missing", async () => {
    const result = await prepareExistingApiKeyFile(
      "/run/output/api-key",
      {
        chmodFile: async () => undefined,
        expectedUid: 1000,
        readFile: async () => " \r\n ",
        statFile: async () => ({
          isFile: () => true,
          uid: 1000,
        }),
      }
    );

    expect(result).toBe(false);
  });

  it("removes a partial temporary secret without replacing the target", async () => {
    const removed: string[] = [];
    let renamed = false;
    let temporaryPath = "";

    await expect(
      writeSecretFileAtomically(
        "/run/output/api-key",
        "generated-secret\n",
        0o600,
        {
          ensureDirectory: async () => undefined,
          randomId: () => "fixed",
          removeFile: async (filePath: string) => {
            removed.push(filePath);
          },
          renameFile: async () => {
            renamed = true;
          },
          writeTempFile: async (filePath: string) => {
            temporaryPath = filePath;
            throw new Error("partial write");
          },
        }
      )
    ).rejects.toThrow("partial write");

    expect(temporaryPath.replaceAll("\\", "/")).toBe(
      "/run/output/.api-key.fixed.tmp"
    );
    expect(removed).toEqual([temporaryPath]);
    expect(renamed).toBe(false);
  });

  it.each([
    {
      name: "blank session token",
      options: { sessionToken: "   " },
      expected: "AnythingLLM login returned an invalid response",
    },
    {
      name: "blank API key secret",
      options: { apiKeySecret: "\r\n" },
      expected: "AnythingLLM API key creation returned an invalid response",
    },
    {
      name: "non-positive API key id",
      options: { apiKeyId: 0 },
      expected: "AnythingLLM API key creation returned an invalid response",
    },
  ])("rejects a $name", async ({ expected, options }) => {
    await withMockAnythingLlm(
      async (baseUrl) => {
        await expect(
          createAnythingLlmApiKey({
            authToken: "auth-token-that-must-not-be-logged",
            baseUrl,
          })
        ).rejects.toThrow(expected);
      },
      options
    );
  });

  it("revokes a generated API key when the protected file write fails", async () => {
    await withMockAnythingLlm(async (baseUrl, requests) => {
      let stdout = "";
      let failure: unknown;

      try {
        await main(
          {
            ANYTHING_LLM_AUTH_TOKEN:
              "auth-token-that-must-not-be-logged",
            ANYTHING_LLM_BASE_URL: baseUrl,
            ANYTHING_LLM_API_KEY_OUTPUT: "/run/output/api-key",
          },
          {
            fileExists: async () => false,
            writeSecretFile: async () => {
              throw new Error(
                "write failed for api-key-that-must-not-be-logged"
              );
            },
            writeStdout: (text: string) => {
              stdout += text;
            },
          }
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "AnythingLLM API key file could not be written; generated key was revoked"
      );
      expect((failure as Error).message).not.toContain(
        "api-key-that-must-not-be-logged"
      );
      expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
        "POST /api/request-token",
        "POST /api/system/generate-api-key",
        "DELETE /api/system/api-key/7",
      ]);
      expect(requests[2]?.headers.authorization).toBe(
        "Bearer session-token-that-must-not-be-logged"
      );
      expect(stdout).toBe("");
    });
  });

  it("sanitizes authentication failures", async () => {
    const server = http.createServer((_request, response) => {
      sendJson(response, 401, {
        error: "auth-token-that-must-not-be-logged",
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;

    try {
      await expect(
        createAnythingLlmApiKey({
          authToken: "auth-token-that-must-not-be-logged",
          baseUrl: `http://127.0.0.1:${address.port}`,
        })
      ).rejects.toThrow("AnythingLLM login failed with HTTP 401");
      await expect(
        createAnythingLlmApiKey({
          authToken: "auth-token-that-must-not-be-logged",
          baseUrl: `http://127.0.0.1:${address.port}`,
        })
      ).rejects.not.toThrow("auth-token-that-must-not-be-logged");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
