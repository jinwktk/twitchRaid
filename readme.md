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

## 技術スタック
- **ランタイム**: Node.js 20+
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
| `!speed` | コメント風速を表示（直近60秒＋配信全体平均） | コマンドは計測対象外 |
| `!commentcount` | 配信開始からの累計コメント件数を表示 | 再起動後も引き継ぎ |

## .env保護
- `.env` の更新は `env-store.ts` で実行し、更新前に `.env.backup` を作成
- `.env.backup` と `.env.tmp` はバックアップ/一時ファイルのため Git 管理外

## 再起動ポリシー
- 定期再起動は 1 日 1 回
- GitHub 更新による再起動もクールダウン対象
- PM2管理下では `process.exit(0)` でPM2が自動再起動

## 配信通知仕様
- 配信開始検知時に Discord Webhook へ通知
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ

## Clipコマンドメモ
- `.env` の `CLIP_SPECIAL_USERS` (初期値: `nyme_ia,rukalun`) に含まれるユーザーはクールダウン無しで実行可能
- 一般ユーザーは 30 分のクールダウンが適用
- クールダウン終了時に Bot がチャットへ「リキャスト復帰」コメントを自動送信
- `!myclip` は `!clip` とは独立したクールダウン管理

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
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
