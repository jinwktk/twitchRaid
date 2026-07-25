# AnythingLLM隔離PoC運用手順

## 目的

本番BotをAnythingLLMへ接続する前に、サブPCの内部Docker networkだけで次の契約を確認する。

- AnythingLLMから既存Ollama、nomic embedding、Qdrant、SearXNGへ接続できる
- workspace、document upload/embed、RAG chat、unembed、document/workspace削除がDeveloper APIで完結する
- API key、認証token、保存コメントをGitや通常ログへ出さない
- PoCの停止・削除が既存Botや固定コマンドへ影響しない

## 固定構成

- image: `mintplexlabs/anythingllm:1.15.0`
- multi-arch digest: `sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f`
- サブPCamd64 manifest: `sha256:3befe7d47e05a8f965490c724b10453bfd9948a07650639e2a26953a93c4b708`
- network: `dokploy-network`
- PoC service / internal DNS: `anythingllm`
- 永続storage: `/home/mlove/dokploy/anythingllm/storage`
- 認証設定: `/home/mlove/dokploy/anythingllm/.env`
- Developer API key: `/home/mlove/dokploy/anythingllm/api/api-key`

外部portはpublishしない。AnythingLLMの管理画面やAPIを外部公開する場合は、PoCとは別に認証付きreverse proxyとアクセス制限を設計する。

## 初期化

リポジトリの次のscriptをサブPCのWSL内で実行する。

```bash
bash scripts/bootstrap-anythingllm-poc-remote.sh
```

このscriptは認証値を標準出力へ出さず、`.env`をmode `0600`、storageをUID/GID `1000:1000`で準備する。有効な4項目が既にある場合はローテーションしない。

続けて、Composeの`anythingllm` serviceと同じ固定image、内部DNS、mount、非公開port、Ollama/Qdrant/SearXNG設定を持つ隔離Swarm serviceを作る。既に同名serviceがある場合は変更せず、image不一致ならfail-closedにする。

```bash
bash scripts/deploy-anythingllm-poc-remote.sh
```

PoC serviceがhealthyになった後、内部networkからDeveloper API keyを作る。API keyは値を標準出力へ出さず、mode `0600`のファイルへ保存する。

```bash
docker run --rm --pull never \
  --network dokploy-network \
  --env-file /home/mlove/dokploy/anythingllm/.env \
  --env ANYTHING_LLM_BASE_URL=http://anythingllm:3001 \
  --env ANYTHING_LLM_API_KEY_NAME=twitchraid-poc-contract \
  --env ANYTHING_LLM_API_KEY_OUTPUT=/run/output/api-key \
  --mount type=bind,source=/home/mlove/dokploy/anythingllm/api,target=/run/output \
  --mount type=bind,source="$PWD/scripts/bootstrap-anythingllm-api-key.mjs",target=/bootstrap.mjs,readonly \
  --entrypoint node \
  mintplexlabs/anythingllm:1.15.0@sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f \
  /bootstrap.mjs
```

## 契約probe

Developer API keyはcommand lineへ展開せず、`ANYTHING_LLM_API_KEY_FILE`で渡す。

```bash
docker run --rm --pull never \
  --network dokploy-network \
  --env ANYTHING_LLM_BASE_URL=http://anythingllm:3001 \
  --env ANYTHING_LLM_API_KEY_FILE=/run/secrets/anythingllm-api-key \
  --mount type=bind,source=/home/mlove/dokploy/anythingllm/api/api-key,target=/run/secrets/anythingllm-api-key,readonly \
  --mount type=bind,source="$PWD/scripts/verify-anythingllm-contract.mjs",target=/probe.mjs,readonly \
  --entrypoint node \
  mintplexlabs/anythingllm:1.15.0@sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f \
  /probe.mjs
```

成功時は全checkが`true`になる。probeは合成データだけを使い、Twitch送信を行わない。`finally`でunembed、document削除、workspace削除を実行する。workspace作成またはuploadのレスポンスが壊れていても、一意なworkspace名・document titleから再発見してcleanupする。

probe前後でQdrantのcollectionを比較し、一時workspace用collectionが残っていないことを確認する。

## Backup / restore

SQLiteとdocument metadataの整合性を保つため、backupはAnythingLLM serviceを停止して取得する。

```bash
docker service scale anythingllm=0
install -d -m 700 /home/mlove/dokploy/anythingllm/backups
tar -C /home/mlove/dokploy/anythingllm \
  -czf /home/mlove/dokploy/anythingllm/backups/anythingllm-storage-YYYYMMDD-HHMMSS.tar.gz \
  storage
sha256sum /home/mlove/dokploy/anythingllm/backups/anythingllm-storage-YYYYMMDD-HHMMSS.tar.gz
docker service scale anythingllm=1
```

restoreは新しい空directoryへ展開してファイル数・総byte・SQLite integrityを確認してから、停止中のservice mountを切り替える。既存storageへ直接上書きしない。

## Rollback

PoC段階ではBotがAnythingLLMを参照していないため、次でserviceだけを止められる。

```bash
docker service rm anythingllm
```

この操作では`/home/mlove/dokploy/anythingllm`を削除しない。再作成すれば同じstorageを使える。本番切替後は先にBotのAnythingLLM feature flagを戻し、固定コマンドが正常なことを確認してからAnythingLLMを停止する。

## 2026-07-25 実機記録

- サブPC: amd64、WSL ext4空き約838GB
- image pull: 成功
- service: `anythingllm` 1/1、container health `healthy`
- published port: なし
- `GET /api/ping`: HTTP 200、`{"online":true}`
- startup: Prisma migration完了、Swagger無効、telemetry無効
- SearXNG: AnythingLLM container内から実検索HTTP 200
- probe前Qdrant collection: `twitchraid_memories`のみ
- API key: 内部認証から生成、mode `0600`、値は未出力
- Developer API契約: 合成markerを使うworkspace作成、文書upload/embed、query chat、unembed、文書削除、workspace削除が2回とも全項目成功
- API契約latency: 初回14.66秒、同一モデル常駐後4.92秒。service/DNS名統一と所有名・health検証追加後も4.87秒で全項目成功
- probe後Qdrant collection: `twitchraid_memories`のみ。一時workspace用collectionは残存なし
- idle resource: CPU 0.00%、RAM 220.1MiB、storage 412KiB（6ファイル、実ファイル合計368,328 bytes）
- image size: 1,101,543,583 bytes
- Ollama常駐: `gemma4:e4b-it-qat` 3.0GB / context 4096 / GPU 100%、`nomic-embed-text:latest` 323MB / context 2048 / GPU 100%
- backup: `/home/mlove/dokploy/anythingllm/backups/anythingllm-storage-20260725-poc.tar.gz`、mode `0600`、22,666 bytes、SHA-256 `ce4b6e6f0452c16377549841ecde3b56582b7ca7316129b919266028cf47ab08`
- restore: 新規隔離directoryへ展開し、全6ファイルの相対pathとSHA-256、実ファイル合計368,328 bytesが正本と一致。復元SQLiteの`PRAGMA integrity_check`は`ok`
- rollback: PoCを0 replicaへ縮退中も既存Botは同一container、service 1/1、restart 0を維持。固定コマンド回帰16件成功。PoCを1 replicaへ戻した後もhealth `healthy`
- 復元検証用の一時directoryだけ削除済み。正本storageと上記backup archiveは保持
