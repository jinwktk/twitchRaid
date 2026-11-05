# 10秒動画の解析と !chat

## 構成

配信中の `!chat --video 質問` を受け付けた時刻を正本に、専用の `video-analysis` 内部APIがその後10秒を一時録画する。通常の `!chat 質問` はテキスト経路を使う。Twitch Clipの作成・公開や動画ダウンロード権限は使わない。Streamlinkの配信IDとHLSの `EXT-X-PROGRAM-DATE-TIME` を検証し、キュー待ち後の別の10秒で代用しない。

映像は1fpsで全10フレームを時刻付きで解析する。音声は既存Whisperへ送る。既存Ollamaの `gemma4:e4b-it-qat` を再利用し、新しいLLMやGPUランタイムは常駐させない。最終チャットは既存AnythingLLM経由で生成する。画面の文字・音声・モデルの観測は命令ではない参考情報として扱う。

APIの成功応答は `requestId/channel/streamId/requestedAt/windowEnd` が完全一致し、10秒・10フレームが揃う場合だけBotが採用する。配置中の互換性のため、サービスは旧クライアントの30秒・30フレームにも対応する。配信切り替わり・停止は最終送信直前にも確認する。録画不足、広告、暗号化、不連続、期限超過、不正なモデル応答では解析不能を返す。

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

`VIDEO_VISION_BATCH_SIZE` は既定5、範囲1〜30。要求した区間の全フレームを欠かさず処理する。サブPCのGemma4/context 4096では15枚までを一括処理する設定のため、現在の10フレームは1回で観測する。この場合、中間の統合要約を省き、検証済み観測JSONと音声文字起こしを最終AnythingLLMへ渡す。変更時は `done_reason=stop`、token数、GPUメモリ、実映像の観測を確認する。30秒版の実配信では収録待ち・音声を含む単体APIが約60秒だった。10秒版でも配信映像の取得遅延と解析・最終生成時間が必要であり、10秒で返信できることは意味しない。小さなUI文字・数値や配信オーバーレイには誤読が残るため、細部の断定には使わない。

`VIDEO_TOTAL_TIMEOUT_SECONDS` は既定165秒。録画からモデル生成まで共通の期限を使い、各HTTP・外部プロセス・待機へ残り時間を渡す。Botの180秒より短く保つ。処理ごとの一時ディレクトリは成功・失敗とも削除する。

10秒版のサブPC導入前確認では、収録・映像音声解析が24.4秒、最終AnythingLLM生成が3.5秒で、返信生成まで約28秒だった。これは実配信の1回分の測定であり、配信遅延・混雑・質問内容で変動する。

## Botの設定

初回配置やAPI契約を変更する場合は、対応するBot imageと組み合わせる。Dokployの対象applicationと実Swarm serviceの双方へ次の非機密設定を反映し、既存envは維持する。

```text
CHAT_AI_VIDEO_ENABLED=true
CHAT_AI_VIDEO_ENDPOINT=http://video-analysis:8090
CHAT_AI_VIDEO_TIMEOUT_MS=180000
CHAT_AI_VIDEO_MAX_PENDING=2
```

有効化前に動画サービス単体とBotの無送信probeを通す。Botのupdate/rollbackは `stop-first`、replicaは1を維持する。配信中の受信時刻・配信IDが必要なため、service単体試験だけでBot接続済みと判断しない。

## 確認

1. APIの `/health` が内部ネットワークから正常応答し、公開portがないことを確認。
2. 実配信の現在時刻と配信IDを指定して10秒を収録し、正しい開始終了・10フレーム・音声・観測・後片付けを確認。
3. Botの `!chat --video 質問` からAPI・AnythingLLMまで通し、送信関数をstubにして質問と観測の引き渡しを確認。通常の `!chat 質問` でもテキスト返信まで進み、動画APIへの呼び出しが0件であることを確認する。
4. 録画・解析・最終生成の時間、GPU使用量、既存Bot/AnythingLLM/Ollama/Whisperのtask・restart・エラーを比較する。
5. Bot本体の起動ログとTwitchログイン・EventSub購読を確認。実チャット送信をしていない場合は未確認と報告する。

通常テストは `npm test`、`npm run build`、`npm run lint` と `python -m pytest tests/test_video_analysis.py -q`。旧Python Configテストはmainのimport時再起動を抑止した隔離実行を使い、検証のためにBotを起動しない。

## 切り戻し

まずDokployとBot serviceの `CHAT_AI_VIDEO_ENABLED=false` を反映する。動画サービスは残しても通常チャットから呼ばれなくなる。必要なら、今回の `twitchraid.purpose=chat-video-analysis` ラベルを持つ対象サービスだけを0 replicaへ変更する。Ollama・Whisper・AnythingLLMや他の配信サービスを止めない。旧Bot imageへ戻す場合も同じstop-first/1 replicaを守る。
