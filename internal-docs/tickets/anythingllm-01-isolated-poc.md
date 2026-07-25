## Parent

#3

## What to build

本番Botへ接続しない隔離状態で、固定versionのself-host AnythingLLMが既存Ollama、nomic埋め込み、専用Qdrantデータ、SearXNGへ内部ネットワークから接続できる環境を作る。Developer APIでhealth、workspace、文書登録、検索付きchat、削除までを再現可能な契約テストとして通す。

## Acceptance criteria

- [x] AnythingLLM `1.15.0`がversion tagとdigest固定で起動する
- [x] 外部公開portなしで既存OllamaとQdrantへ接続する
- [x] telemetryと本番Swagger公開が無効で、API keyがログやGitへ出ない
- [x] `/api/ping`、workspace作成、文書upload/embed、workspace chatが契約テストを通る
- [x] SearXNGを使う外部検索が隔離probeで実行できる
- [x] 文書をworkspaceからunembedした後、原文とvectorを削除できる
- [x] AnythingLLM停止中も既存Botと固定コマンドへ影響しない
- [x] CPU、RAM、disk、Ollama GPU常駐、cold/warm latencyの基準値を記録する
- [x] 本番接続前にrollbackと永続volumeのbackup/restore手順を確認する

## Blocked by

None — can start immediately.
