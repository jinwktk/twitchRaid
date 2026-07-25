import { randomUUID } from "node:crypto";
import { readFile as readFileFromDisk } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://anythingllm:3001";
const DEFAULT_TIMEOUT_MS = 180_000;

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

function normalizeProbeId(value) {
  const normalized = String(value || randomUUID())
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  if (!normalized) throw new Error("probeId must contain a letter or number");
  return normalized;
}

function normalizeTimeout(value) {
  const timeoutMs = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
    throw new Error("ANYTHING_LLM_TIMEOUT_MS must be at least 1000");
  }
  return timeoutMs;
}

function asError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

async function requestAnythingLlm({
  apiKey,
  baseUrl,
  body,
  fetchImpl,
  method = "GET",
  operation,
  parseJson = true,
  path: requestPath,
  timeoutMs,
}) {
  const headers = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let requestBody;
  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchImpl(`${baseUrl}${requestPath}`, {
      body: requestBody,
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

function readWorkspaceSlug(payload, expectedName) {
  const workspace = payload?.workspace;
  const slug = workspace?.slug;
  if (
    workspace?.name !== expectedName ||
    typeof slug !== "string" ||
    slug.length === 0
  ) {
    throw new Error("workspace creation returned an invalid response");
  }
  return slug;
}

function readDocumentLocation(payload, expectedTitle) {
  const document = payload?.documents?.[0];
  const location = document?.location;
  if (
    payload?.success !== true ||
    document?.title !== expectedTitle ||
    typeof location !== "string" ||
    location.length === 0
  ) {
    throw new Error("document upload returned an invalid response");
  }
  return location;
}

function findWorkspaceSlug(payload, workspaceName) {
  if (!Array.isArray(payload?.workspaces)) {
    throw new Error("workspace discovery returned an invalid response");
  }

  const workspace = payload.workspaces.find(
    (candidate) =>
      candidate?.name === workspaceName &&
      typeof candidate?.slug === "string" &&
      candidate.slug.length > 0
  );
  return workspace?.slug ?? null;
}

function findDocumentLocation(payload, documentName) {
  const root = payload?.localFiles;
  if (
    root?.type !== "folder" ||
    root?.name !== "documents" ||
    !Array.isArray(root.items)
  ) {
    throw new Error("document discovery returned an invalid response");
  }

  function walk(node, parentSegments) {
    if (node?.type === "file") {
      if (
        node.title === documentName &&
        typeof node.name === "string" &&
        node.name.length > 0
      ) {
        return [...parentSegments, node.name].join("/");
      }
      return null;
    }

    if (node?.type !== "folder" || !Array.isArray(node.items)) {
      return null;
    }

    const segments =
      node.name === "documents"
        ? parentSegments
        : typeof node.name === "string" && node.name.length > 0
          ? [...parentSegments, node.name]
          : parentSegments;
    for (const item of node.items) {
      const location = walk(item, segments);
      if (location) return location;
    }
    return null;
  }

  return walk(root, []);
}

function verifyWorkspaceResponse(payload, workspaceSlug, operation) {
  if (payload?.workspace?.slug !== workspaceSlug) {
    throw new Error(`${operation} returned an invalid response`);
  }
}

function verifyChatResponse(payload, marker) {
  if (
    payload?.type !== "textResponse" ||
    typeof payload?.textResponse !== "string" ||
    !payload.textResponse.includes(marker)
  ) {
    throw new Error("workspace chat did not return the embedded marker");
  }
  if (!Array.isArray(payload.sources) || payload.sources.length === 0) {
    throw new Error("workspace chat returned no document sources");
  }
}

export async function runAnythingLlmContract({
  apiKey = "",
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  probeId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error(
      "ANYTHING_LLM_API_KEY or ANYTHING_LLM_API_KEY_FILE is required"
    );
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedTimeoutMs = normalizeTimeout(timeoutMs);
  const checks = {
    health: false,
    workspaceCreated: false,
    documentUploaded: false,
    documentEmbedded: false,
    workspaceChat: false,
    documentUnembedded: false,
    documentDeleted: false,
    workspaceDeleted: false,
  };

  const healthPayload = await requestAnythingLlm({
    baseUrl: normalizedBaseUrl,
    fetchImpl,
    operation: "health check",
    path: "/api/ping",
    timeoutMs: normalizedTimeoutMs,
  });
  if (healthPayload?.online !== true) {
    throw new Error("health check returned an invalid response");
  }
  checks.health = true;

  const normalizedProbeId = normalizeProbeId(probeId);
  const workspaceName = `twitchraid-contract-${normalizedProbeId}`;
  const sessionId = `anythingllm-contract-${normalizedProbeId}`;
  const marker = `TWITCHRAID_ANYTHINGLLM_CONTRACT_${normalizedProbeId}`;
  const documentName = `anythingllm-contract-${normalizedProbeId}.txt`;
  const documentText = [
    "This is synthetic data created only by the isolated AnythingLLM contract probe.",
    `The contract verification marker is ${marker}.`,
    `When asked for the marker, answer exactly ${marker}.`,
  ].join("\n");

  let workspaceSlug = null;
  let documentLocation = null;
  let workspaceCreationAttempted = false;
  let documentUploadAttempted = false;
  let contractError = null;
  const cleanupErrors = [];

  try {
    workspaceCreationAttempted = true;
    const workspacePayload = await requestAnythingLlm({
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
      body: {
        name: workspaceName,
        chatMode: "query",
        similarityThreshold: 0.1,
        topN: 4,
      },
      fetchImpl,
      method: "POST",
      operation: "workspace creation",
      path: "/api/v1/workspace/new",
      timeoutMs: normalizedTimeoutMs,
    });
    workspaceSlug = readWorkspaceSlug(workspacePayload, workspaceName);
    checks.workspaceCreated = true;

    const upload = new FormData();
    upload.append(
      "file",
      new Blob([documentText], { type: "text/plain" }),
      documentName
    );
    documentUploadAttempted = true;
    const uploadPayload = await requestAnythingLlm({
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
      body: upload,
      fetchImpl,
      method: "POST",
      operation: "document upload",
      path: "/api/v1/document/upload",
      timeoutMs: normalizedTimeoutMs,
    });
    documentLocation = readDocumentLocation(uploadPayload, documentName);
    checks.documentUploaded = true;

    const embeddingPayload = await requestAnythingLlm({
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
      body: { adds: [documentLocation], deletes: [] },
      fetchImpl,
      method: "POST",
      operation: "document embedding",
      path: `/api/v1/workspace/${encodeURIComponent(
        workspaceSlug
      )}/update-embeddings`,
      timeoutMs: normalizedTimeoutMs,
    });
    verifyWorkspaceResponse(
      embeddingPayload,
      workspaceSlug,
      "document embedding"
    );
    checks.documentEmbedded = true;

    const chatPayload = await requestAnythingLlm({
      apiKey: normalizedApiKey,
      baseUrl: normalizedBaseUrl,
      body: {
        message:
          "What is the contract verification marker? Return only the marker.",
        mode: "query",
        sessionId,
      },
      fetchImpl,
      method: "POST",
      operation: "workspace chat",
      path: `/api/v1/workspace/${encodeURIComponent(workspaceSlug)}/chat`,
      timeoutMs: normalizedTimeoutMs,
    });
    verifyChatResponse(chatPayload, marker);
    checks.workspaceChat = true;
  } catch (error) {
    contractError = asError(error);
  } finally {
    if (!workspaceSlug && workspaceCreationAttempted) {
      try {
        const workspacesPayload = await requestAnythingLlm({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          fetchImpl,
          operation: "workspace discovery",
          path: "/api/v1/workspaces",
          timeoutMs: normalizedTimeoutMs,
        });
        workspaceSlug = findWorkspaceSlug(workspacesPayload, workspaceName);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }

    if (!documentLocation && documentUploadAttempted) {
      try {
        const documentsPayload = await requestAnythingLlm({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          fetchImpl,
          operation: "document discovery",
          path: "/api/v1/documents",
          timeoutMs: normalizedTimeoutMs,
        });
        documentLocation = findDocumentLocation(
          documentsPayload,
          documentName
        );
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }

    if (workspaceSlug && documentLocation) {
      try {
        const unembedPayload = await requestAnythingLlm({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          body: { adds: [], deletes: [documentLocation] },
          fetchImpl,
          method: "POST",
          operation: "document unembed",
          path: `/api/v1/workspace/${encodeURIComponent(
            workspaceSlug
          )}/update-embeddings`,
          timeoutMs: normalizedTimeoutMs,
        });
        verifyWorkspaceResponse(
          unembedPayload,
          workspaceSlug,
          "document unembed"
        );
        checks.documentUnembedded = true;
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }

    if (documentLocation) {
      try {
        const removalPayload = await requestAnythingLlm({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          body: { names: [documentLocation] },
          fetchImpl,
          method: "DELETE",
          operation: "document deletion",
          path: "/api/v1/system/remove-documents",
          timeoutMs: normalizedTimeoutMs,
        });
        if (removalPayload?.success !== true) {
          throw new Error("document deletion returned an invalid response");
        }
        checks.documentDeleted = true;
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }

    if (workspaceSlug) {
      try {
        await requestAnythingLlm({
          apiKey: normalizedApiKey,
          baseUrl: normalizedBaseUrl,
          fetchImpl,
          method: "DELETE",
          operation: "workspace deletion",
          parseJson: false,
          path: `/api/v1/workspace/${encodeURIComponent(workspaceSlug)}`,
          timeoutMs: normalizedTimeoutMs,
        });
        checks.workspaceDeleted = true;
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
  }

  if (contractError) {
    if (cleanupErrors.length > 0) {
      throw new Error(
        `${contractError.message}; cleanup failed: ${cleanupErrors
          .map((error) => error.message)
          .join(", ")}`
      );
    }
    throw contractError;
  }
  if (cleanupErrors.length > 0) {
    throw new Error(
      `AnythingLLM cleanup failed: ${cleanupErrors
        .map((error) => error.message)
        .join(", ")}`
    );
  }

  return { status: "passed", checks };
}

export async function main(
  env = process.env,
  {
    readFile = readFileFromDisk,
    runContract = runAnythingLlmContract,
    writeStdout = (chunk) => process.stdout.write(chunk),
  } = {}
) {
  let apiKey = String(env.ANYTHING_LLM_API_KEY || "").trim();
  const apiKeyFile = String(env.ANYTHING_LLM_API_KEY_FILE || "").trim();
  if (!apiKey && apiKeyFile) {
    let fileContents;
    try {
      fileContents = await readFile(apiKeyFile, "utf8");
    } catch {
      throw new Error("ANYTHING_LLM_API_KEY_FILE could not be read");
    }
    apiKey = String(fileContents).trim();
    if (!apiKey) {
      throw new Error("ANYTHING_LLM_API_KEY_FILE is empty");
    }
  }
  if (!apiKey) {
    throw new Error(
      "ANYTHING_LLM_API_KEY or ANYTHING_LLM_API_KEY_FILE is required"
    );
  }

  const result = await runContract({
    apiKey,
    baseUrl: env.ANYTHING_LLM_BASE_URL || DEFAULT_BASE_URL,
    probeId: env.ANYTHING_LLM_PROBE_ID,
    timeoutMs: env.ANYTHING_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  });
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
