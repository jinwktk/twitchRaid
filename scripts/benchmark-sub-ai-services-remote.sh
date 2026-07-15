set -euo pipefail

services=(
  sub-ai_ollama
  sub-ai_mem0
  sub-ai_qdrant
  sub-ai_searxng
  sub-ai_whisper-api
  sub-ai_sbvits2
)

started_at=$(date --iso-8601=seconds)

task_snapshot() {
  for service in "${services[@]}"; do
    task=$(docker service ps --filter desired-state=running --format '{{.ID}}' "$service" | head -1)
    printf '%s=%s\n' "$service" "$task"
  done
}

verify_running_containers() {
  for container in $(docker ps --format '{{.Names}}' | grep '^sub-ai_'); do
    restarts=$(docker inspect "$container" --format '{{.RestartCount}}')
    if [ "$restarts" != "0" ]; then
      echo "container $container restarted $restarts times" >&2
      exit 21
    fi
  done
}

for service in "${services[@]}"; do
  replicas=$(docker service ls --format '{{.Name}} {{.Replicas}}' | awk -v name="$service" '$1 == name { print $2 }')
  if [ "$replicas" != "1/1" ]; then
    echo "service $service is not healthy: $replicas" >&2
    exit 20
  fi
done

verify_running_containers
tasks_before=$(task_snapshot)

bot=$(docker ps --format '{{.Names}}' | grep '^twitch-raid-apcz9n' | head -1)
if [ -z "$bot" ]; then
  echo "twitchRaid Bot container is not running" >&2
  exit 22
fi

result=$(docker exec -i "$bot" node <<'NODE'
const { performance } = require("node:perf_hooks");

const ollamaBaseUrl = "http://sub-ai_ollama:11434";
const mem0BaseUrl = "http://mem0:8888";
const searxngUrl = new URL("http://searxng:8080/search");
const model = process.env.CHAT_AI_MODEL || "qwen3.5:9b";
const embedModel = process.env.CHAT_AI_MEM0_EMBED_MODEL || "nomic-embed-text:latest";
const apiKey = process.env.CHAT_AI_MEM0_API_KEY || "";

function verifyEffectiveBotConfig() {
  const required = new Map([
    ["CHAT_AI_ENABLED", "true"],
    ["CHAT_AI_BASE_URL", ollamaBaseUrl],
    ["OLLAMA_BASE_URL", ollamaBaseUrl],
    ["OLLAMA_SHOUTOUT_ENABLED", "true"],
    ["CHAT_AI_MEMORY_ENABLED", "true"],
    ["CHAT_AI_MEMORY_STORE", "sqlite"],
    ["CHAT_AI_MEM0_ENABLED", "true"],
    ["CHAT_AI_MEM0_ENDPOINT", mem0BaseUrl],
    ["CHAT_AI_SEARCH_ENABLED", "true"],
    ["CHAT_AI_SEARCH_PROVIDER", "searxng"],
    [
      "CHAT_AI_SEARCH_ENDPOINT",
      "http://searxng:8080/search?language=all&safesearch=0",
    ],
    ["CHAT_AI_SEARCH_ENGINES", "bing"],
    ["CHAT_AI_PREWARM_ENABLED", "true"],
    ["CHAT_AI_PREWARM_PRIME_ENABLED", "true"],
    ["CHAT_AI_MEM0_EMBED_PREWARM_ENABLED", "true"],
    ["CHAT_AI_MEM0_SEARCH_PREWARM_ENABLED", "true"],
  ]);
  for (const [name, expected] of required) {
    if (process.env[name] !== expected) {
      throw new Error(`effective Bot setting ${name} does not match production contract`);
    }
  }
  if (!apiKey) throw new Error("effective Bot mem0 API key is missing");
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function fetchJson(url, init, timeoutMs = 180_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function measure(operation, samples) {
  const durations = [];
  let lastValue;
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    lastValue = await operation();
    durations.push(performance.now() - startedAt);
  }
  return {
    samples: durations.length,
    minMs: Math.min(...durations),
    averageMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    p95Ms: percentile95(durations),
    maxMs: Math.max(...durations),
    lastValue,
  };
}

async function main() {
  verifyEffectiveBotConfig();

  await fetchJson(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: "30m" }),
  });

  const generate = await measure(async () => {
    const body = await fetchJson(`${ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        system: "質問に日本語で簡潔に答えてください。",
        prompt: "1+1を数字だけで答えてください。",
        stream: false,
        think: false,
        keep_alive: "30m",
        options: { temperature: 0, num_ctx: 4096, num_predict: 8 },
      }),
    });
    if (typeof body.response !== "string" || body.response.trim() !== "2") {
      throw new Error("fixed generation contract failed");
    }
    if (body.done_reason !== "stop") throw new Error("generation did not stop cleanly");
    return { responseMatched: true, doneReason: body.done_reason || null };
  }, 20);

  await fetchJson(`${ollamaBaseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input: "warmup" }),
  });
  const embed = await measure(async () => {
    const body = await fetchJson(`${ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, input: "好きな食べ物なんだっけ？" }),
    });
    if (
      !Array.isArray(body.embeddings) ||
      body.embeddings.length !== 1 ||
      !Array.isArray(body.embeddings[0]) ||
      body.embeddings[0].length !== 768
    ) {
      throw new Error("embedding response contract failed");
    }
    return { vectorCount: body.embeddings.length, vectorDimensions: 768 };
  }, 20);

  const mem0Headers = { "Content-Type": "application/json" };
  if (apiKey) mem0Headers["X-API-Key"] = apiKey;
  const mem0Payload = JSON.stringify({
    query: "好きな食べ物なんだっけ？",
    user_id: process.env.CHAT_AI_MEM0_USER_ID || "rukalun",
    agent_id: process.env.CHAT_AI_MEM0_AGENT_ID || "twitchRaid",
    top_k: 3,
    threshold: 0.5,
  });
  await fetchJson(`${mem0BaseUrl}/search`, {
    method: "POST",
    headers: mem0Headers,
    body: mem0Payload,
  });
  const mem0 = await measure(async () => {
    const body = await fetchJson(`${mem0BaseUrl}/search`, {
      method: "POST",
      headers: mem0Headers,
      body: mem0Payload,
    });
    const results = Array.isArray(body) ? body : body.results || body.memories;
    if (
      !Array.isArray(results) ||
      results.length === 0 ||
      results.some((item) => typeof item?.score !== "number" || item.score < 0.5)
    ) {
      throw new Error("mem0 response contract failed");
    }
    return {
      resultCount: results.length,
      minimumScore: Math.min(...results.map((item) => item.score)),
    };
  }, 20);

  searxngUrl.searchParams.set("q", "OpenAI");
  searxngUrl.searchParams.set("format", "json");
  searxngUrl.searchParams.set("language", "ja-JP");
  searxngUrl.searchParams.set("safesearch", "1");
  searxngUrl.searchParams.set("engines", "bing");
  await fetchJson(searxngUrl, undefined, 10_000);
  const searxng = await measure(async () => {
    const body = await fetchJson(searxngUrl, undefined, 10_000);
    if (
      !Array.isArray(body.results) ||
      body.results.length === 0 ||
      body.results.some(
        (item) =>
          typeof item?.title !== "string" ||
          item.title.length === 0 ||
          typeof item?.url !== "string" ||
          !/^https?:\/\//u.test(item.url)
      )
    ) {
      throw new Error("SearXNG response contract failed");
    }
    return { resultCount: body.results.length };
  }, 20);

  console.log(JSON.stringify({ generate, embed, mem0, searxng }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
)

verify_running_containers
tasks_after=$(task_snapshot)
if [ "$tasks_before" != "$tasks_after" ]; then
  echo "SUB AI service task changed during benchmark" >&2
  exit 23
fi

sleep 1
log_file=$(mktemp)
trap 'rm -f "$log_file"' EXIT
for container in $(docker ps --format '{{.Names}}' | grep '^sub-ai_'); do
  if ! docker logs --since "$started_at" "$container" >>"$log_file" 2>&1; then
    echo "failed to inspect SUB AI logs" >&2
    exit 25
  fi
done
if grep -Ei '(^|[[:space:]])(ERROR|FATAL|PANIC)([[:space:]:]|$)|out of memory|CUDA error' "$log_file" >/dev/null; then
  echo "SUB AI error log detected during benchmark" >&2
  exit 24
fi

printf '%s\n' "$result"
