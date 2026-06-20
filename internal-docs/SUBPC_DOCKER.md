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
- `sub-ai-test_ollama`: `ollama/ollama:latest`, `*:11435->11434/tcp`
- `sub-ai-test_whisper-api`: `localhost:5000/sub-whisper-api:local`, `*:5002->5001/tcp`
- `sub-ai-test_sbvits2`: `localhost:5000/sub-sbvits2:local`, 確認時点では `0/1`

## Botサービス
- Service: `twitch-raid-apcz9n`
- Image: `localhost:5050/twitch-raid-apcz9n:local`
- Deployment digest: `sha256:415223bb9185b66d331c40746b4b747d667995b09dc0dbfd5f34d47b0dcb7e54`
- Revision label: `4da65c09ef3eabdcd298d3591b6fa3d97cc3a2f6`
- Entrypoint: `docker-entrypoint.sh`
- Command: `npm run start`
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
- Update policy: `start-first`, `FailureAction=rollback`
- Placement: `node.role==manager`

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
OLLAMA_SHOUTOUT_ENABLED=true
OLLAMA_SHOUTOUT_TIMEOUT_MS=30000
OLLAMA_SHOUTOUT_KEEP_ALIVE=30m
CHAT_AI_KEEP_ALIVE=30m
CHAT_AI_TIMEOUT_MS=45000
CHAT_AI_STREAM_IMAGE_ENABLED=true
CHAT_AI_VISION_MODEL=gemma3:4b
CHAT_AI_MEMORY_ENABLED=true
CHAT_AI_MEMORY_PATH=data/chat-ai-memory.json
CHAT_AI_MEMORY_MAX_ITEMS=8
CHAT_AI_MEMORY_MAX_CHARS=600
CHAT_AI_SEARCH_ENABLED=true
CHAT_AI_SEARCH_ENDPOINT=https://api.duckduckgo.com/
CHAT_AI_SEARCH_TIMEOUT_MS=4000
CHAT_AI_SEARCH_MAX_RESULTS=3
CHAT_AI_PROMPT_REPLY_LOG_ENABLED=true
CHAT_REPLY_EMOTES=rukkaNikoniko
SHOUTOUT_ADMIN_USERS=rukalun,nyme_ia
MANGA_ADMIN_USERS=rukalun,nyme_ia
DISCORD_SUMMARY_CHANNEL_ID=438258034825887744
```

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
