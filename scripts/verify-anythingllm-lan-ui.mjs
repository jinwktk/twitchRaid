import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://192.168.0.99:3220";
const DEFAULT_TIMEOUT_MS = 5_000;

function normalizeBaseUrl(value) {
  const rawValue = String(value ?? "");
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(
      "AnythingLLM LAN UI base URL must be an absolute http or https URL"
    );
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("AnythingLLM LAN UI base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error(
      "AnythingLLM LAN UI base URL must not contain credentials"
    );
  }
  if (
    url.search ||
    url.hash ||
    rawValue.includes("?") ||
    rawValue.includes("#")
  ) {
    throw new Error(
      "AnythingLLM LAN UI base URL must not contain query or hash"
    );
  }

  return url.toString().replace(/\/+$/u, "");
}

function normalizeTimeoutMs(value) {
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      "AnythingLLM LAN UI timeout must be a positive integer"
    );
  }
  return timeoutMs;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

export async function verifyAnythingLlmLanUi({
  baseUrl,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const url = `${normalizedBaseUrl}/api/ping`;
  const startedAt = now();
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      method: "GET",
      signal: AbortSignal.timeout(normalizedTimeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)
    ) {
      throw new Error(
        `AnythingLLM LAN UI ping timed out after ${normalizedTimeoutMs}ms`
      );
    }
    throw new Error("AnythingLLM LAN UI ping request failed");
  }

  if (response.status !== 200) {
    throw new Error(
      `AnythingLLM LAN UI ping failed with HTTP ${response.status}`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name)
    ) {
      throw new Error(
        `AnythingLLM LAN UI ping timed out after ${normalizedTimeoutMs}ms`
      );
    }
    throw new Error("AnythingLLM LAN UI ping returned invalid JSON");
  }
  if (payload?.online !== true) {
    throw new Error("AnythingLLM LAN UI ping reported online=false");
  }

  return {
    status: "online",
    url,
    statusCode: response.status,
    elapsedMs: Math.max(0, now() - startedAt),
  };
}

export async function main(
  env = process.env,
  {
    runProbe = verifyAnythingLlmLanUi,
    writeStdout = (chunk) => process.stdout.write(chunk),
  } = {}
) {
  const probeResult = await runProbe({
    baseUrl: env.ANYTHING_LLM_LAN_UI_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: normalizeTimeoutMs(
      env.ANYTHING_LLM_LAN_UI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS
    ),
  });
  const result = {
    status: probeResult.status,
    url: probeResult.url,
    statusCode: probeResult.statusCode,
    elapsedMs: probeResult.elapsedMs,
  };

  await writeStdout(`${JSON.stringify(result)}\n`);
  return result;
}

const currentFile = path.resolve(fileURLToPath(import.meta.url));
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryFile && currentFile === entryFile) {
  main().catch((error) => {
    process.stderr.write(`${asError(error).message}\n`);
    process.exitCode = 1;
  });
}
