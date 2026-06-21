#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3220;
const DEFAULT_SSH_HOST = "sub";
const DEFAULT_WSL_DISTRO = "Ubuntu-Backup";
const DEFAULT_SERVICE_NAME = "twitch-raid-apcz9n";

function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    sshHost: DEFAULT_SSH_HOST,
    wslDistro: DEFAULT_WSL_DISTRO,
    serviceName: DEFAULT_SERVICE_NAME,
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
    }
  }

  return options;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

function buildRemoteScript({ serviceName, request }) {
  const requestJson = Buffer.from(JSON.stringify(request), "utf8").toString(
    "base64url"
  );
  return `set -eu
SERVICE_NAME=${shellQuote(serviceName)}
MEMORY_WEB_REQUEST=${shellQuote(requestJson)}
CID=$(docker ps --filter "name=$SERVICE_NAME" --format "{{.ID}}" | head -n 1)
if [ -z "$CID" ]; then
  printf '%s\\n' '{"ok":false,"error":"container_not_found"}'
  exit 0
fi
docker exec -i -w /app -e MEMORY_WEB_REQUEST="$MEMORY_WEB_REQUEST" "$CID" node <<'NODE'
const request = JSON.parse(Buffer.from(process.env.MEMORY_WEB_REQUEST, "base64url").toString("utf8"));
const memory = require("./dist/commands/mention-chat-memory.js");
const common = {
  store: "sqlite",
  jsonPath: "/app/data/chat-ai-memory.json",
  sqlitePath: "/app/data/chat-ai-memory.sqlite",
};

function json(payload) {
  console.log(JSON.stringify(payload));
}

try {
  if (request.action === "list") {
    json({
      ok: true,
      result: memory.listMentionChatMemoryEntriesStore({
        ...common,
        status: request.status,
        queryText: request.queryText,
        limit: request.limit,
      }),
    });
  } else if (request.action === "upsert") {
    json({
      ok: true,
      result: memory.upsertMentionChatMemoryEntryStore({
        ...common,
        key: request.key,
        value: request.value,
        kind: request.kind,
        status: request.status,
        sourceUser: "memory-web",
        maxItems: 50,
      }),
    });
  } else if (request.action === "delete") {
    json({
      ok: true,
      result: memory.deleteMentionChatMemoryEntryStore({
        ...common,
        key: request.key,
      }),
    });
  } else {
    json({ ok: false, error: "unknown_action" });
  }
} catch (error) {
  json({
    ok: false,
    error: "operation_failed",
    detail: error instanceof Error ? error.message : String(error),
  });
}
NODE
`;
}

function runRemoteMemoryOperation(options, request) {
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

    child.stdin.end(buildRemoteScript({ serviceName: options.serviceName, request }));
  });
}

async function handleApiRequest(options, req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/memory") {
      const result = await runRemoteMemoryOperation(options, {
        action: "list",
        status: url.searchParams.get("status") || "active",
        queryText: url.searchParams.get("q") || "",
        limit: Number.parseInt(url.searchParams.get("limit") || "200", 10),
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/memory") {
      const body = await readRequestBody(req);
      const result = await runRemoteMemoryOperation(options, {
        action: "upsert",
        key: String(body.key || ""),
        value: String(body.value || ""),
        kind: body.kind === "implicit" ? "implicit" : "semantic",
        status: body.status === "inactive" ? "inactive" : "active",
      });
      sendJson(res, result.saved ? 200 : 400, result);
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/memory/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/memory/".length));
      const result = await runRemoteMemoryOperation(options, {
        action: "delete",
        key,
      });
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

function renderHtml() {
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
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: 0;
    }
    main { padding: 18px 22px 28px; }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) 150px auto auto;
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
    input, select, textarea {
      width: 100%;
      padding: 8px 10px;
    }
    textarea {
      resize: vertical;
      min-height: 92px;
    }
    button {
      padding: 8px 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button.danger {
      border-color: var(--danger);
      color: var(--danger);
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
    }
    .status-line {
      min-height: 20px;
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      background: var(--panel);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }
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
    td.value {
      max-width: 420px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    td.actions {
      width: 156px;
      white-space: nowrap;
    }
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
    .dialog-body {
      display: grid;
      gap: 12px;
      padding: 16px;
    }
    .dialog-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid var(--line);
      padding: 12px 16px;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }
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
      <input id="search" type="search" placeholder="Search">
      <select id="status">
        <option value="active">active</option>
        <option value="inactive">inactive</option>
        <option value="all">all</option>
      </select>
      <button id="refreshButton" type="button">Refresh</button>
      <button id="clearButton" type="button">Clear</button>
    </div>
    <p class="status-line" id="message"></p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
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
        <label>key<input id="formKey" name="key" required maxlength="40"></label>
        <label>value<textarea id="formValue" name="value" required maxlength="120"></textarea></label>
        <div class="dialog-row">
          <label>kind<select id="formKind" name="kind">
            <option value="semantic">semantic</option>
            <option value="implicit">implicit</option>
          </select></label>
          <label>status<select id="formStatus" name="status">
            <option value="active">active</option>
            <option value="inactive">inactive</option>
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
    const state = { rows: [] };
    const rowsEl = document.getElementById("rows");
    const messageEl = document.getElementById("message");
    const summaryEl = document.getElementById("summary");
    const searchEl = document.getElementById("search");
    const statusEl = document.getElementById("status");
    const editor = document.getElementById("editor");
    const form = document.getElementById("memoryForm");
    const formKey = document.getElementById("formKey");
    const formValue = document.getElementById("formValue");
    const formKind = document.getElementById("formKind");
    const formStatus = document.getElementById("formStatus");

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
        const cells = [
          row.key,
          row.value,
          row.kind,
          row.status,
          row.sourceUser,
          row.updatedAt,
        ];
        for (const value of cells) {
          const td = document.createElement("td");
          if (value === row.value) td.className = "value";
          if (value === row.kind || value === row.status) {
            const span = document.createElement("span");
            span.className = "pill";
            span.textContent = value;
            td.append(span);
          } else {
            td.textContent = value || "";
          }
          tr.append(td);
        }
        const actions = document.createElement("td");
        actions.className = "actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => openEditor(row));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteRow(row.key));
        actions.append(editButton, " ", deleteButton);
        tr.append(actions);
        rowsEl.append(tr);
      }
      setMessage(state.rows.length === 0 ? "No rows" : "");
    }

    async function loadRows() {
      setMessage("Loading");
      const params = new URLSearchParams({
        q: searchEl.value,
        status: statusEl.value,
        limit: "200",
      });
      const response = await fetch("/api/memory?" + params.toString());
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || "load failed");
      render(result);
    }

    function openEditor(row = null) {
      formKey.value = row?.key || "";
      formValue.value = row?.value || "";
      formKind.value = row?.kind || "semantic";
      formStatus.value = row?.status || "active";
      editor.showModal();
      formKey.focus();
    }

    async function saveForm(event) {
      event.preventDefault();
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: formKey.value,
          value: formValue.value,
          kind: formKind.value,
          status: formStatus.value,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.saved) {
        throw new Error(result.reason || result.detail || "save failed");
      }
      editor.close();
      await loadRows();
    }

    async function deleteRow(key) {
      if (!confirm("Delete " + key + "?")) return;
      const response = await fetch("/api/memory/" + encodeURIComponent(key), {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok || !result.deleted) {
        throw new Error(result.reason || result.detail || "delete failed");
      }
      await loadRows();
    }

    document.getElementById("newButton").addEventListener("click", () => openEditor());
    document.getElementById("refreshButton").addEventListener("click", () => loadRows().catch((e) => setMessage(e.message, true)));
    document.getElementById("clearButton").addEventListener("click", () => {
      searchEl.value = "";
      loadRows().catch((e) => setMessage(e.message, true));
    });
    document.getElementById("cancelButton").addEventListener("click", () => editor.close());
    form.addEventListener("submit", (event) => saveForm(event).catch((e) => setMessage(e.message, true)));
    searchEl.addEventListener("input", () => loadRows().catch((e) => setMessage(e.message, true)));
    statusEl.addEventListener("change", () => loadRows().catch((e) => setMessage(e.message, true)));
    loadRows().catch((e) => setMessage(e.message, true));
  </script>
</body>
</html>`;
}

function createServer(options) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
  --service <name>       Docker service/container name, default ${DEFAULT_SERVICE_NAME}
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const server = createServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`twitchRaid memory WebUI: http://${options.host}:${options.port}/`);
  });
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

main();
