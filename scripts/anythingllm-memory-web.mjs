#!/usr/bin/env node
import http from "node:http";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3221;
const DEFAULT_LEDGER = "/app/data/anythingllm-ledger.sqlite";
const DEFAULT_KNOWLEDGE = "/app/data/anythingllm-stream-knowledge.sqlite";
const TYPES = new Set(["comments", "streams", "facts"]);

const clean = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const limitOf = (value, fallback = 100) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : fallback;
};
const portOf = (value, fallback = DEFAULT_PORT) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
};

export function buildMemoryRequestFromUrl(url, defaultLimit = 100) {
  const type = clean(url.searchParams.get("type"));
  return {
    type: TYPES.has(type) ? type : "comments",
    queryText: clean(url.searchParams.get("q")),
    limit: limitOf(url.searchParams.get("limit"), defaultLimit),
  };
}

function openReadOnly(file) {
  return new DatabaseSync(file, { readOnly: true });
}

function parseFacts(raw, stream) {
  let facts = [];
  try { facts = JSON.parse(raw || "[]"); } catch { return []; }
  return Array.isArray(facts) ? facts.map((fact) => ({
    streamId: stream.stream_id,
    title: clean(stream.title),
    subject: clean(fact.subject),
    key: clean(fact.key),
    value: clean(fact.value),
    sourceEventIds: Array.isArray(fact.sourceEventIds)
      ? fact.sourceEventIds.map(clean)
      : Array.isArray(fact.source_event_ids) ? fact.source_event_ids.map(clean) : [],
    updatedAt: clean(stream.updated_at),
  })) : [];
}

export function createMemoryReader({ ledgerPath, knowledgePath }) {
  return {
    list({ type, queryText, limit }) {
      const ledger = openReadOnly(ledgerPath);
      const knowledge = openReadOnly(knowledgePath);
      try {
        const query = clean(queryText);
        const likeQuery = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        const commentRows = ledger.prepare(`
          SELECT accepted_sequence, event_id, batch_id, channel, stream_id,
                 user_login, user_display_name, occurred_at, body, body_purged_at
          FROM anythingllm_comment_events
          WHERE ? = '' OR (body || ' ' || user_login || ' ' || user_display_name) LIKE ? ESCAPE '\\'
          ORDER BY accepted_sequence DESC LIMIT ?
        `).all(query, likeQuery, limitOf(limit));
        const comments = commentRows.map((row) => ({
          sequence: Number(row.accepted_sequence), eventId: clean(row.event_id),
          batchId: clean(row.batch_id), channel: clean(row.channel), streamId: clean(row.stream_id),
          userLogin: clean(row.user_login), userDisplayName: clean(row.user_display_name),
          occurredAt: clean(row.occurred_at), body: clean(row.body), purged: Boolean(row.body_purged_at),
        }));
        const streams = knowledge.prepare(`
          SELECT stream_id, channel, title, game_name, started_at, ended_at, status,
                 final_summary, final_facts_json, fact_count, summary_embedded,
                 facts_embedded, last_failure_reason, updated_at, completed_at
          FROM anythingllm_stream_knowledge_jobs ORDER BY ended_at DESC
        `).all();
        const allFacts = streams.flatMap((stream) => parseFacts(stream.final_facts_json, stream));
        const normalizedStreams = streams.map((row) => ({
          streamId: clean(row.stream_id), channel: clean(row.channel), title: clean(row.title),
          gameName: clean(row.game_name), startedAt: clean(row.started_at), endedAt: clean(row.ended_at),
          status: clean(row.status), summary: clean(row.final_summary), factCount: Number(row.fact_count || 0),
          summaryEmbedded: row.summary_embedded === 1, factsEmbedded: row.facts_embedded === 1,
          failureReason: clean(row.last_failure_reason), updatedAt: clean(row.updated_at),
        }));
        const batches = ledger.prepare("SELECT status, COUNT(*) AS count FROM anythingllm_ingestion_batches GROUP BY status").all();
        const ingestion = { embedded: 0, pending: 0, failed: 0 };
        for (const row of batches) {
          const count = Number(row.count);
          if (row.status === "embedded") ingestion.embedded += count;
          else if (row.status === "failed") ingestion.failed += count;
          else if (row.status === "pending" || row.status === "uploaded") ingestion.pending += count;
        }
        const loweredQuery = query.toLocaleLowerCase("ja");
        const source = type === "streams" ? normalizedStreams : type === "facts" ? allFacts : comments;
        const entries = type === "comments" ? comments : source
          .filter((entry) => !loweredQuery || Object.values(entry).flat().join(" ").toLocaleLowerCase("ja").includes(loweredQuery))
          .slice(0, limitOf(limit));
        const commentCount = Number(ledger.prepare("SELECT COUNT(*) AS count FROM anythingllm_comment_events").get().count);
        return { entries, counts: { comments: commentCount, streams: streams.length, facts: allFacts.length }, ingestion };
      } finally {
        ledger.close(); knowledge.close();
      }
    },
  };
}

export function renderMemoryHtml() {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>twitchRaid 記憶閲覧</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3}body{max-width:1200px;margin:auto;padding:24px}h1{margin-bottom:4px}.muted{color:#8b949e}.controls,.stats{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button,input{font:inherit;color:inherit;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px}button.active{background:#1f6feb}input{min-width:280px;flex:1}.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px;margin:10px 0}.meta{color:#8b949e;font-size:.9rem}.body{white-space:pre-wrap;margin-top:8px}.pill{background:#21262d;border-radius:999px;padding:7px 11px}</style></head><body>
<h1>twitchRaid 記憶閲覧</h1><div class="muted">AnythingLLMへ保存される記憶の読み取り専用ビュー</div>
<div class="controls"><button data-type="comments" class="active">コメント</button><button data-type="streams">配信要約</button><button data-type="facts">事実</button><input id="q" aria-label="記憶を検索" placeholder="記憶を検索"><button id="search">検索</button></div>
<div id="stats" class="stats"></div><main id="list">読み込み中...</main>
<script>
let type='comments';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function card(e){if(type==='comments')return '<article class="card"><div class="meta">'+esc(e.occurredAt)+' / '+esc(e.userDisplayName)+' (@'+esc(e.userLogin)+') / #'+e.sequence+'</div><div class="body">'+esc(e.purged?'[保存期限により原文削除]':e.body)+'</div></article>';if(type==='streams')return '<article class="card"><h3>'+esc(e.title||e.streamId)+'</h3><div class="meta">'+esc(e.startedAt)+' ～ '+esc(e.endedAt)+' / '+esc(e.gameName)+' / '+esc(e.status)+'</div><div class="body">'+esc(e.summary||e.failureReason||'要約処理中')+'</div></article>';return '<article class="card"><div class="meta">'+esc(e.title)+' / '+esc(e.subject)+' / 出典 '+esc(e.sourceEventIds.join(', '))+'</div><div class="body"><b>'+esc(e.key)+'</b>: '+esc(e.value)+'</div></article>'}
async function load(){const q=document.querySelector('#q').value;const r=await fetch('/api/memory?type='+type+'&q='+encodeURIComponent(q)+'&limit=200');const d=await r.json();document.querySelector('#stats').innerHTML='<span class="pill">コメント '+d.counts.comments+'</span><span class="pill">配信 '+d.counts.streams+'</span><span class="pill">事実 '+d.counts.facts+'</span><span class="pill">取込済 '+d.ingestion.embedded+' / 待機 '+d.ingestion.pending+' / 失敗 '+d.ingestion.failed+'</span>';document.querySelector('#list').innerHTML=d.entries.length?d.entries.map(card).join(''):'該当する記憶はありません';}
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{type=b.dataset.type;document.querySelectorAll('[data-type]').forEach(x=>x.classList.toggle('active',x===b));load()});document.querySelector('#search').onclick=load;document.querySelector('#q').onkeydown=e=>{if(e.key==='Enter')load()};load();
</script></body></html>`;
}

export function parseArgs(argv) {
  const out = { host: DEFAULT_HOST, port: DEFAULT_PORT, ledgerPath: process.env.ANYTHING_LLM_LEDGER_DB_PATH || DEFAULT_LEDGER, knowledgePath: process.env.ANYTHING_LLM_STREAM_KNOWLEDGE_DB_PATH || DEFAULT_KNOWLEDGE, allowLan: false };
  for (let i=0;i<argv.length;i+=1) { const next=argv[i+1]; if(argv[i]==="--host"&&next){out.host=next;i++;}else if(argv[i]==="--port"&&next){out.port=portOf(next);i++;}else if(argv[i]==="--ledger"&&next){out.ledgerPath=next;i++;}else if(argv[i]==="--knowledge"&&next){out.knowledgePath=next;i++;}else if(argv[i]==="--allow-lan"){out.allowLan=true;} }
  return out;
}

export function startServer(options) {
  if (!["127.0.0.1","localhost","::1"].includes(options.host) && !options.allowLan) throw new Error("LAN公開には --allow-lan が必要です");
  const reader=createMemoryReader(options);
  return http.createServer((req,res)=>{let url;try{url=new URL(req.url||"/","http://localhost");}catch{res.writeHead(400);res.end("Bad Request");return;}res.setHeader("cache-control","no-store");if(req.method==="GET"&&url.pathname==="/api/memory"){try{const body=JSON.stringify(reader.list(buildMemoryRequestFromUrl(url)));res.writeHead(200,{"content-type":"application/json; charset=utf-8"});res.end(body);}catch(error){res.writeHead(503,{"content-type":"application/json; charset=utf-8"});res.end(JSON.stringify({error:"memory_unavailable"}));}}else if(req.method==="GET"&&url.pathname==="/"){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(renderMemoryHtml());}else{res.writeHead(404);res.end("Not Found");}}).listen(options.port,options.host);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) { const options=parseArgs(process.argv.slice(2)); startServer(options); console.log(`記憶閲覧WebUI: http://${options.host}:${options.port}`); }
