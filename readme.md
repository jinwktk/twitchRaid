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

### ログ確認運用
- BotはサブPCで動かす運用のため、問題確認時はローカル作業PCのログだけでなく、必ずサブPC側のPM2ログと `logs/bot_YYYY-MM-DD.log` を確認する
- SQLiteキャッシュ系の調査では、サブPC側の `data/clips.sqlite` の作成状況と更新時刻も確認する

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

## 技術スタック
- **ランタイム**: Node.js 22.5+（`node:sqlite` を使用）
- **言語**: TypeScript 5.7
- **Twitchライブラリ**: @twurple/api, @twurple/auth, @twurple/chat
- **ログ**: winston + winston-daily-rotate-file
- **プロセス管理**: PM2
- **以前のPython版**: main.py（後方互換性のため残存）

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
| `!manga` | DLsite日間ランキングからランダムに1作品表示 | ON/OFF切替可、5秒後自動削除 |
| `!mangaon` | `!manga` コマンドを有効化 | 管理者のみ |
| `!mangaoff` | `!manga` コマンドを無効化 | 管理者のみ |
| `!shoutout <ユーザー名>` | 指定ユーザーへ手動 shoutout を実行 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ |
| `!speed` | コメント風速を表示（直近60秒＋配信全体平均） | コマンドは計測対象外 |
| `!commentcount` | 配信開始からの累計コメント件数を表示 | 再起動後も引き継ぎ |
| `!boom` | 過去30日間で1時間以上遊んだゲーム別トータル時間と総配信時間を表示 | VODチャプター情報を集計 |

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
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 配信開始中は `STREAM_SUMMARY_STATE_PATH` に stream id / タイトル / ゲーム名 / 開始時刻 / コメント数 / Raid数を保存
- `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` がある場合、配信開始通知メッセージからDiscordスレッドを作成し、そのスレッドIDを保存する
- 同一タイトルで開始通知がスキップされた再起動ケースでも、保存済み開始通知メッセージIDがあれば重複投稿せずスレッド作成だけを再試行する。開始通知メッセージIDも無い場合は開始通知を1回投稿してスレッドIDを保存する
- 直近クリップ同期は1分ごとに実行し、配信中に新規クリップを検知したら未投稿分だけ配信まとめスレッドへ投稿して `postedClipIds` に保存する
- 配信終了検知時に「配信終了まとめ」をDiscordへ投稿し、配信時間、ゲーム、コメント数、Raid数、クリップ数、ハイライト候補を表示
- まとめ投稿前に配信時間帯のクリップを最終同期し、未投稿クリップを先にスレッドへ投稿してから終了まとめを投稿する
- 終了まとめ投稿後、Bot Tokenで配信まとめスレッドをアーカイブして閉じる
- 配信開始時にスレッド作成済みなら、クリップURLと終了まとめはそのスレッドへ投稿する
- 配信開始時にBot API投稿やスレッド作成ができなかった場合は、通常Webhook投稿へフォールバックする。終了まとめとクリップURL投稿もBot API失敗時はWebhookへフォールバックする
- Bot Tokenを使わずWebhookだけで完結させたい場合は、Webhook先をフォーラム/メディアチャンネルにし、`DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定する。まとめ投稿に `thread_name` を付けてスレッドを作成し、返却されたスレッドIDへクリップURLを投稿する
- Bot再起動時に未投稿の配信まとめ状態が残っていて、Twitchがオフラインなら保存済み情報から投稿を再試行

## レイド自動シャウトアウト
- レイド検知時は `src/commands/shoutout.ts` でレイド元のユーザーIDを解決し、Bot/Moderator のユーザーコンテキストで `chat.shoutoutUser` を実行
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
├── index.ts              # エントリーポイント
├── config.ts             # 設定管理（.env読み込み）
├── bot.ts                # Bot本体（twurple統合）
├── git-manager.ts        # Git更新検知・再起動
├── system-watcher.ts     # 定期監視（更新・再起動）
├── auth/                 # OAuth認証管理
│   ├── token-manager.ts
│   ├── token-refresh-policy.ts
│   ├── scope-policy.ts
│   └── auth-scope-sets.ts
├── commands/             # チャットコマンド
│   ├── age.ts
│   ├── boom.ts
│   ├── clip-cache-store.ts
│   ├── clip-cache-sync.ts
│   ├── clip.ts
│   ├── manga.ts
│   ├── shoutout.ts
│   └── random-commands.ts
├── streams/              # 配信まとめ状態と投稿
│   ├── stream-summary.ts
│   └── stream-summary-state-store.ts
├── chat/                 # チャット機能
│   ├── command-cooldown-state.ts
│   ├── comment-speed-meter.ts
│   ├── comment-count-formatter.ts
│   ├── message-filters.ts
│   ├── message-delete-tracker.ts
│   └── chat-message-response.ts
├── notifications/        # 通知機能
│   ├── stream-notifications.ts
│   ├── clip-recast-notifier.ts
│   └── discord-webhook.ts
└── utils/                # ユーティリティ
    ├── logger.ts
    ├── env-store.ts
    ├── restart-state-store.ts
    ├── comment-state-store.ts
    └── process-restart.ts
```

## 更新履歴
- **2026-06-06**: サブPC本番ログで配信開始通知が `Discord bot message failed: 403` により停止していたことを確認。`DISCORD_WEBHOOK_URL` が設定済みだったため、配信開始通知・配信終了まとめ・配信中クリップ投稿でBot API失敗時にWebhookへフォールバックするよう修正
- **2026-06-02**: 配信終了まとめを追加。配信中状態をJSONに保持し、再起動後も未投稿まとめを復元してDiscordへ再試行。クリップはまとめメッセージのDiscordスレッドへ投稿可能
- **2026-06-02**: フォーラム/メディアチャンネルWebhook向けに、Bot Tokenなしで `thread_name` から配信まとめスレッドを作るWebhook-onlyモードを追加
- **2026-06-03**: Bot Token方式を配信開始通知スレッド化へ変更。配信開始通知から作成したスレッドへ、配信終了まとめとクリップを投稿
- **2026-06-03**: 再起動時に同一タイトルで開始通知がスキップされても、配信まとめstateにスレッドIDがなければ開始通知メッセージからスレッド作成を補完するよう修正
- **2026-06-03**: Discordへ投稿する配信開始通知と配信終了まとめから、配信URL行を削除
- **2026-06-03**: 配信中の新規クリップを1分ごとの直近同期で検知して配信まとめスレッドへ随時投稿し、配信終了まとめ後にスレッドをアーカイブして閉じるよう変更
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
- **2026-05-25**: 初コメ保存と `!firstcomment` を削除。`!clip` / `!myclip` を高速ページング最大1000件へ変更
- **2026-05-25**: `!clip` / `!myclip` を日付窓ページング取得へ変更し、表示履歴で重複をなるべく回避
- **2026-05-25**: ユーザー別初コメを SQLite に保存し、`!firstcomment` 本人表示を追加。過去アーカイブ抽出は無効化
- **2026-05-11**: `!shoutout <ユーザー名>` デバッグコマンドと権限設定 `SHOUTOUT_ADMIN_USERS` を追加
- **2026-05-11**: shoutout修正を `main` に反映。Git更新後の build と再起動クールダウン時の注意を追記
- **2026-05-11**: レイド自動シャウトアウトを Bot/Moderator ユーザーコンテキストで実行するよう修正
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
