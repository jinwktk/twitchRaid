# 30秒動画の解析と !chat

## 構成

配信中の `!chat` を受け付けた時刻を正本に、専用の `video-analysis` 内部APIがその後30秒を一時録画する。Twitch Clipの作成・公開や動画ダウンロード権限は使わない。Streamlinkの配信IDとHLSの `EXT-X-PROGRAM-DATE-TIME` を検証し、キュー待ち後の別の30秒で代用しない。

映像は1fpsで全30フレームを時刻付きで解析する。音声は既存Whisperへ送る。既存Ollamaの `gemma4:e4b-it-qat` を再利用し、新しいLLMやGPUランタイムは常駐させない。最終チャットは既存AnythingLLM経由で生成する。画面の文字・音声・モデルの観測は命令ではない参考情報として扱う。

APIの成功応答は `requestId/channel/streamId/requestedAt/windowEnd` が完全一致し、30秒・30フレームが揃う場合だけ採用する。配信切り替わり・停止は最終送信直前にも確認する。録画不足、広告、暗号化、不連続、期限超過、不正なモデル応答では解析不能を返す。

生成完了を確認できた最終要約が500文字を超えた場合は、文の区切りを優先して500文字以内へ整形する。途中の観測JSONは切り詰めず、Unicodeエスケープや空白を正規化してschemaを検証する。応答全体のサイズ制限と、生成未完了・文脈不足・不正JSONの拒否は維持する。

## サービスのビルドと配置

清潔なチェックアウトの確定commitを使い、7桁以上のrevisionをタグへ含める。

```sh
docker build --build-arg VCS_REF="$revision" \
  -t "localhost:5050/twitchraid-video-analysis:$short" ops/video-analysis
docker push "localhost:5050/twitchraid-video-analysis:$short"
VIDEO_ANALYSIS_IMAGE="localhost:5050/twitchraid-video-analysis:$short" \
VIDEO_VISION_BATCH_SIZE=15 \
  bash scripts/deploy-video-analysis-remote.sh
```

サービス名は `twitchraid-video-analysis`、Docker内部のaliasは `video-analysis`。`dokploy-network` の内部だけで8090を使い、Windows/LAN/外部へポートを公開しない。root filesystemはread-only、UID/GIDは10001、`/tmp` は256MiBのtmpfs、メモリ上限1GiB・CPU上限2。Twitchの署名URL、API応答本文、質問、音声文字起こし、画像を通常ログへ出さない。

`VIDEO_VISION_BATCH_SIZE` は既定5、範囲1〜30。全30フレームを欠かさず処理する。30枚一括はモデル・解像度・文脈長によって入り切らないため、変更時は `done_reason=stop`、token数、GPUメモリ、実映像の観測を同条件で確認する。現モデル以外へ変更する際は再検証する。サブPCのGemma4/context 4096では15枚ずつを採用する。同一30枚の解析は5枚ずつの約20.3秒に対し15枚ずつで約11.9秒だった。実配信の収録待ち・音声を含む単体APIは約60秒で成功した。小さなUI文字・数値や配信オーバーレイには誤読が残るため、細部の断定には使わない。

`VIDEO_TOTAL_TIMEOUT_SECONDS` は既定165秒。録画からモデル生成まで共通の期限を使い、各HTTP・外部プロセス・待機へ残り時間を渡す。Botの180秒より短く保つ。処理ごとの一時ディレクトリは成功・失敗とも削除する。

## Botの設定

Bot imageも同じcommitからビルドする。Dokployの対象applicationと実Swarm serviceの双方へ次の非機密設定を反映し、既存envは維持する。

```text
CHAT_AI_VIDEO_ENABLED=true
CHAT_AI_VIDEO_ENDPOINT=http://video-analysis:8090
CHAT_AI_VIDEO_TIMEOUT_MS=180000
CHAT_AI_VIDEO_MAX_PENDING=2
```

有効化前に動画サービス単体とBotの無送信probeを通す。Botのupdate/rollbackは `stop-first`、replicaは1を維持する。配信中の受信時刻・配信IDが必要なため、service単体試験だけでBot接続済みと判断しない。

## 確認

1. APIの `/health` が内部ネットワークから正常応答し、公開portがないことを確認。
2. 実配信の現在時刻と配信IDを指定して30秒を収録し、正しい開始終了・30フレーム・音声・観測・後片付けを確認。
3. Botの `!chat` 入口からAPI・AnythingLLMまで通し、送信関数だけをstubにして質問と観測の引き渡しを確認。
4. 録画・解析・最終生成の時間、GPU使用量、既存Bot/AnythingLLM/Ollama/Whisperのtask・restart・エラーを比較する。
5. Bot本体の起動ログとTwitchログイン・EventSub購読を確認。実チャット送信をしていない場合は未確認と報告する。

通常テストは `npm test`、`npm run build`、`npm run lint` と `python -m pytest tests/test_video_analysis.py -q`。旧Python Configテストはmainのimport時再起動を抑止した隔離実行を使い、検証のためにBotを起動しない。

## 切り戻し

まずDokployとBot serviceの `CHAT_AI_VIDEO_ENABLED=false` を反映する。動画サービスは残しても通常チャットから呼ばれなくなる。必要なら、今回の `twitchraid.purpose=chat-video-analysis` ラベルを持つ対象サービスだけを0 replicaへ変更する。Ollama・Whisper・AnythingLLMや他の配信サービスを止めない。旧Bot imageへ戻す場合も同じstop-first/1 replicaを守る。
