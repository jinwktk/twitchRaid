# AnythingLLMによるAI会話記憶改善の導入調査

調査日: 2026-07-25

## 結論

AnythingLLMを現在の`mention_chat_memory`とself-host Mem0の代替として入れることは推奨しない。

動画で紹介されているAnythingLLMの主用途は、OllamaへWeb検索と文書RAGを追加することである。これは「ユーザーの安定したプロフィールを安全に抽出・昇格・削除する記憶」とは別問題であり、現在のSQLite正本＋Mem0補助検索をAnythingLLMへ置き換えると、既に実装済みの安全境界、状態管理、Twitchユーザー主体分離、tombstone、fail-openを作り直す必要がある。

導入価値があるのは、将来「Botの運用マニュアル、FAQ、配信企画資料などの管理文書を検索して回答する」文書RAGを別機能として追加する場合である。その場合もAnythingLLMは記憶正本にせず、内部ネットワーク限定の補助検索サービスとして小さく試験導入する。

## 動画で扱っている内容

対象動画: [ローカルAI（ローカルLLM）を強化する！無課金AI生活２～知識拡張で最新情報や社内・個人情報をAIで回答可能にする～](https://www.youtube.com/watch?v=d2256mBkb8Y)

公開説明で確認できた構成は次の通り。

- Windows版AnythingLLM Desktopから、WSL2上のOllamaへ接続する。
- 埋め込みモデルとLanceDBを設定し、ワークスペースを作る。
- Web検索でモデル学習時点より新しい情報を取得する。
- PDF、Markdown、テキスト等を登録し、RAGで内容を回答へ使う。
- 文書はアップロードしただけではワークスペースの検索対象にならない場合がある。
- Chat ModeとQuery Modeでは、一般知識を併用するか、取得した文書だけに限定するかが異なる。

公式資料でも、AnythingLLMのChat Modeは「文書とモデルの一般知識」を使い、Query Modeは文書から得た情報に回答を限定する仕様である。[公式Chat Modes](https://docs.anythingllm.com/features/chat-modes)

公式RAG解説によれば、質問時に全文書をモデルへ送るのではなく、質問をベクトルDBへ照合し、関連すると判断した数個のテキスト断片を取得してモデルへ渡す。[公式RAG解説](https://docs.anythingllm.com/chatting-with-documents/rag-in-anythingllm)

したがって、動画の「知識拡張」は主に文書RAGとWeb検索であり、会話から長期ユーザー記憶を安全に育成する仕組みそのものではない。

## AnythingLLMのMemory機能

AnythingLLMには現在、文書RAGとは別に`Memories & Personalization`がある。

- ワークスペースmemoryは1ユーザー・1ワークスペースあたり最大20件、global memoryは最大5件。
- 応答時に全global memoryと関連度上位5件のworkspace memoryをsystem promptへ追加する。
- 自動抽出は直近会話をObserver/Reflectorの2段階で処理し、候補抽出、scope分類、重複排除、統合、低信頼候補除外を行う。
- 自動抽出は既定3時間間隔、workspaceが20分以上idle、未処理chatが5件以上の場合に走る。
- 自動抽出にはtool calling対応モデルが必要である。
- memoryはユーザーアカウントへ紐付き、multi-user modeではユーザー間を分離する。

出典: [AnythingLLM公式 Memories & Personalization](https://docs.anythingllm.com/features/memories)

この機能は一般用途としては便利だが、twitchRaidの現行要件には次の差がある。

| 観点 | twitchRaid現行 | AnythingLLM memory |
| --- | --- | --- |
| 正本 | SQLite `mention_chat_memory` | AnythingLLM内部DB |
| 状態 | active / candidate / inactive / tombstone | 保存memory中心。現行と同じ状態契約ではない |
| 抽出 | 決定的ルール。追加LLMなし | workspace chatをLLMのObserver/Reflectorで後処理 |
| 昇格 | 本人の安全なプロフィールは初回active、他者/Botは複数観測 | confidence、重複、scopeをLLMが判断 |
| 安全境界 | PII、秘密、一時情報、否定、伝聞、第三者、prompt注入をfail-closed | 一般的な選択的抽出。twitchRaid固有拒否契約は別実装が必要 |
| 取得 | 日本語alias、主体、topic、local authority、tombstoneを考慮 | global全件＋workspace関連上位5件 |
| 障害時 | SQLite継続、Mem0はfail-open | AnythingLLMを会話経路へ置くと新しい必須依存になり得る |
| 件数 | 設定可能、candidateをactiveより先に整理 | global 5、workspace 20、注入workspace上位5 |

## 現行SQLite＋Mem0との重複

現在の実装は既に次の二層構造である。

1. SQLiteが事実の正本
   - `mention_chat_memory`に状態、confidence、observed count、昇格時刻、最終観測時刻を保持する。
   - 削除済みキーはtombstoneとして保持し、補助ベクトル記憶から復活しないようにする。
   - Botへ注入するのは安全判定済みのactiveだけである。

2. self-host Mem0がsemantic retrieval補助
   - active化した`key: value`だけを`infer:false`でミラーする。
   - Qdrant＋Ollama `nomic-embed-text`を使う。
   - score threshold、欠損score拒否、主体分離、recall gateをBot側でも検証する。
   - timeoutや障害時はSQLiteと通常会話を継続する。
   - 同一キーはSQLiteを優先し、candidate/inactive/tombstoneもMem0からの復活を抑止する。

AnythingLLMを「記憶領域」として追加すると、SQLite、Mem0/Qdrant、AnythingLLM/LanceDB（または別vector DB）の三重保持になる。以下の同期問題が増える。

- どの保存先を正本にするか。
- 編集、削除、tombstoneをどう双方向同期するか。
- Twitch loginとAnythingLLM user/workspaceをどう対応させるか。
- 同じ事実の重複、古い値、主体違いをどこで拒否するか。
- AnythingLLM自動抽出結果を、既存の安全昇格規則より優先するか。

この重複に対して、現行Mem0より明確に改善する固有能力は確認できない。むしろAnythingLLM memoryは件数上限が小さく、抽出に追加のtool-calling LLM処理が必要である。

## API統合の可否

Docker版AnythingLLMはDeveloper APIを持つ。公式資料は、instanceの`/api/docs`で実際のendpoint仕様を確認でき、APIでworkspaceの管理、更新、埋め込み、chatができるとしている。API keyを持つ者はAPIを利用できるため、公開・共有してはいけない。[公式API Access](https://docs.anythingllm.com/features/api)

公開ソースと公式repository上の利用例から、少なくとも次の統合面がある。

- `POST /api/v1/workspace/:slug/chat`: workspaceのRAGを使ったchat。
- `POST /api/v1/workspace/:slug/stream-chat`: streaming chat。
- `POST /api/v1/workspace/:slug/vector-search`: workspaceのvector search。
- 文書upload、workspaceへの文書追加・更新。

ただし、twitchRaidでAnythingLLMのchat endpointを主生成経路にすると、現在Botが制御しているsystem prompt、履歴、検索、メモ結合、歌詞修復、英語修正、timeout、診断ログがAnythingLLM内部へ二重化する。これは変更範囲と回帰リスクが大きい。

採用するなら、AnythingLLMに最終回答を生成させるよりも、文書RAGの検索結果だけを補助contextとして返すadapterを作る方が境界を保ちやすい。ただしAPIはリリースにより変化し得るため、実導入時にはversion固定したinstanceの`/api/docs`を契約テストの正本にする。

## Docker / self-host運用

AnythingLLMは公式Docker imageを提供する。

- `mintplexlabs/anythingllm:latest`はmaster更新に追随し、ほぼ毎日更新される。
- Docker Hubのrelease imageは`mintplexlabs/anythingllm:*.*.*`（例: `1.15.0`、`v`なし）である。
- amd64とarm64に対応する。

本番では`latest`ではなくversion tagとdigestを固定すべきである。[公式Docker images](https://docs.anythingllm.com/installation-docker/available-images)

公式の最小目安はRAM 2GB、2-core CPU、storage 5GBである。LLMは別ホストのAPIへ接続できるため、既存Ollamaを共有可能である。[公式System Requirements](https://docs.anythingllm.com/installation-docker/system-requirements)

公式Docker手順では、`/app/server/storage`とserver `.env`の永続化を推奨し、既定vector DBはLanceDBである。Ollama等のhost serviceへcontainerから接続する場合はDocker networkの到達性を正しく設定する必要がある。[公式Docker手順](https://github.com/Mintplex-Labs/anything-llm/blob/master/docker/HOW_TO_USE_DOCKER.md)

サブPCへ追加する場合の運用増分は次の通り。

- AnythingLLM serviceと永続volumeのbackup、restore、migration。
- 既存Ollamaへの追加生成・埋め込み負荷。
- LanceDBを使う場合はQdrantと別のvector DB運用。
- image更新、API互換性、データmigrationの検証。
- health、latency、restart、disk、文書同期の監視。
- API key rotationとnetwork policy。

AnythingLLM自体は軽量でも、8GB VRAM環境で生成モデルと埋め込みモデルを共有する現在のOllama運用では、background memory extractionや文書embeddingが返信latency・model evictionへ影響し得る。導入評価ではCPU/RAMだけでなく、cold/warm生成、embed、GPU residency、p95を既存`perf:sub-ai-services`相当で測る必要がある。

## セキュリティと個人情報

- self-host版では文書、chat history、workspace設定、embeddingは利用者管理infraへ保存される。local providerを使えばair-gap運用も可能である。一方でfirewall、TLS、access controlは運用者責任である。[公式self-host privacy terms](https://github.com/Mintplex-Labs/anything-llm/blob/master/TERMS_SELF_HOSTED.md)
- anonymous telemetryは無効化できる。Dockerでは`DISABLE_TELEMETRY=true`を設定する。[公式repository](https://github.com/Mintplex-Labs/anything-llm)
- single-user modeではpasswordを知る者が全設定と全chatを閲覧できる。per-user権限が必要ならDocker版multi-user modeを使う。[公式Security and Access](https://docs.anythingllm.com/features/security-and-access)
- memory本文はsystem promptとしてLLM providerへ送られる。第三者provider使用時はそのproviderがmemoryを見られる前提とし、password、API key、機微な個人情報を保存しない。[公式Memories](https://docs.anythingllm.com/features/memories)
- workspaceから文書を外すだけではMy Documentsの原文・cacheは消えない。完全削除にはMy Documentsからの削除が必要である。[公式Privacy & Data](https://docs.anythingllm.com/features/privacy-and-data-handling)
- API keyはBot containerのsecret/envとしてのみ渡し、ログ、README、Git、診断payloadへ出さない。
- 3001/tcpをLANやinternetへ直接公開せず、Dokploy内部network限定にする。管理UIが必要ならTLS付きreverse proxy、multi-user、最小権限を使う。
- `DISABLE_SWAGGER_DOCS=true`をproductionで設定し、API docsを外部へ公開しない。公式`.env.example`もproductionでの無効化を推奨している。[公式Docker env example](https://github.com/Mintplex-Labs/anything-llm/blob/master/docker/.env.example)

## 推奨アーキテクチャ

### 推奨: 記憶系は現行を維持し、文書RAGだけを別レーンで試す

```text
Twitch message
  -> twitchRaid safety/extraction
  -> SQLite authority
       -> activeだけMem0/Qdrantへmirror
  -> local active + Mem0 relevant results
  -> Ollama prompt

管理文書を必要とする質問だけ
  -> AnythingLLM RAG adapter
  -> 専用workspaceの検索結果
  -> 命令ではない参考資料として既存promptへ追加
```

境界:

- ユーザーmemoryの書込み・編集・削除はAnythingLLMへ渡さない。
- AnythingLLM自動memory extractionは無効にする。
- Twitchユーザーの発言全文を文書libraryへ蓄積しない。
- workspaceはBot運用資料専用にし、資料ごとに出典を保持する。
- AnythingLLM失敗時は既存会話をfail-openで継続する。
- RAG結果はuntrusted contentとして扱い、system命令に昇格させない。
- 最初はchat endpointではなく、検索結果だけを取得できるAPI境界を優先する。

### 非推奨: AnythingLLMを会話・記憶の全面gatewayにする

非推奨理由:

- 既存の固定返信、検索、記憶、安全filter、診断、Ollama生成を再実装または二重管理する。
- AnythingLLM内部memoryを正本にするとcandidate/inactive/tombstone契約を失う。
- API service障害がTwitch返信経路へ直結する。
- ユーザー数とworkspace mappingが複雑になる。
- 同じOllamaへ二重のprompt構築とbackground extraction負荷を追加する。

### 非推奨: SQLite、Mem0、AnythingLLM memoryへ同じプロフィールを三重保存する

削除、訂正、重複、古い値の整合性を保証できず、「忘れて」が一部storageにだけ残る危険がある。

## 段階導入案

実装へ進む場合は、まず本番Botへ接続せずPoCで判断する。

1. version固定Docker imageをサブPC内部networkへ配置する。
2. telemetry無効、Swagger無効、外部port非公開、永続volume backupを設定する。
3. 既存Ollamaと`nomic-embed-text`へ接続し、Bot運用Markdown数件だけの専用workspaceを作る。
4. API keyで文書追加、workspace関連付け、vector search/chat、削除後の完全消去を契約テストする。
5. 正解が資料にある質問、ない質問、prompt injection入り資料、古い資料、相互矛盾する資料を評価する。
6. p50/p95、cold/warm、GPU residency、RAM、disk、restart、既存Ollama応答への影響を測る。
7. AnythingLLM停止・timeout時に既存Botが無影響であることを確認する。
8. 基準を満たした場合だけ、明示的な「資料検索」対象へread-onlyで接続する。

## 採否基準

次をすべて満たす場合に限り、文書RAG補助として採用する。

- 現行SQLite正本とMem0補助記憶を変更しない。
- TwitchユーザーmemoryをAnythingLLMへ保存しない。
- APIが内部network限定で、secretがログ・Gitへ出ない。
- versionとimage digestを固定できる。
- 文書削除が原文・embedding・workspace参照の全てで検証できる。
- RAG精度が現行promptへの静的資料注入より明確に良い。
- 既存Ollamaの生成・Mem0 p95とGPU常駐へ許容外の悪化がない。
- AnythingLLM停止時も通常会話が継続する。

現時点の判断は「ユーザー記憶改善としては不採用、管理文書RAGの独立PoC候補」である。
