import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile as readFileFromDisk,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://anythingllm:3001";
const DEFAULT_OUTPUT_PATH = "/run/output/api-key";
const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("ANYTHING_LLM_BASE_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("ANYTHING_LLM_BASE_URL must not contain credentials");
  }
  return url.toString().replace(/\/+$/u, "");
}

function normalizeTimeout(value) {
  const timeoutMs = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("ANYTHING_LLM_TIMEOUT_MS must be at least 1000");
  }
  return timeoutMs;
}

function normalizeName(value) {
  const name = String(value || "twitchraid-bot").trim();
  if (!name || name.length > 80) {
    throw new Error("ANYTHING_LLM_API_KEY_NAME must contain 1 to 80 characters");
  }
  return name;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

async function requestJson({
  authorization,
  baseUrl,
  body,
  fetchImpl,
  method = "POST",
  operation,
  parseJson = true,
  requestPath,
  timeoutMs,
}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = `Bearer ${authorization}`;

  let response;
  try {
    response = await fetchImpl(`${baseUrl}${requestPath}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (asError(error).name === "TimeoutError") {
      throw new Error(`${operation} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`${operation} request failed`);
  }

  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
  if (!parseJson) return null;

  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

async function provisionAnythingLlmApiKey({
  authToken,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  name = "twitchraid-bot",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const normalizedAuthToken = String(authToken || "").trim();
  if (!normalizedAuthToken) {
    throw new Error("ANYTHING_LLM_AUTH_TOKEN is required");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs);
  const normalizedName = normalizeName(name);
  const login = await requestJson({
    baseUrl: normalizedBaseUrl,
    body: { password: normalizedAuthToken },
    fetchImpl,
    operation: "AnythingLLM login",
    requestPath: "/api/request-token",
    timeoutMs: normalizedTimeoutMs,
  });
  const sessionToken =
    login?.valid === true && typeof login?.token === "string"
      ? login.token.trim()
      : "";
  if (!sessionToken) {
    throw new Error("AnythingLLM login returned an invalid response");
  }

  const generated = await requestJson({
    authorization: sessionToken,
    baseUrl: normalizedBaseUrl,
    body: { name: normalizedName },
    fetchImpl,
    operation: "AnythingLLM API key creation",
    requestPath: "/api/system/generate-api-key",
    timeoutMs: normalizedTimeoutMs,
  });
  const rawId = generated?.apiKey?.id;
  const id = typeof rawId === "string" ? rawId.trim() : rawId;
  const secret =
    typeof generated?.apiKey?.secret === "string"
      ? generated.apiKey.secret.trim()
      : "";
  if (
    !(
      (typeof id === "number" && Number.isInteger(id) && id > 0) ||
      (typeof id === "string" && id.length > 0)
    ) ||
    !secret ||
    generated?.error
  ) {
    throw new Error("AnythingLLM API key creation returned an invalid response");
  }

  return {
    baseUrl: normalizedBaseUrl,
    id,
    secret,
    sessionToken,
    timeoutMs: normalizedTimeoutMs,
  };
}

export async function createAnythingLlmApiKey(options = {}) {
  const provisioned = await provisionAnythingLlmApiKey(options);
  return {
    id: provisioned.id,
    secret: provisioned.secret,
  };
}

async function revokeAnythingLlmApiKey({
  baseUrl,
  fetchImpl,
  id,
  sessionToken,
  timeoutMs,
}) {
  await requestJson({
    authorization: sessionToken,
    baseUrl,
    fetchImpl,
    method: "DELETE",
    operation: "AnythingLLM API key revocation",
    parseJson: false,
    requestPath: `/api/system/api-key/${encodeURIComponent(String(id))}`,
    timeoutMs,
  });
}

export async function prepareExistingApiKeyFile(
  filePath,
  {
    chmodFile = chmod,
    expectedUid =
      typeof process.getuid === "function" ? process.getuid() : null,
    readFile = readFileFromDisk,
    statFile = stat,
  } = {}
) {
  let file;
  try {
    file = await statFile(filePath);
  } catch (error) {
    if (asError(error).code === "ENOENT") return false;
    throw new Error("Existing AnythingLLM API key file could not be inspected");
  }
  if (typeof file?.isFile !== "function" || !file.isFile()) {
    throw new Error("Existing AnythingLLM API key path is not a file");
  }
  if (
    Number.isInteger(expectedUid) &&
    Number.isInteger(file.uid) &&
    file.uid !== expectedUid
  ) {
    throw new Error(
      "Existing AnythingLLM API key file has an unexpected owner"
    );
  }

  try {
    await chmodFile(filePath, 0o600);
  } catch {
    throw new Error(
      "Existing AnythingLLM API key file mode could not be repaired"
    );
  }

  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    throw new Error("Existing AnythingLLM API key file could not be read");
  }
  return String(contents).trim().length > 0;
}

async function defaultEnsureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await chmod(directoryPath, 0o700);
}

async function defaultWriteTempFile(filePath, data, mode) {
  let handle;
  try {
    handle = await open(filePath, "wx", mode);
    await handle.writeFile(data, { encoding: "utf8" });
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await chmod(filePath, mode);
}

export async function writeSecretFileAtomically(
  filePath,
  data,
  mode,
  {
    ensureDirectory = defaultEnsureDirectory,
    randomId = randomUUID,
    removeFile = unlink,
    renameFile = rename,
    writeTempFile = defaultWriteTempFile,
  } = {}
) {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${randomId()}.tmp`
  );
  await ensureDirectory(directoryPath);
  try {
    await writeTempFile(temporaryPath, data, mode);
    await renameFile(temporaryPath, filePath);
  } catch (error) {
    try {
      await removeFile(temporaryPath);
    } catch (cleanupError) {
      if (asError(cleanupError).code !== "ENOENT") {
        throw new Error(
          "Temporary AnythingLLM API key file could not be removed"
        );
      }
    }
    throw error;
  }
}

export async function main(env = process.env, dependencies = {}) {
  const outputPath = String(
    env.ANYTHING_LLM_API_KEY_OUTPUT || DEFAULT_OUTPUT_PATH
  ).trim();
  if (!path.isAbsolute(outputPath)) {
    throw new Error("ANYTHING_LLM_API_KEY_OUTPUT must be an absolute path");
  }

  const fileExists =
    dependencies.fileExists || prepareExistingApiKeyFile;
  const writeSecretFile =
    dependencies.writeSecretFile || writeSecretFileAtomically;
  const writeStdout =
    dependencies.writeStdout || ((text) => process.stdout.write(text));

  if (await fileExists(outputPath)) {
    const result = { status: "reused", outputPath };
    writeStdout(`${JSON.stringify(result)}\n`);
    return result;
  }

  const provisioned = await provisionAnythingLlmApiKey({
    authToken: env.ANYTHING_LLM_AUTH_TOKEN || env.AUTH_TOKEN || "",
    baseUrl: env.ANYTHING_LLM_BASE_URL || DEFAULT_BASE_URL,
    name: env.ANYTHING_LLM_API_KEY_NAME || "twitchraid-bot",
    timeoutMs: env.ANYTHING_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  });
  try {
    await writeSecretFile(
      outputPath,
      `${provisioned.secret}\n`,
      0o600
    );
  } catch {
    try {
      await revokeAnythingLlmApiKey({
        baseUrl: provisioned.baseUrl,
        fetchImpl: globalThis.fetch,
        id: provisioned.id,
        sessionToken: provisioned.sessionToken,
        timeoutMs: provisioned.timeoutMs,
      });
    } catch {
      throw new Error(
        "AnythingLLM API key file could not be written and generated key could not be revoked"
      );
    }
    throw new Error(
      "AnythingLLM API key file could not be written; generated key was revoked"
    );
  }

  const result = { status: "created", outputPath };
  writeStdout(`${JSON.stringify(result)}\n`);
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
