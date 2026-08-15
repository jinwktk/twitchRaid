import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  main,
  verifyAnythingLlmLanUi,
} from "../../scripts/verify-anythingllm-lan-ui.mjs";

describe("AnythingLLM LAN UI startup smoke", () => {
  it("reports online only when /api/ping returns HTTP 200 with online true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ online: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    const times = [1_000, 1_025];

    const result = await verifyAnythingLlmLanUi({
      baseUrl: "http://192.168.0.99:3220/",
      fetchImpl,
      now: () => times.shift() ?? 1_025,
      timeoutMs: 500,
    });

    expect(result).toEqual({
      status: "online",
      url: "http://192.168.0.99:3220/api/ping",
      statusCode: 200,
      elapsedMs: 25,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://192.168.0.99:3220/api/ping",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        method: "GET",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("reports an HTTP error without exposing the response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("secret upstream detail", { status: 503 })
    );

    await expect(
      verifyAnythingLlmLanUi({
        baseUrl: "http://192.168.0.99:3220",
        fetchImpl,
        timeoutMs: 500,
      })
    ).rejects.toThrow("AnythingLLM LAN UI ping failed with HTTP 503");

    await expect(
      verifyAnythingLlmLanUi({
        baseUrl: "http://192.168.0.99:3220",
        fetchImpl,
        timeoutMs: 500,
      })
    ).rejects.not.toThrow("secret upstream detail");
  });

  it("reports invalid JSON without exposing the response body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("secret invalid payload", { status: 200 })
    );
    const operation = verifyAnythingLlmLanUi({
      baseUrl: "http://192.168.0.99:3220",
      fetchImpl,
      timeoutMs: 500,
    });

    await expect(operation).rejects.toThrow(
      /^AnythingLLM LAN UI ping returned invalid JSON$/u
    );
    await expect(operation).rejects.not.toThrow("secret invalid payload");
  });

  it("reports offline unless online is exactly true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ online: false }), { status: 200 })
    );

    await expect(
      verifyAnythingLlmLanUi({
        baseUrl: "http://192.168.0.99:3220",
        fetchImpl,
        timeoutMs: 500,
      })
    ).rejects.toThrow(
      /^AnythingLLM LAN UI ping reported online=false$/u
    );
  });

  it("reports a sanitized timeout error", async () => {
    const timeout = Object.assign(
      new Error("secret network detail"),
      { name: "TimeoutError" }
    );
    const fetchImpl = vi.fn().mockRejectedValue(timeout);
    const operation = verifyAnythingLlmLanUi({
      baseUrl: "http://192.168.0.99:3220",
      fetchImpl,
      timeoutMs: 15,
    });

    await expect(operation).rejects.toThrow(
      /^AnythingLLM LAN UI ping timed out after 15ms$/u
    );
    await expect(operation).rejects.not.toThrow("secret network detail");
  });

  it("reports a sanitized timeout while reading the JSON body", async () => {
    const timeout = Object.assign(
      new Error("secret body detail"),
      { name: "TimeoutError" }
    );
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockRejectedValue(timeout),
    });
    const operation = verifyAnythingLlmLanUi({
      baseUrl: "http://192.168.0.99:3220",
      fetchImpl,
      timeoutMs: 15,
    });

    await expect(operation).rejects.toThrow(
      /^AnythingLLM LAN UI ping timed out after 15ms$/u
    );
    await expect(operation).rejects.not.toThrow("secret body detail");
  });

  it.each([
    {
      baseUrl: "http://user@192.168.0.99:3220",
      expected: "AnythingLLM LAN UI base URL must not contain credentials",
    },
    {
      baseUrl: "http://user:secret-password@192.168.0.99:3220",
      expected: "AnythingLLM LAN UI base URL must not contain credentials",
    },
    {
      baseUrl: "http://192.168.0.99:3220/?token=secret-query",
      expected: "AnythingLLM LAN UI base URL must not contain query or hash",
    },
    {
      baseUrl: "http://192.168.0.99:3220/#secret-hash",
      expected: "AnythingLLM LAN UI base URL must not contain query or hash",
    },
    {
      baseUrl: "http://192.168.0.99:3220/?",
      expected: "AnythingLLM LAN UI base URL must not contain query or hash",
    },
    {
      baseUrl: "http://192.168.0.99:3220/#",
      expected: "AnythingLLM LAN UI base URL must not contain query or hash",
    },
    {
      baseUrl: "ftp://192.168.0.99:3220",
      expected: "AnythingLLM LAN UI base URL must use http or https",
    },
  ])("rejects an unsafe base URL before requesting: $baseUrl", async ({
    baseUrl,
    expected,
  }) => {
    const fetchImpl = vi.fn();

    await expect(
      verifyAnythingLlmLanUi({ baseUrl, fetchImpl, timeoutMs: 500 })
    ).rejects.toThrow(new RegExp(`^${expected}$`, "u"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prints one safe JSON line using the default LAN URL", async () => {
    const output: string[] = [];
    const runProbe = vi.fn().mockResolvedValue({
      status: "online",
      url: "http://192.168.0.99:3220/api/ping",
      statusCode: 200,
      elapsedMs: 12,
      body: "secret response body",
      credential: "secret credential",
    });

    const result = await main(
      {},
      {
        runProbe,
        writeStdout: (chunk: string) => output.push(chunk),
      }
    );

    expect(runProbe).toHaveBeenCalledWith({
      baseUrl: "http://192.168.0.99:3220",
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      status: "online",
      url: "http://192.168.0.99:3220/api/ping",
      statusCode: 200,
      elapsedMs: 12,
    });
    expect(output).toEqual([
      '{"status":"online","url":"http://192.168.0.99:3220/api/ping","statusCode":200,"elapsedMs":12}\n',
    ]);
    expect(output.join("")).not.toContain("secret response body");
    expect(output.join("")).not.toContain("secret credential");
  });

  it("runs the real CLI boundary and exits safely for an unsafe URL", () => {
    const command =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "npm";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm --silent run verify:anythingllm-lan-ui"]
        : ["--silent", "run", "verify:anythingllm-lan-ui"];
    const execution = spawnSync(
      command,
      args,
      {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          ANYTHING_LLM_LAN_UI_BASE_URL:
            "http://user:secret-password@192.168.0.99:3220",
        },
        timeout: 5_000,
        windowsHide: true,
      }
    );

    expect(execution.error).toBeUndefined();
    expect(execution.status).toBe(1);
    expect(execution.stdout).toBe("");
    expect(execution.stderr.trim()).toBe(
      "AnythingLLM LAN UI base URL must not contain credentials"
    );
    expect(execution.stderr).not.toContain("secret-password");
  });
});
