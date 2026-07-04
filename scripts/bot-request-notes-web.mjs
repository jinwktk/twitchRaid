#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3222;
const DEFAULT_SSH_HOST = "sub";
const DEFAULT_WSL_DISTRO = "Ubuntu-Backup";
const DEFAULT_SERVICE_NAME = "twitch-raid-apcz9n";
const DEFAULT_TARGET = "ssh-wsl";
const DEFAULT_DB_PATH = "/app/data/bot-request-notes.sqlite";
const DEFAULT_LIMIT = 100;
const STATUSES = new Set([
  "all",
  "open",
  "pending",
  "planned",
  "done",
  "rejected",
  "duplicate",
]);
const UPDATE_STATUSES = new Set([
  "pending",
  "planned",
  "done",
  "rejected",
  "duplicate",
]);

export function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    sshHost: DEFAULT_SSH_HOST,
    wslDistro: DEFAULT_WSL_DISTRO,
    serviceName: DEFAULT_SERVICE_NAME,
    target: DEFAULT_TARGET,
    dbPath: process.env.BOT_REQUEST_NOTES_WEB_DB_PATH || DEFAULT_DB_PATH,
    limit: DEFAULT_LIMIT,
    basicUser: process.env.BOT_REQUEST_NOTES_WEB_BASIC_USER || "",
    basicPassword: process.env.BOT_REQUEST_NOTES_WEB_BASIC_PASSWORD || "",
    allowUnsafeNoAuth: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
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
    } else if (arg === "--db-path" && next) {
      options.dbPath = next;
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

function normalizeStatus(value, fallback = "all") {
  const status = singleLine(value);
  return STATUSES.has(status) ? status : fallback;
}

function normalizeUpdateStatus(value) {
  const status = singleLine(value);
  return UPDATE_STATUSES.has(status) ? status : "";
}

function normalizeLimit(value, fallback) {
  const limit = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(limit, 500);
}

function isOpenStatus(status) {
  return status === "pending" || status === "planned";
}

function rowToNote(row) {
  return {
    id: Number(row.id),
    status: singleLine(row.status) || "pending",
    category: singleLine(row.category) || "feature",
    summary: singleLine(row.summary),
    evidence: singleLine(row.evidence),
    sourceUser: singleLine(row.source_user),
    observedCount: Number(row.observed_count || 1),
    createdAt: singleLine(row.created_at),
    updatedAt: singleLine(row.updated_at),
    lastObservedAt: singleLine(row.last_observed_at),
    resolvedAt: singleLine(row.resolved_at),
    operatorNote: singleLine(row.operator_note),
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_request_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      category TEXT NOT NULL DEFAULT 'feature',
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source_user TEXT NOT NULL DEFAULT 'unknown',
      observed_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      operator_note TEXT NOT NULL DEFAULT ''
    );
  `);
}

function createSqliteClient(dbPath) {
  function withDb(fn) {
    const db = new DatabaseSync(dbPath);
    try {
      migrate(db);
      return fn(db);
    } finally {
      db.close();
    }
  }

  return {
    list({ status, queryText, limit }) {
      return withDb((db) => {
        const rows = db
          .prepare(
            `
            SELECT id, status, category, summary, evidence, source_user,
                   observed_count, created_at, updated_at, last_observed_at,
                   resolved_at, operator_note
            FROM bot_request_notes
            ORDER BY
              CASE status WHEN 'pending' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
              updated_at DESC
          `
          )
          .all();
        const query = singleLine(queryText).toLowerCase();
        const listStatus = normalizeStatus(status);
        const entries = rows
          .map(rowToNote)
          .filter((entry) => {
            if (listStatus === "all") return true;
            if (listStatus === "open") return isOpenStatus(entry.status);
            return entry.status === listStatus;
          })
          .filter((entry) => {
            if (!query) return true;
            return [
              entry.summary,
              entry.evidence,
              entry.sourceUser,
              entry.category,
              entry.operatorNote,
            ]
              .join(" ")
              .toLowerCase()
              .includes(query);
          })
          .slice(0, normalizeLimit(limit, DEFAULT_LIMIT));
        const all = rows.map(rowToNote);
        return {
          entries,
          totalCount: all.length,
          openCount: all.filter((entry) => isOpenStatus(entry.status)).length,
        };
      });
    },
    update({ id, status, operatorNote }) {
      return withDb((db) => {
        const noteId = Number.parseInt(String(id), 10);
        const nextStatus = normalizeUpdateStatus(status);
        if (!Number.isFinite(noteId) || noteId <= 0 || !nextStatus) {
          return { updated: false, reason: "invalid_request" };
        }
        const existing = db
          .prepare("SELECT id, operator_note FROM bot_request_notes WHERE id = ?")
          .get(noteId);
        if (!existing) return { updated: false, reason: "not_found" };
        const now = new Date().toISOString();
        const resolvedAt = isOpenStatus(nextStatus) ? "" : now;
        db.prepare(
          `
          UPDATE bot_request_notes
          SET status = ?, operator_note = ?, resolved_at = ?, updated_at = ?
          WHERE id = ?
        `
        ).run(nextStatus, singleLine(operatorNote), resolvedAt, now, noteId);
        const row = db
          .prepare(
            `
            SELECT id, status, category, summary, evidence, source_user,
                   observed_count, created_at, updated_at, last_observed_at,
                   resolved_at, operator_note
            FROM bot_request_notes
            WHERE id = ?
          `
          )
          .get(noteId);
        return { updated: true, reason: "updated", note: rowToNote(row) };
      });
    },
  };
}

export async function executeRequestNoteOperation(client, scope, request) {
  const limit =
    Number.isFinite(request.limit) && request.limit > 0
      ? request.limit
      : scope.limit;
  if (request.action === "list") {
    return client.list({
      status: normalizeStatus(request.status, "open"),
      queryText: singleLine(request.queryText),
      limit,
    });
  }
  if (request.action === "update") {
    return client.update({
      id: request.id,
      status: request.status,
      operatorNote: request.operatorNote,
    });
  }
  throw new Error("unknown_action");
}

export function buildListRequestFromUrl(url, defaultLimit) {
  return {
    action: "list",
    status: normalizeStatus(url.searchParams.get("status"), "open"),
    queryText: url.searchParams.get("q") || "",
    limit: normalizeLimit(url.searchParams.get("limit"), defaultLimit),
  };
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
    if (lines[index].startsWith("{")) return JSON.parse(lines[index]);
  }
  throw new Error("remote command did not return JSON");
}

function buildRemoteScript({ serviceName, dbPath, request, scope }) {
  const payload = Buffer.from(JSON.stringify({ request, scope, dbPath }), "utf8")
    .toString("base64url");
  return `set -eu
SERVICE_NAME=${shellQuote(serviceName)}
BOT_REQUEST_NOTES_WEB_REQUEST=${shellQuote(payload)}
CID=$(docker ps --filter "name=$SERVICE_NAME" --format "{{.ID}}" | head -n 1)
if [ -z "$CID" ]; then
  printf '%s\\n' '{"ok":false,"error":"container_not_found"}'
  exit 0
fi
docker exec -i -e BOT_REQUEST_NOTES_WEB_REQUEST="$BOT_REQUEST_NOTES_WEB_REQUEST" "$CID" node --input-type=module - <<'NODE'
import { DatabaseSync } from "node:sqlite";
const raw = process.env.BOT_REQUEST_NOTES_WEB_REQUEST;
const padded = raw + "=".repeat((4 - raw.length % 4) % 4);
const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
const request = payload.request;
const scope = payload.scope;
const dbPath = payload.dbPath;
const statuses = new Set(["all", "open", "pending", "planned", "done", "rejected", "duplicate"]);
const updateStatuses = new Set(["pending", "planned", "done", "rejected", "duplicate"]);
const clean = (value) => String(value ?? "").replace(/\\s+/gu, " ").trim();
const isOpen = (status) => status === "pending" || status === "planned";
const normalizeStatus = (value, fallback = "open") => statuses.has(clean(value)) ? clean(value) : fallback;
const normalizeUpdateStatus = (value) => updateStatuses.has(clean(value)) ? clean(value) : "";
const rowToNote = (row) => ({
  id: Number(row.id),
  status: clean(row.status) || "pending",
  category: clean(row.category) || "feature",
  summary: clean(row.summary),
  evidence: clean(row.evidence),
  sourceUser: clean(row.source_user),
  observedCount: Number(row.observed_count || 1),
  createdAt: clean(row.created_at),
  updatedAt: clean(row.updated_at),
  lastObservedAt: clean(row.last_observed_at),
  resolvedAt: clean(row.resolved_at),
  operatorNote: clean(row.operator_note),
});
const db = new DatabaseSync(dbPath);
try {
  db.exec(\`
    CREATE TABLE IF NOT EXISTS bot_request_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      category TEXT NOT NULL DEFAULT 'feature',
      summary TEXT NOT NULL,
      evidence TEXT NOT NULL,
      source_user TEXT NOT NULL DEFAULT 'unknown',
      observed_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT '',
      operator_note TEXT NOT NULL DEFAULT ''
    );
  \`);
  const action = request.action;
  if (action === "list") {
    const rows = db.prepare(\`
      SELECT id, status, category, summary, evidence, source_user,
             observed_count, created_at, updated_at, last_observed_at,
             resolved_at, operator_note
      FROM bot_request_notes
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
               updated_at DESC
    \`).all();
    const query = clean(request.queryText).toLowerCase();
    const status = normalizeStatus(request.status);
    const limit = Math.min(Number(request.limit || scope.limit || 100), 500);
    const all = rows.map(rowToNote);
    const entries = all
      .filter((entry) => status === "all" ? true : status === "open" ? isOpen(entry.status) : entry.status === status)
      .filter((entry) => !query || [entry.summary, entry.evidence, entry.sourceUser, entry.category, entry.operatorNote].join(" ").toLowerCase().includes(query))
      .slice(0, limit);
    console.log(JSON.stringify({ ok: true, result: { entries, totalCount: all.length, openCount: all.filter((entry) => isOpen(entry.status)).length } }));
  } else if (action === "update") {
    const id = Number(request.id);
    const status = normalizeUpdateStatus(request.status);
    if (!Number.isFinite(id) || id <= 0 || !status) throw new Error("invalid_request");
    const now = new Date().toISOString();
    const resolvedAt = isOpen(status) ? "" : now;
    const result = db.prepare("UPDATE bot_request_notes SET status = ?, operator_note = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
      .run(status, clean(request.operatorNote), resolvedAt, now, id);
    if (result.changes <= 0) throw new Error("not_found");
    const row = db.prepare(\`
      SELECT id, status, category, summary, evidence, source_user,
             observed_count, created_at, updated_at, last_observed_at,
             resolved_at, operator_note
      FROM bot_request_notes WHERE id = ?
    \`).get(id);
    console.log(JSON.stringify({ ok: true, result: { updated: true, reason: "updated", note: rowToNote(row) } }));
  } else {
    throw new Error("unknown_action");
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message || error) }));
} finally {
  db.close();
}
NODE
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
          reject(new Error(payload.error || "remote error"));
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
        dbPath: options.dbPath,
        request,
        scope: options,
      })
    );
  });
}

async function runRequestNoteOperation(options, request) {
  if (options.target === "direct") {
    return executeRequestNoteOperation(
      createSqliteClient(options.dbPath),
      options,
      request
    );
  }
  return runRemoteRawOperation(options, request);
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
    "www-authenticate": 'Basic realm="twitchRaid Bot Request Notes"',
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

async function handleApiRequest(options, req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/notes") {
      const result = await runRequestNoteOperation(
        options,
        buildListRequestFromUrl(url, options.limit)
      );
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "PATCH" && url.pathname.startsWith("/api/notes/")) {
      const id = Number.parseInt(
        decodeURIComponent(url.pathname.slice("/api/notes/".length)),
        10
      );
      const body = await readRequestBody(req);
      const result = await runRequestNoteOperation(options, {
        action: "update",
        id,
        status: body.status,
        operatorNote: body.operatorNote,
      });
      sendJson(res, result.updated ? 200 : 400, result);
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "bot_request_notes_web_error",
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
  <title>twitchRaid Bot Request Notes</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", system-ui, sans-serif;
      --bg: #f5f6f8;
      --panel: #ffffff;
      --line: #d8dee8;
      --text: #1d2733;
      --muted: #667085;
      --accent: #1769aa;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
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
    input, select, textarea { width: 100%; padding: 8px 10px; }
    textarea { resize: vertical; min-height: 92px; }
    button { padding: 8px 12px; cursor: pointer; white-space: nowrap; }
    button.primary { border-color: var(--accent); background: var(--accent); color: #fff; }
    .meta, .status-line { color: var(--muted); font-size: 13px; }
    .status-line { min-height: 20px; margin: 0 0 10px; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); background: var(--panel); }
    table { width: 100%; border-collapse: collapse; min-width: 1100px; }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th { position: sticky; top: 0; background: #eef2f7; z-index: 1; font-size: 12px; }
    td.summary, td.evidence { max-width: 360px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pill { display: inline-flex; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; font-size: 12px; background: #f8fafc; }
    dialog { width: min(620px, calc(100vw - 28px)); border: 1px solid var(--line); border-radius: 8px; padding: 0; }
    dialog::backdrop { background: rgb(15 23 42 / 0.35); }
    .dialog-body { display: grid; gap: 12px; padding: 16px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--line); padding: 12px 16px; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 12px; }
    @media (max-width: 760px) {
      header { align-items: flex-start; flex-direction: column; }
      main { padding: 14px; }
      .toolbar { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>twitchRaid Bot Request Notes</h1>
      <div class="meta" id="summary">loading</div>
    </div>
  </header>
  <main>
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search summary, evidence, source">
      <select id="status">
        <option value="open">open</option>
        <option value="pending">pending</option>
        <option value="planned">planned</option>
        <option value="done">done</option>
        <option value="rejected">rejected</option>
        <option value="duplicate">duplicate</option>
        <option value="all">all</option>
      </select>
      <button id="loadButton" type="button">Load</button>
      <button id="clearButton" type="button">Clear</button>
    </div>
    <p class="status-line" id="message"></p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>status</th>
            <th>category</th>
            <th>summary</th>
            <th>evidence</th>
            <th>source</th>
            <th>observed</th>
            <th>updated</th>
            <th>operatorNote</th>
            <th>actions</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </main>
  <dialog id="editor">
    <form method="dialog" id="noteForm">
      <div class="dialog-body">
        <label>status<select id="formStatus" name="status">
          <option value="pending">pending</option>
          <option value="planned">planned</option>
          <option value="done">done</option>
          <option value="rejected">rejected</option>
          <option value="duplicate">duplicate</option>
        </select></label>
        <label>operatorNote<textarea id="formOperatorNote" name="operatorNote" maxlength="500"></textarea></label>
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
    const statusEl = document.getElementById("status");
    const editor = document.getElementById("editor");
    const form = document.getElementById("noteForm");
    const formStatus = document.getElementById("formStatus");
    const formOperatorNote = document.getElementById("formOperatorNote");

    function setMessage(text, isError = false) {
      messageEl.textContent = text;
      messageEl.style.color = isError ? "#b42318" : "var(--muted)";
    }
    function pill(text) {
      const span = document.createElement("span");
      span.className = "pill";
      span.textContent = text || "";
      return span;
    }
    function render(result) {
      state.rows = result.entries || [];
      summaryEl.textContent = "open " + result.openCount + " / total " + result.totalCount;
      rowsEl.replaceChildren();
      for (const row of state.rows) {
        const tr = document.createElement("tr");
        for (const field of ["id", "status", "category", "summary", "evidence", "sourceUser", "observedCount", "updatedAt", "operatorNote"]) {
          const td = document.createElement("td");
          if (field === "summary") td.className = "summary";
          if (field === "evidence") td.className = "evidence";
          if (field === "status" || field === "category") td.append(pill(row[field]));
          else td.textContent = row[field] || "";
          tr.append(td);
        }
        const actions = document.createElement("td");
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.textContent = "Edit";
        editButton.addEventListener("click", () => openEditor(row));
        actions.append(editButton);
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
        limit: "100",
      });
      const response = await fetch("/api/notes?" + params.toString());
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || result.error || "load failed");
      render(result);
    }
    function openEditor(row) {
      state.editingId = row.id;
      formStatus.value = row.status || "pending";
      formOperatorNote.value = row.operatorNote || "";
      editor.showModal();
      formStatus.focus();
    }
    async function saveForm(event) {
      event.preventDefault();
      const response = await fetch("/api/notes/" + encodeURIComponent(state.editingId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: formStatus.value,
          operatorNote: formOperatorNote.value,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.updated) throw new Error(result.reason || result.detail || "save failed");
      editor.close();
      await loadRows();
    }
    document.getElementById("loadButton").addEventListener("click", () => loadRows().catch((e) => setMessage(e.message, true)));
    document.getElementById("clearButton").addEventListener("click", () => {
      searchEl.value = "";
      statusEl.value = "open";
      loadRows().catch((e) => setMessage(e.message, true));
    });
    document.getElementById("cancelButton").addEventListener("click", () => editor.close());
    form.addEventListener("submit", (event) => saveForm(event).catch((e) => setMessage(e.message, true)));
    searchEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadRows().catch((e) => setMessage(e.message, true));
      }
    });
    loadRows().catch((e) => setMessage(e.message, true));
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
  console.log(`Usage: node scripts/bot-request-notes-web.mjs [options]

Options:
  --host <host>          bind host, default ${DEFAULT_HOST}
  --port <port>          bind port, default ${DEFAULT_PORT}
  --ssh-host <host>      SSH host, default ${DEFAULT_SSH_HOST}
  --wsl-distro <name>    WSL distro on SSH host, default ${DEFAULT_WSL_DISTRO}
  --service <name>       bot service/container name, default ${DEFAULT_SERVICE_NAME}
  --target <mode>        ssh-wsl or direct, default ${DEFAULT_TARGET}
  --db-path <path>       SQLite DB path, default ${DEFAULT_DB_PATH}
  --limit <n>            list limit, default ${DEFAULT_LIMIT}
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
    console.log(
      `twitchRaid Bot Request Notes WebUI: http://${options.host}:${options.port}/`
    );
  });
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
