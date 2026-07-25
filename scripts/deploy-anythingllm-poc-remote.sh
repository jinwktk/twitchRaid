#!/usr/bin/env bash

set -euo pipefail

storage_root="${ANYTHING_LLM_STORAGE_ROOT:-/home/mlove/dokploy/anythingllm}"
storage_dir="${storage_root}/storage"
env_file="${storage_root}/.env"
service_name="${ANYTHING_LLM_SERVICE_NAME:-anythingllm}"
image="mintplexlabs/anythingllm:1.15.0@sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f"

if [[ ! "${service_name}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  printf 'ANYTHING_LLM_SERVICE_NAME contains unsupported characters.\n' >&2
  exit 1
fi
if [[ ! -d "${storage_dir}" || ! -f "${env_file}" ]]; then
  printf 'Run bootstrap-anythingllm-poc-remote.sh before deploying the service.\n' >&2
  exit 1
fi
if [[ "$(stat -c '%a' "${env_file}")" != "600" ]]; then
  printf 'AnythingLLM authentication file must have mode 0600.\n' >&2
  exit 1
fi

if docker service inspect "${service_name}" >/dev/null 2>&1; then
  current_image="$(
    docker service inspect \
      --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' \
      "${service_name}"
  )"
  if [[ "${current_image}" != "${image}" ]]; then
    printf 'Existing AnythingLLM service uses a different image.\n' >&2
    exit 1
  fi
  printf 'AnythingLLM service already exists; no changes were made.\n'
  exit 0
fi

docker service create \
  --detach=true \
  --name "${service_name}" \
  --label twitchraid.purpose=anythingllm-isolated-poc \
  --replicas 1 \
  --constraint node.role==manager \
  --network name=dokploy-network,alias=anythingllm \
  --restart-condition any \
  --restart-delay 5s \
  --update-order stop-first \
  --update-failure-action rollback \
  --rollback-order stop-first \
  --mount "type=bind,source=${storage_dir},target=/app/server/storage" \
  --mount "type=bind,source=${env_file},target=/app/server/.env" \
  --env NODE_ENV=production \
  --env STORAGE_DIR=/app/server/storage \
  --env LLM_PROVIDER=ollama \
  --env OLLAMA_BASE_PATH=http://ollama:11434 \
  --env OLLAMA_MODEL_PREF=gemma4:e4b-it-qat \
  --env OLLAMA_MODEL_TOKEN_LIMIT=4096 \
  --env OLLAMA_RESPONSE_TIMEOUT=180000 \
  --env EMBEDDING_ENGINE=ollama \
  --env EMBEDDING_BASE_PATH=http://ollama:11434 \
  --env EMBEDDING_MODEL_PREF=nomic-embed-text:latest \
  --env EMBEDDING_MODEL_MAX_CHUNK_LENGTH=8192 \
  --env VECTOR_DB=qdrant \
  --env QDRANT_ENDPOINT=http://qdrant:6333 \
  --env AGENT_SEARXNG_API_URL=http://searxng:8080 \
  --env AGENT_MAX_TOOL_CALLS=5 \
  --env DISABLE_TELEMETRY=true \
  --env DISABLE_SWAGGER_DOCS=true \
  --env EMBED_REQUIRE_ALLOWLIST=true \
  --env ANYTHINGLLM_CHROMIUM_ARGS=--no-sandbox,--disable-setuid-sandbox \
  --env TZ=Asia/Tokyo \
  "${image}" >/dev/null

printf 'AnythingLLM service was created without publishing an external port.\n'
