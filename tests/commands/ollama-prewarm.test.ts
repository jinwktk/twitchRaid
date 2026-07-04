import { describe, expect, it, vi } from "vitest";
import { prewarmOllamaGenerateModel } from "../../src/commands/ollama-prewarm";

describe("prewarmOllamaGenerateModel", () => {
  it("requests a tiny generate call to keep the configured model resident", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: "" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await prewarmOllamaGenerateModel({
      enabled: true,
      baseUrl: "http://ollama:11434/",
      model: "qwen3.5:9b",
      timeoutMs: 90_000,
      keepAlive: "30m",
      fetchImpl,
    });

    expect(result.status).toBe("warmed");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://ollama:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      model: "qwen3.5:9b",
      prompt: "ping",
      stream: false,
      think: false,
      keep_alive: "30m",
      options: {
        temperature: 0,
        num_predict: 1,
      },
    });
  });

  it("skips without calling Ollama when disabled or model is missing", async () => {
    const fetchImpl = vi.fn();

    await expect(
      prewarmOllamaGenerateModel({
        enabled: false,
        baseUrl: "http://ollama:11434",
        model: "qwen3.5:9b",
        timeoutMs: 90_000,
        fetchImpl,
      })
    ).resolves.toMatchObject({ status: "skipped", reason: "disabled" });

    await expect(
      prewarmOllamaGenerateModel({
        enabled: true,
        baseUrl: "http://ollama:11434",
        model: "",
        timeoutMs: 90_000,
        fetchImpl,
      })
    ).resolves.toMatchObject({ status: "skipped", reason: "missing_model" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a failed result instead of throwing when Ollama rejects", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));

    await expect(
      prewarmOllamaGenerateModel({
        enabled: true,
        baseUrl: "http://ollama:11434",
        model: "qwen3.5:9b",
        timeoutMs: 90_000,
        fetchImpl,
      })
    ).resolves.toMatchObject({
      status: "failed",
      reason: "error",
      detail: "connection refused",
    });
  });
});
