# サブPC Dokploy/Docker 確認メモ

## 取得条件
- 取得日: 2026-06-20
- 接続経路: `ssh sub` から `wsl.exe -d Ubuntu-Backup`
- 目的: サブPC本番と同等のDocker条件でビルド・テストするときの基準情報を残す
- 注意: Twitch/Discord/GitHub token、webhook、client secretなどの秘密値は記録しない
- 追記: 2026-06-20 20:26 JST時点で、twitchRaidのDokployアプリは `localhost:5050/twitch-raid-apcz9n:local` をpullする設定へ修正済み

## Dockerホスト
- WSL distro: `Ubuntu-Backup`
- OS: `Ubuntu 24.04.2 LTS`
- Kernel: `6.6.87.2-microsoft-standard-WSL2`
- Architecture: `linux/amd64`
- Docker Engine: `29.6.0`
- Docker API: `1.55`
- Docker Compose plugin: `v5.1.4`
- Buildx plugin: `v0.34.1`
- containerd: `v2.2.5`
- Storage driver: `overlayfs`
- Cgroup: `systemd`, cgroup v2
- Default runtime: `nvidia`
- Swarm: active, single manager node `sub`
- Docker root: `/var/lib/docker`
- Resource snapshot: 14 CPUs, 18.55 GiB memory

## 稼働サービス
- `dokploy`: `dokploy/dokploy:v0.29.8`, `0.0.0.0:3000->3000/tcp`
- `dokploy-postgres`: `postgres:16`
- `dokploy-redis`: `redis:7`
- `dokploy-traefik`: `traefik:v3.6.7`, `80/tcp`, `443/tcp`, `443/udp`
- `sub-local-registry`: `registry:2`, `127.0.0.1:5000->5000/tcp`。ただし確認時点の `127.0.0.1:5000/v2/` はregistry応答ではなくUvicorn 404になるため、twitchRaidのDokploy pullには使わない
- `sub-ai-local-registry`: `registry:2`, `127.0.0.1:5050->5000/tcp`。twitchRaidのDokploy pullで使うローカルregistry
- `twitch-raid-apcz9n`: `localhost:5050/twitch-raid-apcz9n:local`
- `yomiage-bot-ex-nwywip`: `localhost:5000/yomiage-bot-ex-nwywip:local`
- `sub-ai_ollama`: `ollama/ollama:latest`, `*:11434->11434/tcp`
- `sub-ai_whisper-api`: `localhost:5050/sub-whisper-api:local`, `*:8888->5001/tcp`
- `sub-ai_sbvits2`: `localhost:5050/sub-sbvits2:local`, `*:5000->5000/tcp`
- `sub-ai_searxng`: `searxng/searxng:latest`, 公開portなし。`dokploy-network` の内部DNS alias `searxng` でtwitchRaid Botから接続する
- `sub-ai_qdrant`: `qdrant/qdrant:v1.15.4`, 公開portなし。`/home/mlove/dokploy/mem0/qdrant` を `/qdrant/storage` にbind mountし、`QDRANT__TELEMETRY_DISABLED=true`
- `sub-ai_mem0`: `localhost:5050/twitchraid-mem0-oss:local`, 公開portなし。`/home/mlove/dokploy/mem0/history` を `/app/history` にbind mountし、内部DNS alias `mem0` でBotから `http://mem0:8888` へ接続する

## SUB AI Services GPU確認

2026-06-20 22:01 JST時点で、Ollama Docker化後のGPU可視性を確認した。

- Dockerホストは `default-runtime=nvidia`。`/etc/docker/daemon.json` も `nvidia-container-runtime` を既定にしており、NVIDIA Container Toolkit 1.19.1 が入っている。
- GPUは `NVIDIA GeForce RTX 2070 SUPER`、Driver `591.86`、8GB VRAM。確認時点の使用量は約 `7630MiB / 8192MiB`。
- `sub-ai_ollama` / `sub-ai_whisper-api` / `sub-ai_sbvits2` は、Swarm serviceの `Resources={}` でGPU予約は無い。ただし実コンテナは `Runtime=nvidia`、`NVIDIA_VISIBLE_DEVICES=all`、`NVIDIA_DRIVER_CAPABILITIES=compute,utility` で起動しており、各コンテナ内の `nvidia-smi` はRTX 2070 SUPERを表示した。
- `sub-ai_ollama`: `ollama ps` で `qwen3.5:9b` が `20%/80% CPU/GPU`、`size_vram=4978324273`。Docker化後もGPU runnerを使っているが、8GB VRAMでは一部CPU offloadになる。ロード済み状態の短文生成は約1.5秒、`load_duration` は約0.89秒だった。
- `sub-ai_whisper-api`: `WHISPER_DEVICE=cuda`、`WHISPER_COMPUTE_TYPE=int8`。`torch` は入っていないが、実装が使うCTranslate2で `cuda_device_count=1`、CUDA compute typeは `int8_float16` / `int8_float32` / `float32` / `int8` / `float16` を返した。
- `sub-ai_sbvits2`: PyTorchで `torch.cuda.is_available=True`、`torch.cuda.device_count=1`、`torch.cuda.device_name=NVIDIA GeForce RTX 2070 SUPER`。ログでも `Model loaded successfully ... to "cuda" device` を確認した。

結論として、Ollama Docker化でGPUが見えなくなったわけではない。SUB AI Servicesが同じ8GB GPUを共有し、Whisper/SBVITS2/OllamaがGPUを使える状態でVRAMがほぼ埋まっているため、`qwen3.5:9b` のcold load時に一部CPU offloadとロード待ちが発生し、Bot側の `CHAT_AI_TIMEOUT_MS=45000` に到達しやすい。

### 2026-07-17 Gemma 4本番切替

- AI会話・Raid・共通Ollamaモデルを `gemma4:e4b-it-qat` へ統一し、mem0の `MEM0_LLM_MODEL` も同じ値へ揃えた。埋め込みは `nomic-embed-text:latest` のまま。
- `ollama ps` はGemma約3.0GB・100% GPU・context 4096、nomic約323MB・100% GPUの2件だけを表示し、Qwenは非常駐。`nvidia-smi` は8192MiB中6192MiB使用・1798MiB空きだった。
- Bot再起動時のGemma prewarmは13.9秒、続くnomic prewarmは2.1秒、mem0検索prewarmは181msで完了した。
- `npm run perf:sub-ai-services` の切替後20回評価4セットは生成p95 751.51〜770.54ms。6サービス1/1、task不変、restart/error 0で、評価前にBotの3モデル設定とmem0のLLM/embed/infer設定が本番契約どおりかもfail-closedで検証する。
- Qwenモデルは緊急rollback用に削除せず保持する。Gemmaのread-only canaryでは画面のない配信内容とRaid感想を補う既知の捏造傾向が再現しているため、モデル稼働とは別にprompt/回帰テストで抑止する。

### GPU利用プロセス対応

2026-06-20 22:17 JST時点の `nvidia-smi` では、GPU使用量は約 `7576MiB / 8192MiB`、プロセス一覧には `/python3.10` が2本、`/llama-server`、`/Xwayland` が見えた。WSL2 + NVIDIA環境ではプロセス別GPU Memoryが `N/A` になり、PIDもコンテナ内PID寄りに表示されるため、Dockerの `docker top` とコンテナ内 `ps` で対応付けた。

| GPU表示 | Docker service | 実体 | 備考 |
| --- | --- | --- | --- |
| `/llama-server` PID 1707 | `sub-ai_ollama` | `llama-server ... qwen3.5:9b ...` | `ollama ps` では `qwen3.5:9b` が `20%/80% CPU/GPU`、`size_vram=4978324273` |
| `/python3.10` PID 1 | `sub-ai_whisper-api` | `python3 /app/server.py` | CTranslate2が `cuda_device_count=1` を返す |
| `/python3.10` PID 1 | `sub-ai_sbvits2` | `python3 server_fastapi.py` | PyTorchが `torch.cuda.is_available=True` を返し、ログでもcudaへモデルロード済み |
| `/Xwayland` PID 35 | Docker外 | WSLg/表示系 | SUB AI Servicesではない |

OllamaのVRAMは `ollama ps` / `/api/ps` の `size_vram` から約4.98GBと分かる。一方、WSL2の `nvidia-smi --query-compute-apps=used_memory` は `N/A` のため、Whisper/SBVITS2/Xwayland/ランタイムの厳密なMiB内訳は非停止では取れない。正確な差分を出す場合は、配信影響を確認したうえでSUB AI Servicesを一つずつ停止し、停止前後の総VRAM差分を見る。

### SUB AI Services内SearXNG

2026-06-21 01:18 JST時点で、SearXNGは独立stackではなくSUB AI Services内へ移した。Dokploy Compose `sub-ai-services` の `sub-ai` stackに `searxng` serviceを追加し、旧standalone `twitchraid-searxng` は `idle` に停止済み。Swarm上は `sub-ai_ollama` / `sub-ai_whisper-api` / `sub-ai_sbvits2` / `sub-ai_searxng` の4サービス構成。

SearXNGは `/home/mlove/dokploy/searxng/settings.yml` を `/etc/searxng/settings.yml:ro` にbind mountし、JSON出力とGoogle engineだけを有効化する。公開portは持たせず、Botは `CHAT_AI_SEARCH_ENDPOINT=http://searxng:8080/search?language=all&safesearch=0` で接続する。Botコンテナ内DNSでは `searxng` と `sub-ai_searxng` が同じIPへ解決される。実行中Botの `fetchMentionChatSearchContext("OpenAIについて調べて")` はSearXNG/Google経由で検索結果3件を返すことを確認済み。

### SUB AI Services内Mem0 OSS/Qdrant

2026-06-21 17:21 JST時点で、Mem0 OSSは独立stackではなくSUB AI Services内へ追加した。Swarm上は `sub-ai_ollama` / `sub-ai_whisper-api` / `sub-ai_sbvits2` / `sub-ai_searxng` / `sub-ai_qdrant` / `sub-ai_mem0` の6サービス構成。

Mem0 server imageは `ops/mem0-oss-server/` を元に `localhost:5050/twitchraid-mem0-oss:local` としてビルド・pushする。実体は `mem0ai==2.0.7` のOSSライブラリをFastAPIで包む内部REST wrapperで、`/healthz`、`/memories`、`/search` だけを使う。`mem0` は `MEM0_OLLAMA_BASE_URL=http://sub-ai_ollama:11434`、`MEM0_EMBEDDER_MODEL=nomic-embed-text:latest`、`MEM0_QDRANT_HOST=qdrant` で動き、OpenAI等の有料providerは使わない。`nomic-embed-text:latest` はサブPCOllamaへpull済み。Botからの保存は既にBot側で抽出した `key: value` を `infer:false` で送るため、mem0側の追加LLM抽出は走らない。

Qdrantは `/home/mlove/dokploy/mem0/qdrant` を永続化し、公開portは持たせない。Qdrantの利用統計は `QDRANT__TELEMETRY_DISABLED=true` で無効化し、ログで `Telemetry reporting disabled` を確認済み。mem0 RESTのAPIキーは `/home/mlove/dokploy/mem0/admin_api_key` に保存し、Dokploy composeとBot環境変数へ入れるが、READMEやログには値を残さない。検証時に一度出力してしまった初期キーはローテーション済み。

動作確認はBot本番コンテナから内部DNS `http://mem0:8888` へ実施し、`/healthz` がHTTP 200、APIキー付き `/memories` 保存がHTTP 200、`/search` が保存した検証メモを返すことを確認した。検証用user_idは `probe` / `probe-rotated` で、本番 `CHAT_AI_MEM0_USER_ID=rukalun` の検索対象には混ざらない。

2026-06-21 17:35 JSTにBot本番もMem0有効化済み。commit `1a496cdfd4dbe5b1979d742fa4bff8e093d4175d` のimageを `localhost:5050/twitch-raid-apcz9n:local` / `:1a496cd` へpushし、Dokploy application envを `/tmp/twitchraid-application-before-mem0-bot-20260621173445.sql` へバックアップ後、`CHAT_AI_MEM0_ENABLED=true`、`CHAT_AI_MEM0_ENDPOINT=http://mem0:8888`、`CHAT_AI_MEM0_USER_ID=rukalun`、`CHAT_AI_MEM0_TIMEOUT_MS=2000` などを永続化した。APIキー値は記録しない。実行中Bot container `9403e3f93884` から `dist/commands/mention-chat-mem0.js` を直接呼び、probe userで `saveReason=saved`、`loadReason=found`、`itemCount=1`、`hasText=true` を確認した。

2026-07-02 JSTに本番Botの記憶保存設定を再確認し、`CHAT_AI_MEMORY_WRITER_USERS=all` で全ユーザー保存許可、`CHAT_AI_AUTO_LEARN_ENABLED=true` / `CHAT_AI_IMPLICIT_MEMORY_ENABLED=true` / `CHAT_AI_MEM0_ENABLED=true` を確認した。非 `rukalun` probeはSQLite正本へ保存できたが、`CHAT_AI_MEM0_TIMEOUT_MS=2000` ではmem0保存がBot側timeoutで `reason=failed` になり、mem0側では後続で挿入される境界状態だった。Dokploy application行を `/tmp/twitchraid-application-before-mem0-timeout-20260702-0228.csv` へバックアップし、Dokploy `application.env` とSwarm serviceの両方を `CHAT_AI_MEM0_TIMEOUT_MS=6000` へ更新した。新コンテナ `7fe42bacebd8` は同envで起動し、非 `rukalun` probeでSQLite保存とmem0保存がどちらも成功。検証用キーはSQLite/mem0双方から削除済み。

## Botサービス
- Service: `twitch-raid-apcz9n`
- Image: `localhost:5050/twitch-raid-apcz9n:366db8f`
- Deployment digest: `sha256:c7fe800c7a3630f2a46b301b626fb016dc15e96b1d73675d503e53069b6c1b58`
- Revision label: `366db8fcec7a410bc0a36e78738d0fb21637f737`
- Entrypoint: `docker-entrypoint.sh`
- Command: `node dist/index.js`
- Working dir: `/app`
- Container OS: `Debian GNU/Linux 12 (bookworm)`
- Node.js: `v24.17.0`
- npm: `11.13.0`
- git: `2.39.5`
- 実行ユーザー: `root`
- 公開port: なし
- Network: `dokploy-network`
- `dokploy-network`: overlay, attachable, subnet `10.0.1.0/24`
- Restart policy: Swarm service側は `Condition=any`, `Delay=5s`
- Update policy: `stop-first`, `FailureAction=rollback`
- Rollback policy: `stop-first`
- 配信まとめスレッド保証はprocess内single-flightを使うため、replicaは1のままにし、更新・rollbackとも旧新processが重ならない `stop-first` をDokploy DBとSwarm serviceの両方へ永続設定する。`start-first` へ戻すと同名配信の新規開始通知・thread作成がdeploy境界で二重化し得る
- Placement: `node.role==manager`

## 2026-07-11 配信まとめthread重複防止のrollout境界

- `streamId=316151050737` の未投稿state復旧時、Discord側には同じ配信タイトルの既存threadが残っていた。Botはactive/public archived threadと親message履歴を完全走査し、同名threadまたは自Bot・設定Webhookのorphan開始通知を再利用する
- 履歴を完全取得できたno-match時だけ新規開始通知とthreadを作る。429、権限、通信、15秒timeout、pagination不完了ではfail-closedでbackoffし、Discordへ新規書き込みしない
- Bot API POSTの成否が不明なnetwork/5xx/不正応答ではWebhookへ即fallbackせず、次回履歴走査でorphanを回収する。確定403だけWebhookへfallbackする
- `updateConfigSwarm` / `rollbackConfigSwarm` と実serviceのOrderをともに `stop-first` に保つ。変更前は対象application IDと該当2カラムだけをmode 600の一時ファイルへ退避し、秘密値を含むapplication全行やservice spec全体を画面へ出さない

反映結果:

- Dokploy DB変更前バックアップ: `/tmp/twitchraid-update-order-before-20260711T045454Z.csv`、mode 600。退避項目はapplication ID、replicas、update/rollback configだけ
- Dokploy DB: `replicas=1`、update/rollbackとも `Order=stop-first`
- Swarm service: image `localhost:5050/twitch-raid-apcz9n:366db8f`、`1/1`、update completed、update/rollbackとも `stop-first`
- 旧container終了 `2026-07-11T04:57:32.199546847Z`、新container開始 `2026-07-11T04:57:32.829277020Z`。約630msの停止間隔があり旧新process overlapなし
- image revision label `366db8fcec7a410bc0a36e78738d0fb21637f737`、digest `sha256:c7fe800c7a3630f2a46b301b626fb016dc15e96b1d73675d503e53069b6c1b58`
- 起動後、既存thread/start message `1525135703984443514` を復旧し、終了まとめmessage `1525365421887324160` を同threadへ投稿。stateは `posted`、新しい同タイトル開始通知0、新規thread0
- 新container restart 0、起動後WARN/ERROR/FATAL 0、配信まとめ保証/未作成/backoff警告0。Bot/Ollama/mem0/Qdrant/SearXNGは全て `1/1`
- 初回buildはWindows credential helper参照エラーでbase image取得前に停止。空の一時 `DOCKER_CONFIG` でclean build/pushを完了し、`/tmp/twitchraid-build-366db8f-*` と `/tmp/docker-nocreds-366db8f-*` は絶対path検証後に削除、残存0

## 2026-06-20 Dokploy registry修正

Dokploy UIのDeploymentでは、対象アプリ `tZTEPPXj2qfOwAAPpdCmD` が `localhost:5000/twitch-raid-apcz9n:local` をpullしようとして `not found` で失敗していた。サブPC上で確認すると、`127.0.0.1:5000/v2/` はDocker registryではなくUvicorn 404を返し、実際にpullできるローカルregistryは `127.0.0.1:5050` だった。

対応内容:

- Dokploy Postgresの対象application行を `/tmp/twitchraid-dokploy-application-before-20260620T112344Z.json` にバックアップ
- 最新imageを `localhost:5050/twitch-raid-apcz9n:local` と `localhost:5050/twitch-raid-apcz9n:4da65c0` にpush
- Dokploy DBの対象application `dockerImage` を `localhost:5050/twitch-raid-apcz9n:local` に更新
- Dokployコンテナ内の `@dokploy/server` から `deployApplication` を呼び出して再デプロイ
- 誤更新時はバックアップJSONの対象行を確認し、復元対象のapplication IDと変更対象カラムを限定してから戻す。秘密値を含み得るため、バックアップJSONの中身はチャットや公開repoへ貼らない

成功確認:

- Dokploy deployment `BJsyVlP-dSEQqALOGNwGK`: `Manual deploy after registry port fix`、status `done`
- Deployment log: `Pulling localhost:5050/twitch-raid-apcz9n:local`、`✅ Pulling image completed.`
- Swarm service `twitch-raid-apcz9n`: image `localhost:5050/twitch-raid-apcz9n:local`、update completed
- 実行中container: image `localhost:5050/twitch-raid-apcz9n:local`、revision `4da65c09ef3eabdcd298d3591b6fa3d97cc3a2f6`
- Botログ: `=== TwitchRaid Bot Starting (TypeScript) ===`、`内部Git自動更新は無効です。Dokployのデプロイ管理を使用します。`、`全てのチャンネルにログインしました`

今後Dokploy UIから再デプロイするときも、twitchRaidアプリのimageは `localhost:5050/twitch-raid-apcz9n:local` のままにする。`localhost:5000/twitch-raid-apcz9n:local` へ戻すと同じpull失敗になる。

## Botサービスのbind mount
- `/mnt/e/GitHub/twitchRaid/data` -> `/app/data`
- `/mnt/e/GitHub/RukalunPage` -> `/mnt/e/GitHub/RukalunPage`

`/app/data` には確認時点で次の永続ファイルがある。

- `clip_history.json`
- `clips.sqlite`
- `first_comments.sqlite`
- `stream-summary-state.json`
- `stream-summary-state.json.bak-stale-thread-20260606052029`
- `stream-summary-state.json.bak-unarchive-20260608`

## Dokploy用Dockerfile

2026-06-20 21:12 JST以降は、リポジトリ直下の `Dockerfile` をDokploy/サブPC向け本番imageの正本にする。以前のDokploy生成相当では `CMD ["npm", "run", "start"]` だったため、Swarm更新時に停止される旧コンテナが正常なSIGTERMを `npm error signal SIGTERM` として出していた。追跡Dockerfileでは最終起動を `node dist/index.js` へ変更し、npmを介さない。

```dockerfile
FROM node:24-bookworm-slim

WORKDIR /app

ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

RUN git config --system --add safe.directory /mnt/e/GitHub/RukalunPage

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
```

`.dockerignore` では `.env`、`node_modules`、`dist`、`logs`、`data` などをbuild contextから除外し、ローカル実行物や秘密値をimageへ混ぜない。

## 非秘密の主要環境変数

秘密値、webhook、token、client secret、Twitch ID類は省略する。確認時点で `CLIP_SEARCH_PUBLISH_GITHUB_TOKEN` はサービス環境変数一覧に見えなかった。

```text
GIT_AUTO_UPDATE_ENABLED=false
CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true
CLIP_SEARCH_DATA_PATH=/mnt/e/GitHub/RukalunPage/clip-search-data.json
CLIP_SEARCH_PUBLISH_REPO_DIR=/mnt/e/GitHub/RukalunPage
CLIP_SEARCH_PUBLISH_REMOTE=origin
CLIP_SEARCH_PUBLISH_BRANCH=main
CLIP_SEARCH_PUBLISH_MIN_INTERVAL_MS=300000
OLLAMA_BASE_URL=http://192.168.0.99:11434
OLLAMA_MODEL=gemma4:e4b-it-qat
OLLAMA_SHOUTOUT_ENABLED=true
OLLAMA_SHOUTOUT_MODEL=gemma4:e4b-it-qat
OLLAMA_SHOUTOUT_TIMEOUT_MS=30000
OLLAMA_SHOUTOUT_KEEP_ALIVE=30m
CHAT_AI_MODEL=gemma4:e4b-it-qat
CHAT_AI_KEEP_ALIVE=30m
CHAT_AI_CONTEXT_LENGTH=4096
CHAT_AI_TIMEOUT_MS=45000
CHAT_AI_STREAM_IMAGE_ENABLED=false
CHAT_AI_VISION_MODEL=gemma3:4b
CHAT_AI_MEMORY_ENABLED=true
CHAT_AI_MEMORY_STORE=sqlite
CHAT_AI_MEMORY_PATH=data/chat-ai-memory.json
CHAT_AI_MEMORY_DB_PATH=data/chat-ai-memory.sqlite
CHAT_AI_MEMORY_MAX_ITEMS=8
CHAT_AI_MEMORY_MAX_CHARS=600
CHAT_AI_SEARCH_ENABLED=true
CHAT_AI_SEARCH_PROVIDER=searxng
CHAT_AI_SEARCH_ENDPOINT=http://searxng:8080/search?language=all&safesearch=0
CHAT_AI_SEARCH_ENGINES=google
CHAT_AI_SEARCH_TIMEOUT_MS=4000
CHAT_AI_SEARCH_MAX_RESULTS=3
CHAT_AI_PROMPT_REPLY_LOG_ENABLED=true
CHAT_REPLY_EMOTES=rukkaNikoniko
SHOUTOUT_ADMIN_USERS=rukalun,nyme_ia
MANGA_ADMIN_USERS=rukalun,nyme_ia
DISCORD_SUMMARY_CHANNEL_ID=438258034825887744
```

`CHAT_AI_VISION_MODEL` は過去の画像質問設定として残る場合があるが、現行BotはAIメンション会話で配信画像を取得せず、Ollama payloadへ `images` を送らない。

SUB AI Services側は `MEM0_LLM_MODEL=gemma4:e4b-it-qat`、`MEM0_EMBEDDER_MODEL=nomic-embed-text:latest`、`MEM0_INFER_DEFAULT=false`。通常のBot保存は明示的に `infer:false` を送る。

## 同等条件でのテスト方針

本番ランタイムイメージは `npm prune --omit=dev` 済みなので、そのままではVitestなどのdev dependencyを使うテストには向かない。同等OS/Node条件でテストする場合は、`node:24-bookworm-slim` に `ca-certificates` と `git` を入れ、`npm ci` 後、prune前にテストを実行する。

```bash
docker run --rm \
  -v "$PWD:/app" \
  -w /app \
  node:24-bookworm-slim \
  sh -lc "apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory /mnt/e/GitHub/RukalunPage \
    && npm ci \
    && npm test \
    && npm run build"
```

ランタイム起動まで再現する場合は上記Dockerfile相当でイメージを作り、`/app/data` と `/mnt/e/GitHub/RukalunPage` をbind mountし、Dokployと同じ環境変数を渡す。ただし本番secretをローカルテストへ流用しない。サブPCDokployへ手動でimageを供給する場合は `localhost:5050/twitch-raid-apcz9n:local` へpushする。
