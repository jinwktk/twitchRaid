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
- `TWITCH_CLIP_HISTORY_PATH` に `!clip` / `!myclip` の表示履歴 JSON パスを設定できます（未設定時は `data/clip_history.json`）

## 技術スタック
- **ランタイム**: Node.js 22.5+
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
- クリップ候補は Twurple のページング取得で最大1000件まで走査し、旧実装の上位100件固定より広く見る
- コマンド応答速度を優先し、全期間の日付窓分割走査はチャットコマンド実行時には行わない
- 直近に表示したクリップIDは `data/clip_history.json` に保存し、`!clip` 全体と `!myclip:<ユーザー>` ごとに重複を避ける。全候補を出し切った場合のみ履歴内のクリップも再候補に戻す

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
│   ├── clip-history.ts
│   ├── manga.ts
│   ├── shoutout.ts
│   └── random-commands.ts
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
- **2026-05-25**: 初コメ保存と `!firstcomment` を削除。`!clip` / `!myclip` を高速ページング最大1000件へ変更
- **2026-05-25**: `!clip` / `!myclip` を日付窓ページング取得へ変更し、表示履歴で重複をなるべく回避
- **2026-05-25**: ユーザー別初コメを SQLite に保存し、`!firstcomment` 本人表示を追加。過去アーカイブ抽出は無効化
- **2026-05-11**: `!shoutout <ユーザー名>` デバッグコマンドと権限設定 `SHOUTOUT_ADMIN_USERS` を追加
- **2026-05-11**: shoutout修正を `main` に反映。Git更新後の build と再起動クールダウン時の注意を追記
- **2026-05-11**: レイド自動シャウトアウトを Bot/Moderator ユーザーコンテキストで実行するよう修正
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
