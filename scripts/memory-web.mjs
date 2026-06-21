#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3220;
const DEFAULT_SSH_HOST = "sub";
const DEFAULT_WSL_DISTRO = "Ubuntu-Backup";
const DEFAULT_SERVICE_NAME = "sub-ai_mem0";
const DEFAULT_TARGET = "ssh-wsl";
const DEFAULT_ENDPOINT = "http://127.0.0.1:8888";
const DEFAULT_USER_ID = "rukalun";
const DEFAULT_AGENT_ID = "twitchRaid";
const DEFAULT_APP_ID = "twitchRaid";

export function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    sshHost: DEFAULT_SSH_HOST,
    wslDistro: DEFAULT_WSL_DISTRO,
    serviceName: DEFAULT_SERVICE_NAME,
    target: DEFAULT_TARGET,
    endpoint: process.env.MEMORY_WEB_ENDPOINT || DEFAULT_ENDPOINT,
    apiKey:
      process.env.MEMORY_WEB_API_KEY ||
      process.env.CHAT_AI_MEM0_API_KEY ||
      process.env.MEM0_ADMIN_API_KEY ||
      "",
    userId: process.env.CHAT_AI_MEM0_USER_ID || DEFAULT_USER_ID,
    agentId: process.env.CHAT_AI_MEM0_AGENT_ID || DEFAULT_AGENT_ID,
    runId: process.env.CHAT_AI_MEM0_RUN_ID || "",
    appId: process.env.CHAT_AI_MEM0_APP_ID || DEFAULT_APP_ID,
    limit: 100,
    basicUser: process.env.MEMORY_WEB_BASIC_USER || "",
    basicPassword: process.env.MEMORY_WEB_BASIC_PASSWORD || "",
    allowUnsafeNoAuth: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      return { ...options, help: true };
    }
    if (arg === "--host" && next) {
      options.host = next;
      index += 1;
    } else if (arg === "--port" && next) {
      const port = Number.parseInt(next, 10);
      if (Number.isFinite(port) && port > 0) options.port = port;
      index += 1;
    } else if (arg === "--ssh-host" && next) {
      options.sshHost = next;
      index += 1;
    } else if (arg === "--wsl-distro" && next) {
      options.wslDistro = next;
      index += 1;
    } else if (arg === "--service" && next) {
      options.serviceName = next;
      index += 1;
    } else if (arg === "--target" && next) {
      options.target = next === "direct" ? "direct" : DEFAULT_TARGET;
      index += 1;
    } else if (arg === "--endpoint" && next) {
      options.endpoint = next;
      index += 1;
    } else if (arg === "--api-key" && next) {
      options.apiKey = next;
      index += 1;
    } else if (arg === "--user-id" && next) {
      options.userId = next;
      index += 1;
    } else if (arg === "--agent-id" && next) {
      options.agentId = next;
      index += 1;
    } else if (arg === "--run-id" && next) {
      options.runId = next;
      index += 1;
    } else if (arg === "--app-id" && next) {
      options.appId = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      const limit = Number.parseInt(next, 10);
      if (Number.isFinite(limit) && limit > 0) options.limit = limit;
      index += 1;
    } else if (arg === "--basic-user" && next) {
      options.basicUser = next;
      index += 1;
    } else if (arg === "--basic-password" && next) {
      options.basicPassword = next;
      index += 1;
    } else if (arg === "--allow-unsafe-no-auth") {
      options.allowUnsafeNoAuth = true;
    }
  }

  return options;
}

function singleLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function optionalText(value) {
  const text = singleLine(value);
  return text || "";
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function isAuthorized(options, req) {
  if (!options.basicPassword) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString(
      "utf8"
    );
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) return false;
  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return (
    timingSafeEqualText(user, options.basicUser || "admin") &&
    timingSafeEqualText(password, options.basicPassword)
  );
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="twitchRaid Memory"',
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end("Unauthorized\n");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").trim();
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("request body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function extractJsonPayload(stdout) {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) continue;
    return JSON.parse(lines[index]);
  }
  throw new Error("remote command did not return JSON");
}

function nestedRecord(value, key) {
  if (!value || typeof value !== "object") return null;
  const nested = value[key];
  return nested && typeof nested === "object" ? nested : null;
}

function metadataFromRecord(record) {
  return (
    nestedRecord(record, "metadata") ||
    nestedRecord(nestedRecord(record, "payload"), "metadata") ||
    {}
  );
}

function memoryTextFromRecord(value) {
  if (!value || typeof value !== "object") return "";
  for (const field of ["memory", "text", "content"]) {
    const text = value[field];
    if (typeof text === "string" && singleLine(text)) return singleLine(text);
  }
  const payload = nestedRecord(value, "payload");
  return payload ? memoryTextFromRecord(payload) : "";
}

function resultArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const field of ["results", "memories", "data"]) {
    const nested = value[field];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function splitMemoryText(memory, metadataKey) {
  const key = optionalText(metadataKey);
  if (!memory) return { key, value: "" };
  const separatorIndex = memory.indexOf(":");
  if (separatorIndex > 0) {
    return {
      key: key || singleLine(memory.slice(0, separatorIndex)),
      value: singleLine(memory.slice(separatorIndex + 1)),
    };
  }
  return { key, value: memory };
}

export function normalizeMemoryEntries(raw) {
  const entries = resultArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const metadata = metadataFromRecord(item);
      const id = optionalText(item.id ?? item.memory_id ?? item.uuid);
      const memory = memoryTextFromRecord(item);
      if (!id && !memory) return null;
      const { key, value } = splitMemoryText(memory, metadata.key);
      return {
        id,
        key,
        value,
        kind: optionalText(metadata.kind),
        status: "active",
        sourceUser: optionalText(metadata.sourceUser ?? metadata.source_user),
        updatedAt: optionalText(item.updated_at ?? item.updatedAt ?? item.created_at),
      };
    })
    .filter(Boolean);

  return { entries, totalCount: entries.length, activeCount: entries.length };
}

function scopedParams(scope) {
  return {
    userId: optionalText(scope.userId),
    agentId: optionalText(scope.agentId),
    runId: optionalText(scope.runId),
  };
}

export async function executeMemoryOperation(client, scope, request) {
  const common = scopedParams(scope);
  const limit = Number.isFinite(request.limit) && request.limit > 0
    ? request.limit
    : scope.limit;

  if (request.action === "list") {
    const queryText = singleLine(request.queryText);
    if (queryText) {
      return normalizeMemoryEntries(
        await client.search({ ...common, queryText, limit })
      );
    }
    return normalizeMemoryEntries(await client.list({ ...common, limit }));
  }

  if (request.action === "upsert") {
    const key = singleLine(request.key);
    const value = singleLine(request.value);
    if (!key || !value) return { saved: false, reason: "invalid_format" };
    if (request.mode === "update") {
      const id = singleLine(request.id);
      if (!id) return { saved: false, reason: "missing_id" };
      const raw = await client.update({ id, key, value });
      return { saved: true, reason: "saved", raw };
    }
    const raw = await client.create({
      ...common,
      appId: optionalText(scope.appId),
      key,
      value,
      kind: request.kind === "implicit" ? "implicit" : "semantic",
      sourceUser: "memory-web",
    });
    return { saved: true, reason: "saved", raw };
  }

  if (request.action === "delete") {
    const id = singleLine(request.id);
    if (!id) return { deleted: false, reason: "missing_id" };
    const raw = await client.delete({ id });
    return { deleted: true, reason: "deleted", raw };
  }

  throw new Error("unknown_action");
}

function normalizeEndpoint(endpoint) {
  const cleanEndpoint = optionalText(endpoint);
  if (!cleanEndpoint) return DEFAULT_ENDPOINT;
  const url = new URL(cleanEndpoint);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function createHttpClient(options) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const headers = {
    "Content-Type": "application/json",
  };
  if (optionalText(options.apiKey)) headers["X-API-Key"] = optionalText(options.apiKey);

  async function requestJson(method, path, body) {
    const response = await fetch(`${endpoint}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`mem0 http ${response.status}`);
    return response.json();
  }

  return {
    list({ userId, agentId, runId, limit }) {
      const params = new URLSearchParams();
      if (userId) params.set("user_id", userId);
      if (agentId) params.set("agent_id", agentId);
      if (runId) params.set("run_id", runId);
      if (limit) params.set("limit", String(limit));
      const query = params.toString();
      return requestJson("GET", `/memories${query ? `?${query}` : ""}`);
    },
    search({ queryText, userId, agentId, runId, limit }) {
      const filters = {};
      if (userId) filters.user_id = userId;
      if (agentId) filters.agent_id = agentId;
      if (runId) filters.run_id = runId;
      return requestJson("POST", "/search", {
        query: queryText,
        filters,
        top_k: limit,
      });
    },
    create({ userId, agentId, runId, appId, key, value, kind, sourceUser }) {
      const body = {
        messages: [{ role: "user", content: `${key}: ${value}` }],
        infer: false,
        metadata: {
          key,
          kind,
          sourceUser,
          source: "twitchRaid",
          app_id: appId || undefined,
        },
      };
      if (userId) body.user_id = userId;
      if (agentId) body.agent_id = agentId;
      if (runId) body.run_id = runId;
      return requestJson("POST", "/memories", body);
    },
    update({ id, key, value }) {
      return requestJson("PATCH", `/memories/${encodeURIComponent(id)}`, {
        memory: `${key}: ${value}`,
      });
    },
    delete({ id }) {
      return requestJson("DELETE", `/memories/${encodeURIComponent(id)}`);
    },
  };
}

function buildRemoteScript({ serviceName, request, scope }) {
  const payload = Buffer.from(JSON.stringify({ request, scope }), "utf8").toString(
    "base64url"
  );
  return `set -eu
SERVICE_NAME=${shellQuote(serviceName)}
MEMORY_WEB_REQUEST=${shellQuote(payload)}
CID=$(docker ps --filter "name=$SERVICE_NAME" --format "{{.ID}}" | head -n 1)
if [ -z "$CID" ]; then
  printf '%s\\n' '{"ok":false,"error":"container_not_found"}'
  exit 0
fi
docker exec -i -e MEMORY_WEB_REQUEST="$MEMORY_WEB_REQUEST" "$CID" python - <<'PY'
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request

raw = os.environ["MEMORY_WEB_REQUEST"]
raw += "=" * ((4 - len(raw) % 4) % 4)
payload = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
request = payload["request"]
scope = payload["scope"]
api_key = os.environ.get("MEM0_ADMIN_API_KEY", "")
base_url = "http://127.0.0.1:8888"

def clean(value):
    return str(value or "").strip()

def call(method, path, body=None):
    data = None
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(base_url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            text = res.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"mem0 http {exc.code}: {detail}") from exc

def scoped_query():
    params = {}
    for src, dst in (("userId", "user_id"), ("agentId", "agent_id"), ("runId", "run_id")):
        value = clean(scope.get(src))
        if value:
            params[dst] = value
    limit = request.get("limit") or scope.get("limit")
    if limit:
        params["limit"] = str(limit)
    query = urllib.parse.urlencode(params)
    return "?" + query if query else ""

def scoped_filters():
    filters = {}
    for src, dst in (("userId", "user_id"), ("agentId", "agent_id"), ("runId", "run_id")):
        value = clean(scope.get(src))
        if value:
            filters[dst] = value
    return filters

try:
    action = request.get("action")
    if action == "list":
        query_text = clean(request.get("queryText"))
        if query_text:
            result = call("POST", "/search", {
                "query": query_text,
                "filters": scoped_filters(),
                "top_k": request.get("limit") or scope.get("limit"),
            })
        else:
            result = call("GET", "/memories" + scoped_query())
    elif action == "upsert":
        key = clean(request.get("key"))
        value = clean(request.get("value"))
        if not key or not value:
            raise RuntimeError("invalid_format")
        if request.get("mode") == "update":
            memory_id = clean(request.get("id"))
            if not memory_id:
                raise RuntimeError("missing_id")
            result = call("PATCH", "/memories/" + urllib.parse.quote(memory_id, safe=""), {
                "memory": f"{key}: {value}",
            })
        else:
            body = {
                "messages": [{"role": "user", "content": f"{key}: {value}"}],
                "infer": False,
                "metadata": {
                    "key": key,
                    "kind": "implicit" if request.get("kind") == "implicit" else "semantic",
                    "sourceUser": "memory-web",
                    "source": "twitchRaid",
                    "app_id": clean(scope.get("appId")) or None,
                },
            }
            for src, dst in (("userId", "user_id"), ("agentId", "agent_id"), ("runId", "run_id")):
                scoped_value = clean(scope.get(src))
                if scoped_value:
                    body[dst] = scoped_value
            result = call("POST", "/memories", body)
    elif action == "delete":
        memory_id = clean(request.get("id"))
        if not memory_id:
            raise RuntimeError("missing_id")
        result = call("DELETE", "/memories/" + urllib.parse.quote(memory_id, safe=""))
    else:
        raise RuntimeError("unknown_action")
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": "operation_failed", "detail": str(exc)}, ensure_ascii=False))
PY
`;
}

function runRemoteRawOperation(options, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        options.sshHost,
        "wsl",
        "-d",
        options.wslDistro,
        "--",
        "bash",
        "-s",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ssh exited with code ${code}`));
        return;
      }
      try {
        const payload = extractJsonPayload(stdout);
        if (!payload.ok) {
          reject(new Error(payload.detail || payload.error || "remote error"));
          return;
        }
        resolve(payload.result);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(
      buildRemoteScript({
        serviceName: options.serviceName,
        request,
        scope: options,
      })
    );
  });
}

async function runMemoryOperation(options, request) {
  if (options.target === "direct") {
    return executeMemoryOperation(createHttpClient(options), options, request);
  }

  const raw = await runRemoteRawOperation(options, request);
  if (request.action === "list") return normalizeMemoryEntries(raw);
  if (request.action === "upsert") return { saved: true, reason: "saved", raw };
  if (request.action === "delete") return { deleted: true, reason: "deleted", raw };
  throw new Error("unknown_action");
}

export function buildListRequestFromUrl(url, defaultLimit) {
  const mode = url.searchParams.get("mode") === "search" ? "search" : "list";
  return {
    action: "list",
    queryText: mode === "search" ? url.searchParams.get("q") || "" : "",
    limit: Number.parseInt(url.searchParams.get("limit") || String(defaultLimit), 10),
  };
}

async function handleApiRequest(options, req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/memory") {
      const result = await runMemoryOperation(
        options,
        buildListRequestFromUrl(url, options.limit)
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/memory") {
      const body = await readRequestBody(req);
      const result = await runMemoryOperation(options, {
        action: "upsert",
        mode: body.mode === "update" ? "update" : "create",
        id: String(body.id || ""),
        key: String(body.key || ""),
        value: String(body.value || ""),
        kind: body.kind === "implicit" ? "implicit" : "semantic",
      });
      sendJson(res, result.saved ? 200 : 400, result);
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/memory/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memory/".length));
      const result = await runMemoryOperation(options, { action: "delete", id });
      sendJson(res, result.deleted ? 200 : 404, result);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "memory_web_error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export function renderHtml() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>twitchRaid Memory</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", system-ui, sans-serif;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d8dde5;
      --text: #1b2430;
      --muted: #667085;
      --accent: #1769aa;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: 0; }
    main { padding: 18px 22px 28px; }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto auto auto;
      gap: 10px;
      margin-bottom: 14px;
      align-items: center;
    }
    input, select, textarea, button {
      font: inherit;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
    }
    input, select, textarea { width: 100%; padding: 8px 10px; }
    textarea { resize: vertical; min-height: 92px; }
    button { padding: 8px 12px; cursor: pointer; white-space: nowrap; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    button.danger { border-color: var(--danger); color: var(--danger); }
    .meta, .status-line { color: var(--muted); font-size: 13px; }
    .status-line { min-height: 20px; margin: 0 0 10px; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); background: var(--panel); }
    table { width: 100%; border-collapse: collapse; min-width: 960px; }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      position: sticky;
      top: 0;
      background: #eef2f7;
      z-index: 1;
      font-size: 12px;
      color: #344054;
    }
    td.value { max-width: 480px; white-space: pre-wrap; overflow-wrap: anywhere; }
    td.id { max-width: 150px; overflow-wrap: anywhere; color: var(--muted); font-size: 12px; }
    td.actions { width: 156px; white-space: nowrap; }
    .pill {
      display: inline-flex;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      color: #344054;
      background: #f8fafc;
    }
    dialog {
      width: min(620px, calc(100vw - 28px));
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0;
    }
    dialog::backdrop { background: rgb(15 23 42 / 0.35); }
    .dialog-body { display: grid; gap: 12px; padding: 16px; }
    .dialog-row { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid var(--line);
      padding: 12px 16px;
    }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    @media (max-width: 760px) {
      header { align-items: flex-start; flex-direction: column; }
      main { padding: 14px; }
      .toolbar { grid-template-columns: 1fr 1fr; }
      .dialog-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>twitchRaid Memory</h1>
      <div class="meta" id="summary">loading</div>
    </div>
    <button class="primary" id="newButton" type="button">New</button>
  </header>
  <main>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Semantic query">
      <button id="searchButton" type="button">Semantic Search</button>
      <button id="listButton" type="button">List</button>
      <button id="clearButton" type="button">Clear</button>
    </div>
    <p class="status-line" id="message"></p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>key</th>
            <th>value</th>
            <th>kind</th>
            <th>status</th>
            <th>source</th>
            <th>updated</th>
            <th>actions</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </main>
  <dialog id="editor">
    <form method="dialog" id="memoryForm">
      <div class="dialog-body">
        <label>key<input id="formKey" name="key" required maxlength="80"></label>
        <label>value<textarea id="formValue" name="value" required maxlength="400"></textarea></label>
        <div class="dialog-row">
          <label>kind<select id="formKind" name="kind">
            <option value="semantic">semantic</option>
            <option value="implicit">implicit</option>
          </select></label>
        </div>
      </div>
      <div class="dialog-actions">
        <button value="cancel" type="button" id="cancelButton">Cancel</button>
        <button class="primary" value="default" type="submit">Save</button>
      </div>
    </form>
  </dialog>
  <script>
    const state = { rows: [], editingId: null };
    const rowsEl = document.getElementById("rows");
    const messageEl = document.getElementById("message");
    const summaryEl = document.getElementById("summary");
    const searchEl = document.getElementById("search");
    const editor = document.getElementById("editor");
    const form = document.getElementById("memoryForm");
    const formKey = document.getElementById("formKey");
    const formValue = document.getElementById("formValue");
    const formKind = document.getElementById("formKind");

    function setMessage(text, isError = false) {
      messageEl.textContent = text;
      messageEl.style.color = isError ? "var(--danger)" : "var(--muted)";
    }

    function render(result) {
      state.rows = result.entries || [];
      summaryEl.textContent = "active " + result.activeCount + " / total " + result.totalCount;
      rowsEl.replaceChildren();
      for (const row of state.rows) {
        const tr = document.createElement("tr");
        const fields = ["id", "key", "value", "kind", "status", "sourceUser", "updatedAt"];
        for (const field of fields) {
          const td = document.createElement("td");
          if (field === "id") td.className = "id";
          if (field === "value") td.className = "value";
          if ((field === "kind" || field === "status") && row[field]) {
            const span = document.createElement("span");
            span.className = "pill";
            span.textContent = row[field];
            td.append(span);
          } else {
            td.textContent = row[field] || "";
          }
          tr.append(td);
        }
        const actions = document.createElement("td");
        actions.className = "actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit";
        editButton.disabled = !row.id;
        editButton.addEventListener("click", () => openEditor(row));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger";
        deleteButton.textContent = "Delete";
        deleteButton.disabled = !row.id;
        deleteButton.addEventListener("click", () => deleteRow(row.id));
        actions.append(editButton, " ", deleteButton);
        tr.append(actions);
        rowsEl.append(tr);
      }
      setMessage(state.rows.length === 0 ? "No rows" : "");
    }

    async function loadRows(mode = "list") {
      setMessage("Loading");
      const params = new URLSearchParams({
        q: searchEl.value,
        mode,
        limit: "100",
      });
      const response = await fetch("/api/memory?" + params.toString());
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || "load failed");
      render(result);
    }

    function openEditor(row = null) {
      state.editingId = row?.id || null;
      form.reset();
      formKey.value = row?.key || "";
      formValue.value = row?.value || "";
      formKind.value = row?.kind || "semantic";
      formKey.readOnly = Boolean(row);
      editor.showModal();
      formKey.focus();
    }

    async function saveForm(event) {
      event.preventDefault();
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: state.editingId ? "update" : "create",
          id: state.editingId,
          key: formKey.value,
          value: formValue.value,
          kind: formKind.value,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.saved) {
        throw new Error(result.reason || result.detail || "save failed");
      }
      editor.close();
      await loadRows("list");
    }

    async function deleteRow(id) {
      if (!id || !confirm("Delete " + id + "?")) return;
      const response = await fetch("/api/memory/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok || !result.deleted) {
        throw new Error(result.reason || result.detail || "delete failed");
      }
      await loadRows("list");
    }

    document.getElementById("newButton").addEventListener("click", () => openEditor());
    document.getElementById("searchButton").addEventListener("click", () => loadRows("search").catch((e) => setMessage(e.message, true)));
    document.getElementById("listButton").addEventListener("click", () => loadRows("list").catch((e) => setMessage(e.message, true)));
    document.getElementById("clearButton").addEventListener("click", () => {
      searchEl.value = "";
      loadRows("list").catch((e) => setMessage(e.message, true));
    });
    document.getElementById("cancelButton").addEventListener("click", () => editor.close());
    editor.addEventListener("close", () => {
      state.editingId = null;
      formKey.readOnly = false;
    });
    form.addEventListener("submit", (event) => saveForm(event).catch((e) => setMessage(e.message, true)));
    searchEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadRows("search").catch((e) => setMessage(e.message, true));
      }
    });
    loadRows("list").catch((e) => setMessage(e.message, true));
  </script>
</body>
</html>`;
}

export function createServer(options) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (!isAuthorized(options, req)) {
      sendUnauthorized(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, renderHtml());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(options, req, res, url);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}

function printHelp() {
  console.log(`Usage: node scripts/memory-web.mjs [options]

Options:
  --host <host>          bind host, default ${DEFAULT_HOST}
  --port <port>          bind port, default ${DEFAULT_PORT}
  --ssh-host <host>      SSH host, default ${DEFAULT_SSH_HOST}
  --wsl-distro <name>    WSL distro on SSH host, default ${DEFAULT_WSL_DISTRO}
  --service <name>       mem0 service/container name, default ${DEFAULT_SERVICE_NAME}
  --target <mode>        ssh-wsl or direct, default ${DEFAULT_TARGET}
  --endpoint <url>       direct mode mem0 endpoint, default ${DEFAULT_ENDPOINT}
  --api-key <key>        direct mode X-API-Key
  --user-id <id>         mem0 user_id scope, default ${DEFAULT_USER_ID}
  --agent-id <id>        mem0 agent_id scope, default ${DEFAULT_AGENT_ID}
  --run-id <id>          mem0 run_id scope
  --app-id <id>          metadata app_id for creates, default ${DEFAULT_APP_ID}
  --limit <n>            list/search limit, default 100
  --basic-user <user>    Basic auth user, default admin when password is set
  --basic-password <pw>  Basic auth password
  --allow-unsafe-no-auth Allow non-loopback bind without Basic auth
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (
    !isLoopbackHost(options.host) &&
    !options.basicPassword &&
    !options.allowUnsafeNoAuth
  ) {
    console.error(
      "Refusing to bind a non-loopback host without --basic-password."
    );
    process.exit(1);
  }
  const server = createServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`twitchRaid memory WebUI: http://${options.host}:${options.port}/`);
  });
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
