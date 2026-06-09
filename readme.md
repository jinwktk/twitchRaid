# TwitchRaid

## セットアップ

### TypeScript版（v2.0 - PM2管理対応）

```bash
npm install
npm run build
```

### PM2で起動
```bash
npm run pm2:start   # 起動
npm run pm2:stop    # 停止
npm run pm2:restart # 再起動
npm run pm2:logs    # ログ確認
```
- PM2プロセス名は本番運用に合わせて `twitchRaid` に統一しています

### ログ確認運用
- BotはサブPCで動かす運用のため、問題確認時はローカル作業PCのログだけでなく、必ずサブPC側のPM2ログと `logs/bot_YYYY-MM-DD.log` を確認する
- SQLiteキャッシュ系の調査では、サブPC側の `data/clips.sqlite` の作成状況と更新時刻も確認する

### 技術設計書
- 現行TypeScript版 Twitch Bot のシステム仕様書/機能設計書は `docs/index.html` に統合しています
- 旧URL互換の `docs/typescript-bot-spec.html` は `docs/index.html` へ案内するだけのページです
- `main` ブランチの `docs/` 更新時に `.github/workflows/pages.yml` がGitHub Pagesへ公開します
- Markdown設計資料は `docs/ARCHITECTURE.md` / `docs/COMMANDS.md` / `docs/DESIGN_PATTERNS.md` / `docs/TECH_STACK.md` に補助資料として残しています

### 直接起動
```bash
npm start           # ビルド済みを実行
npm run dev         # ts-nodeで開発実行
```

### 環境設定
- `.env` に Twitch/Discord 認証情報と `LAST_STREAM_TITLE` を設定
- Twitch認証は Bot 動作に必要な最小スコープのみ要求（`chat` / `shoutout` / `chat message delete` 系）
- トークン検証時は 401 Unauthorized の場合のみ再取得を実行します
- 起動時の有効トークン検証と再取得成功時に、付与済みスコープ一覧を `[ECHO]` ログとして出力します
- `SHOUTOUT_ADMIN_USERS` に `!shoutout` を実行できる追加ユーザーをカンマ区切りで設定できます（未設定時は `rukalun`）
- `MANGA_ADMIN_USERS` に `!mangaon` / `!mangaoff` を実行できる追加ユーザーをカンマ区切りで設定できます。にめいやアカウントは表示名ではなくTwitchログイン名 `nyme_ia` で登録します
- `TWITCH_CLIP_CACHE_DB_PATH` に `!clip` / `!myclip` のクリップキャッシュ SQLite DB パスを設定できます（未設定時は `data/clips.sqlite`）
- `TWITCH_GQL_CLIENT_ID` に Twitch GraphQL 用 Client-ID を任意設定できます（未設定時はTwitch Webの公開Client-IDを使用し、指定値が拒否された場合も公開Client-IDへフォールバック）
- `STREAM_SUMMARY_STATE_PATH` に配信まとめの再起動復元用JSONパスを設定できます（未設定時は `data/stream-summary-state.json`）
- `STREAM_SUMMARY_MAX_CLIPS` に配信まとめスレッドへ投稿する最大クリップ数を設定できます（未設定時は `10`）
- `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` を設定すると、Bot APIで配信開始通知、クリップURL、終了まとめを投稿し、配信開始通知メッセージからDiscordスレッドを作成します。`DISCORD_WEBHOOK_URL` はBot設定が無い場合、またはBot API投稿が403などで失敗した場合のフォールバックです
- `DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定すると、Webhookだけで `thread_name` によるスレッド作成を試します。この方式はDiscordのフォーラム/メディアチャンネルWebhook向けです。通常テキストチャンネルWebhookではDiscord側で拒否されるため、自動で通常Webhook投稿へフォールバックします
- `OLLAMA_SHOUTOUT_ENABLED=true` と `OLLAMA_SHOUTOUT_MODEL` を設定すると、Raid時にOllama `POST /api/generate` で1通のRaid挨拶文を生成してチャットへ送信します。AI生成文はコード側で250文字以内に丸めます。`OLLAMA_BASE_URL` は未設定時 `http://127.0.0.1:11434`、`OLLAMA_SHOUTOUT_TIMEOUT_MS` は未設定時 `8000`、`OLLAMA_SHOUTOUT_KEEP_ALIVE` は未設定時 `5m` です

## 技術スタック
- **ランタイム**: Node.js 22.5+（`node:sqlite` を使用）
- **言語**: TypeScript 5.7
- **Twitchライブラリ**: @twurple/api, @twurple/auth, @twurple/chat
- **ログ**: winston + winston-daily-rotate-file
- **プロセス管理**: PM2（プロセス名: `twitchRaid`）
- **旧Python版**: `main.py` などは過去資産・互換テスト用に残存。現行運用と仕様書の正本はTypeScript版

## コマンド一覧

| コマンド | 説明 | 備考 |
|---------|------|------|
| `!age` | 年齢を表示 | |
| `!goods` | グッズ販売ページのURLを表示 | [booth.pm](https://rukalun.booth.pm) |
| `!weight` | ランダムな体重を表示（15〜200kg） | ネタ枠 |
| `!height` | ランダムな身長を表示（120〜220cm） | ネタ枠 |
| `!mood` | 今日の気分をランダム表示 | 15種類からランダム |
| `!menu` | 今日のおすすめメニューをランダム表示 | 70種類以上からランダム |
| `!clip` | 過去のクリップをランダム表示 | 30分クールダウン（特別ユーザー除外） |
| `!myclip` | 自分が作成したクリップをランダム表示 | 30分クールダウン（`!clip`とは独立） |
| `!manga` | DLsite日間ランキングからランダムに1作品表示 | ON/OFF切替可、10秒後自動削除 |
| `!mangaon` | `!manga` コマンドを有効化 | 管理者のみ |
| `!mangaoff` | `!manga` コマンドを無効化 | 管理者のみ |
| `!shoutout <ユーザー名>` | 指定ユーザーへ手動 shoutout を実行 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ |
| `!speed` | コメント風速を表示（直近60秒＋配信全体平均） | コマンドは計測対象外 |
| `!commentcount` | 配信開始からの累計コメント件数を表示 | 再起動後も引き継ぎ |
| `!boom` | 過去30日間で1時間以上遊んだゲーム別トータル時間と総配信時間を表示 | VODチャプター情報を集計 |
| `!streamnotify` | 現在の配信開始通知をDiscordへ手動送信 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ |

## .env保護
- `.env` の更新は `env-store.ts` で実行し、更新前に `.env.backup` を作成
- `.env.backup` と `.env.tmp` はバックアップ/一時ファイルのため Git 管理外

## 再起動ポリシー
- 定期再起動は 1 日 1 回
- GitHub 更新による再起動はクールダウン対象外。pull と build が終わったら即 `process.exit(0)` でPM2再起動をトリガーする
- PM2管理下では `process.exit(0)` でPM2が自動再起動
- TypeScript版は `dist/` を Git 管理しないため、GitHub更新検知後に自動で `npm run build` を実行
- 定期再起動だけは `last_restart.txt` による1日クールダウンを維持する

## 配信通知仕様
- 配信開始検知時に Discord Bot API で通知（Bot設定が無い場合、またはBot API投稿が失敗した場合はWebhookへフォールバック）
- 配信開始通知は本文 `@everyone` とDiscord Embedで投稿する。Embedには配信タイトル、Twitch URL、ゲーム名、視聴者数、Twitchプレビュー画像を含める
- 配信開始通知が漏れた場合は、管理者が `!streamnotify` を実行すると現在の配信情報でDiscordへ手動送信する。通常のタイトル重複スキップは通さない
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 配信開始中は `STREAM_SUMMARY_STATE_PATH` に stream id / タイトル / ゲーム名 / 開始時刻 / コメント数 / Raid数を保存
- 通常コメントによる配信まとめコメント数更新は30秒デバウンスでJSON保存し、Raid受信・停止・配信終了時は即時flushして取りこぼしを防ぐ
- `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` がある場合、配信開始通知メッセージからDiscordスレッドを作成し、そのスレッドIDを保存する
- 同一タイトルで開始通知がスキップされた再起動ケースでも、保存済み開始通知メッセージIDがあれば重複投稿せずスレッド作成だけを再試行する。開始通知メッセージIDも無い場合、自動スレッド保証処理は新しい開始通知を投稿しない
- 通常の配信開始通知を送った直後にスレッド作成だけ失敗した場合、同じ開始処理内では新しい開始通知を投稿し直さない。Clip/終了まとめ前のスレッド保証でも開始通知を自動再投稿しない。これによりDiscordへ開始通知が2通流れることを防ぐ
- `!streamnotify` で手動送信した場合は、新しく送った通知投稿の `startMessageId` / `threadId` を既存stateより優先し、その通知投稿から作成したスレッドへ以後のクリップと終了まとめを集約する
- 直近クリップ同期は1分ごとに実行し、配信中に新規クリップを検知したら未投稿分だけ配信まとめスレッドへ投稿して `postedClipIds` に保存する
- クリップ検知時に `threadId` が無い場合は、保存済み `startMessageId` からスレッド作成だけを再試行する。`startMessageId` も無い場合やスレッド作成に失敗した場合は、開始通知を再投稿せず警告ログで止める
- 開始通知そのものを再送したい場合は、管理者が `!streamnotify` を使って明示的に手動送信する
- 新しい開始通知が投稿されたが `threadId` が返らなかった場合は、古い `threadId` を保持せずクリアする。これにより、存在しない/古いスレッドへ投稿済み扱いで `postedClipIds` だけ進むことを防ぐ
- 配信終了検知時に「配信終了まとめ」をDiscordへ投稿し、配信時間、ゲーム、コメント数、Raid数、クリップ数、ハイライト候補を表示
- まとめ投稿前に配信時間帯のクリップを最終同期し、active/pendingどちらの状態でも開始通知起点のスレッド保証を通してから、未投稿クリップと終了まとめを投稿する
- 終了まとめ投稿後も配信まとめスレッドはアーカイブせず、開始通知から見える状態を保つ
- 配信開始時にスレッド作成済みなら、クリップURLと終了まとめはそのスレッドへ投稿する
- 配信開始時にBot API投稿やスレッド作成ができなかった場合は、通常Webhook投稿へフォールバックする。終了まとめとクリップURL投稿もBot API失敗時はWebhookへフォールバックする
- Bot Tokenを使わずWebhookだけで完結させたい場合は、Webhook先をフォーラム/メディアチャンネルにし、`DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定する。まとめ投稿に `thread_name` を付けてスレッドを作成し、返却されたスレッドIDへクリップURLを投稿する
- Bot再起動時に未投稿の配信まとめ状態が残っていて、Twitchがオフラインなら保存済み情報から投稿を再試行

## レイド自動シャウトアウト
- レイド検知時は `src/commands/shoutout.ts` でレイド元のユーザーIDを解決し、Bot/Moderator のユーザーコンテキストで `chat.shoutoutUser` を実行
- レイド検知時は `src/commands/raid-info.ts` でレイド元の配信情報を取得し、Ollamaが無効または失敗した場合はチャットへ `レイドありがとうD！！ @ユーザー さんは、「ゲーム名」で「配信タイトル」をしてたD！お疲れ様D！チャンネルはこD→URL` を1通だけ送信する
- `OLLAMA_SHOUTOUT_ENABLED=true` の場合は、取得したRaid元のユーザー名/ゲーム/タイトル/URLをもとに `src/commands/shoutout-introduction.ts` で同じ役割のRaid挨拶文を生成し、固定文の代わりに1通だけ送信する。Raid人数はAI入力に含めず、人数の多い少ないには触れさせない
- Ollama挨拶文生成はshoutoutキュー投入後に実行する。AI生成文は `@ユーザー名` とチャンネルURLを必ず含むよう補正し、絵文字を除去し、URLを残したまま250文字以内へ丸める。ゲーム名と配信タイトルが入っていて、何をして遊んでいたかが手短に分かる紹介文だけを採用する。`人数少なかった`、`少人数`、`寂しい` などRaid規模を下げる表現を含む場合はAI文を採用せず、固定のRaid挨拶文へフォールバックする。Ollamaが未設定、タイムアウト、HTTPエラー、空応答、日本語かなを含まない返答の場合も固定文へフォールバックし、Twitch shoutout APIは継続する
- Raid元の配信がすでにオフライン、またはTwitch APIでタイトル/ゲームを取得できない場合でも、チャンネルURL付きのフォールバック文を送信する
- Raid自動shoutoutは `ShoutoutQueue` で直列化し、Twitchの `429 Too Many Requests` に当たった対象はキュー先頭へ戻して2分後に再実行する
- Twurple のデフォルト挙動で broadcaster の未登録トークンを探しに行かないよう、`apiClient.asUser(botUserId, ...)` で明示的にコンテキストを切り替える
- 送信失敗時は登録済み Bot ユーザーのトークンをリフレッシュしてから同じ経路でリトライする
- デバッグ用に `!shoutout <ユーザー名>` でも同じ送信経路を手動実行できる
- 手動実行は broadcaster / mod / `SHOUTOUT_ADMIN_USERS` に含まれるユーザーのみ許可

## Clipコマンドメモ
- `.env` の `CLIP_SPECIAL_USERS` (初期値: `nyme_ia,rukalun`) に含まれるユーザーはクールダウン無しで実行可能
- 一般ユーザーは 30 分のクールダウンが適用
- クールダウン終了時に Bot がチャットへ「リキャスト復帰」コメントを自動送信
- `!myclip` は `!clip` とは独立したクールダウン管理
- 起動後に `data/clips.sqlite` へ全期間クリップをバックグラウンド同期する
- 同期済み期間は `clip_scan_windows` に保存し、再起動後は取得済み期間をスキップ
- 配信していない時間に1日1回、全期間を再走査してTwitch側で返らなくなったClipを `unavailable_at` 付きで無効化する
- 無効化されたClipは `!clip` / `!myclip` と配信まとめクリップ候補から除外され、Twitch APIで再び返った場合は自動で有効化される
- 日次再走査の最終実行時刻は `clip_sync_state` の `daily_reconcile_at` に保存する
- 直近1時間のクリップは起動直後と1分ごとに再同期し、起動中に作られたクリップも候補へ入れる
- `!clip` / `!myclip` 実行時はSQLiteキャッシュから即選択し、キャッシュ未準備時のみ最大200件の軽いAPIフォールバックを使う
- 直近に表示したクリップIDはSQLite内の `clip_history` に保存し、`!clip` 全体と `!myclip:<ユーザー>` ごとに重複を避ける。全候補を出し切った場合のみ履歴内のクリップも再候補に戻す

## Boomコマンドメモ
- `!boom` は過去30日間のアーカイブ配信を対象に、Twitch GraphQL の VOD チャプターからゲーム別の配信時間と総配信時間を集計する
- ゲーム別合計が1時間未満のものは表示対象外
- 表示は合計時間の長い順で最大6件まで
- 返却文言は棒読みの長文読み上げを避けるため、先頭に `!` を付けて読み上げスキップ対象にする
- VOD単位のGraphQL取得は最大4本並列で実行し、結果は5分間メモリキャッシュする

## プロジェクト構成

```
src/
├── index.ts                       # エントリーポイント
├── config.ts                      # .env設定管理
├── bot.ts                         # Bot本体（Twurple統合）
├── git-manager.ts                 # Git更新検知・build・再起動
├── system-watcher.ts              # 定期監視（更新・再起動）
├── auth/
│   ├── auth-scope-sets.ts         # 必須OAuthスコープ
│   ├── scope-policy.ts            # スコープ不足判定
│   ├── token-manager.ts           # token validate/refresh
│   └── token-refresh-policy.ts    # refresh fallback判定
├── chat/
│   ├── command-cooldown-state.ts  # コマンド別クールダウン
│   ├── comment-count-formatter.ts # コメント数文言
│   ├── comment-speed-meter.ts     # コメント風速
│   └── message-filters.ts         # コマンド判定
├── commands/
│   ├── age.ts
│   ├── boom.ts                    # 過去30日ゲーム時間集計
│   ├── clip-cache-store.ts        # Clip SQLiteキャッシュ
│   ├── clip-cache-sync.ts         # Clip同期/日次再走査
│   ├── clip.ts                    # !clip / !myclip
│   ├── manga.ts                   # !manga / 管理者判定
│   ├── raid-info.ts               # Raid元配信情報文言
│   ├── random-commands.ts
│   ├── shoutout-introduction.ts   # OllamaによるRaid挨拶文生成
│   ├── shoutout.ts                # shoutout権限/キュー
│   └── stream-notify.ts           # !streamnotify
├── notifications/
│   ├── clip-recast-notifier.ts
│   ├── discord-webhook.ts         # Discord Bot/Webhook/Thread
│   └── stream-notifications.ts    # 配信開始通知Embed
├── streams/
│   ├── stream-summary-count-buffer.ts # コメント数/Raid数のデバウンス保存
│   ├── stream-summary-state-store.ts
│   └── stream-summary.ts          # 配信まとめ/Clip投稿/スレッド保証
└── utils/
    ├── comment-state-store.ts
    ├── env-store.ts
    ├── logger.ts
    ├── process-restart.ts
    └── restart-state-store.ts
```

## 更新履歴
- **2026-06-09**: 配信開始通知の二重送信を防ぐため、配信まとめスレッド保証処理が開始通知を自動再投稿しないよう変更。保存済み `startMessageId` が無い競合タイミングでは送信せず、必要時は `!streamnotify` で明示的に再送する
- **2026-06-08**: 配信終了まとめ後も開始通知スレッドをアーカイブしないよう変更。既存通知にスレッドが建っていないように見えた原因は、スレッド作成後に `archived=true` になっていたため
- **2026-06-08**: 配信開始通知を `@everyone` 付きDiscord Embedへ変更。タイトル、ゲーム名、視聴者数、Twitchプレビュー画像をEmbedに入れ、Bot API/Webhookどちらの投稿でも同じ見た目になるようにした
- **2026-06-08**: Ollama Raid挨拶文をコード側で250文字以内へ制限。プロンプトから `250文字以内` の数値指示を外し、モデルが文字数を人数として誤読するリスクを下げる
- **2026-06-08**: Ollama Raid挨拶文の低人数ネガティブ表現を禁止。AI入力からRaid人数を外し、`人数少なかった` / `少人数` / `寂しい` 系の生成文は採用せず固定Raid挨拶文へフォールバックする
- **2026-06-08**: Ollama Raid挨拶文を紹介文として強化。AI文にゲーム名と配信タイトルが含まれない場合は採用せず、何をして遊んでいたかが手短に分かる文だけを使う
- **2026-06-07**: Raid時の挨拶文をOllamaで生成する任意機能を追加。`OLLAMA_SHOUTOUT_ENABLED=true` と `OLLAMA_SHOUTOUT_MODEL` 設定時だけ、サブPC上のOllama APIへ1通のRaid挨拶文を依頼し、失敗時は固定Raid挨拶文へフォールバックする。生成文は `@ユーザー名` とURLを保証し、絵文字は除去する
- **2026-06-07**: 配信開始通知直後のスレッド補完で、保存済み `startMessageId` からスレッド作成に失敗しても同じ開始処理内では開始通知を投稿し直さないよう修正。クリップ/終了まとめ前の保証処理では従来どおり必要時のみ再投稿する
- **2026-06-06**: ソース側の性能レビュー反映として、通常コメント1件ごとの配信まとめstate JSON同期書き込みを廃止。`StreamSummaryCountBuffer` で30秒デバウンスし、Raid/停止/配信終了時は即時flushするよう変更
- **2026-06-06**: GitHub Pagesの仕様書を `docs/index.html` に一本化し、`docs/typescript-bot-spec.html` は統合先への案内ページへ変更。図解中心のTypeScript版総合仕様書として、配信通知、Clip同期、Raid情報、shoutoutキュー、Boom集計、フォールバック、品質ゲートを追記
- **2026-06-06**: PM2プロセス名の記述を本番運用に合わせて `twitchRaid` に統一
- **2026-06-06**: 配信開始通知が漏れた時の復旧用に、管理者限定の `!streamnotify` コマンドを追加
- **2026-06-06**: 配信開始通知へ `🔴 配信URL: https://www.twitch.tv/rukalun` の表示を復元
- **2026-06-06**: サブPC本番ログで配信開始通知が `Discord bot message failed: 403` により停止していたことを確認。`DISCORD_WEBHOOK_URL` が設定済みだったため、配信開始通知・配信終了まとめ・配信中クリップ投稿でBot API失敗時にWebhookへフォールバックするよう修正
- **2026-06-02**: 配信終了まとめを追加。配信中状態をJSONに保持し、再起動後も未投稿まとめを復元してDiscordへ再試行。クリップはまとめメッセージのDiscordスレッドへ投稿可能
- **2026-06-02**: フォーラム/メディアチャンネルWebhook向けに、Bot Tokenなしで `thread_name` から配信まとめスレッドを作るWebhook-onlyモードを追加
- **2026-06-03**: Bot Token方式を配信開始通知スレッド化へ変更。配信開始通知から作成したスレッドへ、配信終了まとめとクリップを投稿
- **2026-06-03**: 再起動時に同一タイトルで開始通知がスキップされても、配信まとめstateにスレッドIDがなければ開始通知メッセージからスレッド作成を補完するよう修正
- **2026-06-03**: Discordへ投稿する配信開始通知と配信終了まとめから、配信URL行を一度削除（2026-06-06に開始通知の配信URL行を復元済み）
- **2026-06-03**: 配信中の新規クリップを1分ごとの直近同期で検知して配信まとめスレッドへ随時投稿するよう変更
- **2026-06-03**: 配信まとめ系のDiscord投稿をWebhook優先からBot API優先へ変更。Bot TokenとチャンネルIDがあればWebhook URLなしで開始通知、クリップ、終了まとめを投稿可能
- **2026-06-03**: Clipキャッシュを配信していない時間に1日1回再走査し、削除済みなどTwitch APIから返らなくなったClipを無効化して候補から除外するよう変更
- **2026-06-03**: `!boom` の集計対象が直近20配信へ戻っていたデグレを修正し、過去30日間集計と総配信時間表示へ戻した
- **2026-06-03**: `!boom` の長文読み上げを避けるため、返却文言の先頭に `!` を付けるよう変更
- **2026-05-31**: GitHub更新検知後の再起動をクールダウン対象外に変更。pull/build成功後は即PM2再起動をトリガーする
- **2026-05-30**: `!boom` の取得を最大4本並列にし、5分キャッシュで再実行時の応答を高速化
- **2026-05-30**: `!boom` のGraphQL 400失敗を修正。Twitch persisted query と公開Client-IDフォールバックを使い、チャプターが空の単一ゲーム配信はVODメタデータで集計
- **2026-05-30**: `!boom` を追加。直近20配信のVODチャプターから、1時間以上遊んだゲーム別トータル時間を表示
- **2026-05-29**: サブPC側ログを確認。`twitchRaid` はPM2上で online、PM2 error log は空、`data/clips.sqlite` は2736件・全走査窓 completed で稼働中
- **2026-05-25**: `!myclip` のSQLiteキャッシュ検索を解決済みユーザーID対応にし、ログイン名と表示名が違うユーザーでもキャッシュから選択できるよう修正
- **2026-05-25**: クリップ全期間走査をSQLiteキャッシュ化し、起動中の新規クリップは直近同期で反映
- **2026-05-25**: 初コメ保存と `!firstcomment` を削除。当時の `!clip` / `!myclip` を高速ページング最大1000件へ変更（現行のコマンド実運用フォールバックは最大200件）
- **2026-05-25**: `!clip` / `!myclip` を日付窓ページング取得へ変更し、表示履歴で重複をなるべく回避
- **2026-05-25**: ユーザー別初コメを SQLite に保存し、`!firstcomment` 本人表示を追加。過去アーカイブ抽出は無効化
- **2026-05-11**: `!shoutout <ユーザー名>` デバッグコマンドと権限設定 `SHOUTOUT_ADMIN_USERS` を追加
- **2026-05-11**: shoutout修正を `main` に反映。Git更新後の build と再起動クールダウン時の注意を追記
- **2026-05-11**: レイド自動シャウトアウトを Bot/Moderator ユーザーコンテキストで実行するよう修正
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
