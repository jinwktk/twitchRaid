#!/usr/bin/env bash
set -euo pipefail

# CPU-side private media processing. Inference stays on the existing Ollama/Whisper.
image="${VIDEO_ANALYSIS_IMAGE:?Set VIDEO_ANALYSIS_IMAGE to an immutable revision tag}"
service="${VIDEO_ANALYSIS_SERVICE_NAME:-twitchraid-video-analysis}"
batch_size="${VIDEO_VISION_BATCH_SIZE:-5}"
if [[ ! "$image" =~ ^localhost:5050/twitchraid-video-analysis:([a-f0-9]{7,40})$ ]]; then
  printf 'VIDEO_ANALYSIS_IMAGE must be a revision tag from the local registry.\n' >&2
  exit 1
fi
if [[ ! "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  printf 'Invalid service name.\n' >&2
  exit 1
fi
if [[ ! "$batch_size" =~ ^[0-9]+$ ]] || (( batch_size < 1 || batch_size > 30 )); then
  printf 'VIDEO_VISION_BATCH_SIZE must be between 1 and 30.\n' >&2
  exit 1
fi

docker image inspect "$image" >/dev/null
docker network inspect dokploy-network >/dev/null
if docker service inspect "$service" >/dev/null 2>&1; then
  purpose=$(docker service inspect --format '{{index .Spec.Labels "twitchraid.purpose"}}' "$service")
  if [[ "$purpose" != chat-video-analysis ]]; then
    printf 'Existing service has a different owner; no changes made.\n' >&2
    exit 1
  fi
  docker service update --detach=false \
    --image "$image" \
    --env-add "VIDEO_VISION_BATCH_SIZE=$batch_size" \
    --update-order stop-first --rollback-order stop-first \
    --update-failure-action rollback "$service"
else
  docker service create --detach=false \
    --name "$service" --label twitchraid.purpose=chat-video-analysis \
    --replicas 1 --constraint node.role==manager \
    --network name=dokploy-network,alias=video-analysis \
    --user 10001:10001 --read-only \
    --mount type=tmpfs,destination=/tmp,tmpfs-size=268435456,tmpfs-mode=1777 \
    --limit-memory 1G --limit-cpu 2 \
    --restart-condition any --restart-delay 5s \
    --update-order stop-first --rollback-order stop-first \
    --update-failure-action rollback \
    --env VIDEO_SERVICE_PORT=8090 \
    --env VIDEO_ALLOWED_CHANNEL=rukalun \
    --env VIDEO_OLLAMA_ENDPOINT=http://sub-ai_ollama:11434/api/generate \
    --env VIDEO_OLLAMA_MODEL=gemma4:e4b-it-qat \
    --env VIDEO_OLLAMA_CONTEXT_LENGTH=4096 \
    --env "VIDEO_VISION_BATCH_SIZE=$batch_size" \
    --env VIDEO_TOTAL_TIMEOUT_SECONDS=165 \
    --env VIDEO_WHISPER_ENDPOINT=http://sub-ai_whisper-api:5001/transcribe \
    --env VIDEO_TEMP_ROOT=/tmp/video-analysis \
    --env PYTHONDONTWRITEBYTECODE=1 --env PYTHONUNBUFFERED=1 --env TZ=Asia/Tokyo \
    "$image"
fi
printf 'Video-analysis service deployed without published ports.\n'
