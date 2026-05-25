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
- `TWITCH_FIRST_COMMENT_DB_PATH` に初コメ保存用 SQLite DB のパスを設定できます（未設定時は `data/first_comments.sqlite`）
- `TWITCH_GQL_CLIENT_ID` で VOD コメント取得用 GraphQL Client-ID を上書きできます。未設定時は Twitch Web の既知 Client-ID を使用します
- `FIRST_COMMENT_BACKFILL_CONCURRENCY` で起動時アーカイブ初コメ取得の並列数を設定できます（未設定時は `8`）
- `FIRST_COMMENT_FORCE_FULL_RESCAN` が `true` / `1` の場合、取得済みVODも含めて全アーカイブを再走査します。成功後は自動で `false` に戻します（未設定時は次回起動で1回だけ全走査）

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
| `!firstcomment` | 自分の初コメ日時・内容を表示 | 他ユーザー指定は不可 |

## .env保護
- `.env` の更新は `env-store.ts` で実行し、更新前に `.env.backup` を作成
- `.env.backup` と `.env.tmp` はバックアップ/一時ファイルのため Git 管理外

## 再起動ポリシー
- 定期再起動は 1 日 1 回
- GitHub 更新による再起動もクールダウン対象
- PM2管理下では `process.exit(0)` でPM2が自動再起動
- TypeScript版は `dist/` を Git 管理しないため、GitHub更新検知後に自動で `npm run build` を実行
- 再起動クールダウン中は pull/build 後も実行中プロセスは旧コードのまま。緊急修正を即時反映する場合は `npm run pm2:restart` を実行

## 配信通知仕様
- 配信開始検知時に Discord Webhook へ通知
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ

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

## 初コメ保存
- 今後の配信は通常コメント受信時に、ユーザーごとの最古コメントだけを `user_first_comments` テーブルへ保存
- アーカイブ分はBot起動時に1回だけ自動バックフィルを開始し、Helix の archived videos 一覧から各VODの全コメントを GraphQL `VideoCommentsByOffsetOrCursor` でページング取得する
- 起動時バックフィルは `FIRST_COMMENT_BACKFILL_CONCURRENCY` の並列数でVOD単位に処理し、処理済みVODは `archive_comment_backfill_status` でスキップする
- `FIRST_COMMENT_FORCE_FULL_RESCAN` が有効な起動では、処理済みスキップを無視して全VODを再走査し、完了後にフラグをOFFへ戻す
- コメントなしVODも処理済みとして記録し、次回起動時に再取得しない
- GraphQL による VOD コメント取得は Twitch 公式 Helix API ではなく、Qiita 記事で紹介されている非公式寄りの方式のため、Twitch 側の仕様変更で失敗する可能性あり
- ライブ保存分とアーカイブ保存分はユーザー名で統合し、アーカイブが後から古いコメントを見つけた場合は最古コメントへ更新する
- 旧仕様で保存した「配信ごとの先頭コメント」は起動時に `first_comments` テーブルから削除し、新しいユーザー別初コメには混ぜない
- SQLite DB は `data/first_comments.sqlite` が既定値で、ローカル状態のため Git 管理外

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
│   ├── clip.ts
│   ├── manga.ts
│   ├── shoutout.ts
│   └── random-commands.ts
├── first-comment/         # 初コメ保存・VODバックフィル
│   ├── first-comment-store.ts
│   ├── first-comment-backfill.ts
│   ├── first-comment-format.ts
│   └── vod-comments-client.ts
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
- **2026-05-25**: ユーザー別初コメを SQLite に保存し、起動時の並列アーカイブ自動取得と `!firstcomment` 本人表示を追加
- **2026-05-11**: `!shoutout <ユーザー名>` デバッグコマンドと権限設定 `SHOUTOUT_ADMIN_USERS` を追加
- **2026-05-11**: shoutout修正を `main` に反映。Git更新後の build と再起動クールダウン時の注意を追記
- **2026-05-11**: レイド自動シャウトアウトを Bot/Moderator ユーザーコンテキストで実行するよう修正
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
