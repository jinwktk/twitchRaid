export type OllamaPrewarmSkipReason = "disabled" | "missing_model";
export type OllamaPrewarmFailReason = "http_error" | "error";

export type OllamaPrewarmResult =
  | {
      status: "skipped";
      reason: OllamaPrewarmSkipReason;
    }
  | {
      status: "warmed";
      elapsedMs: number;
    }
  | {
      status: "failed";
      reason: OllamaPrewarmFailReason;
      elapsedMs: number;
      detail: string;
    };

export interface PrewarmOllamaGenerateModelOptions {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  keepAlive?: string;
  fetchImpl?: typeof fetch;
}

function buildOllamaGenerateUrl(baseUrl: string): string {
  return new URL("/api/generate", baseUrl).toString();
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function prewarmOllamaGenerateModel({
  enabled,
  baseUrl,
  model,
  timeoutMs,
  keepAlive,
  fetchImpl = fetch,
}: PrewarmOllamaGenerateModelOptions): Promise<OllamaPrewarmResult> {
  const trimmedModel = model.trim();
  if (!enabled) return { status: "skipped", reason: "disabled" };
  if (!trimmedModel) return { status: "skipped", reason: "missing_model" };

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(buildOllamaGenerateUrl(baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: trimmedModel,
        stream: false,
        keep_alive: keepAlive,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      return {
        status: "failed",
        reason: "http_error",
        elapsedMs,
        detail: detail || `http ${response.status}`,
      };
    }
    await response.json();
    return { status: "warmed", elapsedMs };
  } catch (error) {
    return {
      status: "failed",
      reason: "error",
      elapsedMs: Math.max(0, Date.now() - startedAt),
      detail: errorMessage(error),
    };
  }
}
