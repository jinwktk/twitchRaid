# TypeScript版 技術スタック・運用環境

内部仕様書の正本は `internal-docs/twitchraid-bot-zukan.html` です。このMarkdownは依存関係と運用確認用の補助資料です。

## 使用技術

| 分類 | 技術 | 用途 |
|---|---|---|
| Runtime | Node.js 22.5+ | `node:sqlite` を使うため必須 |
| Language | TypeScript 5.7 | Bot本体 |
| Twitch | `@twurple/api` / `@twurple/auth` / `@twurple/chat` / `@twurple/eventsub-ws` | ChatClient、Helix API、RefreshingAuthProvider、Botトークンadapter付き配信開始・終了EventSub |
| 永続化 | `node:sqlite` | Clipキャッシュ、表示履歴、同期状態 |
| 設定 | `dotenv` | `.env` 読み込み |
| ログ | `winston` / `winston-daily-rotate-file` | 日次ローテーションログ |
| テスト | Vitest / pytest | TS版テストと旧Python互換テスト |
| プロセス | PM2 | サブPC本番常駐 |
| 公開ページ | GitHub Pages | `RukalunPage/index.html` を公開。twitchRaidの `docs/` は旧URL互換リダイレクト |

## 運用環境

| 環境 | パス | 備考 |
|---|---|---|
| 本番 | `E:\GitHub\twitchRaid` | サブPC。PM2プロセス名は `twitchRaid` |
| 開発 | `C:\Users\mlove\Documents\GitHub\twitchRaid` | メイン作業PC |
| 公開ページ | `C:\Users\mlove\Documents\GitHub\RukalunPage` | Clip検索用GitHub Pagesリポジトリ |

## 主なコマンド

```bash
npm install
npm run build
npm test
npm run lint
python -m pytest -q
```

PM2操作は次を使う。

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
```

## .env設定

| キー | 用途 |
|---|---|
| `TWITCH_CLIENT_ID` / `TWITCH_SECRET_TOKEN` | Twitch OAuth |
| `TWITCH_ACCESS_TOKEN` / `TWITCH_REFRESH_TOKEN` | Bot用token。refresh時に自動更新 |
| `TWITCH_BROADCASTER_ID` / `TWITCH_MODERATOR_ID` | broadcaster / moderator ID |
| `TWITCH_GQL_CLIENT_ID` | `!boom` 用GraphQL Client-ID。未設定時は公開Client-ID |
| `DISCORD_WEBHOOK_URL` | Bot API失敗時やWebhook-only運用のフォールバック |
| `DISCORD_BOT_TOKEN` / `DISCORD_SUMMARY_CHANNEL_ID` | Discord Bot API投稿と開始通知起点スレッド作成 |
| `DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED` | フォーラム/メディアチャンネルWebhookで `thread_name` を使う |
| `STREAM_SUMMARY_STATE_PATH` | 配信まとめstate JSON。未設定時は `data/stream-summary-state.json` |
| `STREAM_SUMMARY_MAX_CLIPS` | 配信まとめスレッドへ投稿する最大Clip数。既定値10 |
| `TWITCH_CLIP_CACHE_DB_PATH` | Clip SQLite DB。未設定時は `data/clips.sqlite` |
| `TWITCH_CLIP_RECENT_WINDOW_MINUTES` | 直近Clip同期の取得窓。未設定時は360分 |
| `CLIP_SEARCH_AUTO_PUBLISH_ENABLED` | Clip検索JSONの自動公開を有効化 |
| `CLIP_SEARCH_DATA_PATH` | 公開JSON出力先。RukalunPage分離後は `RukalunPage\clip-search-data.json` |
| `CLIP_SEARCH_PUBLISH_REPO_DIR` | 公開JSONのgit add/commit/pushを行うrepo。RukalunPage分離後は `RukalunPage` |
| `CLIP_SPECIAL_USERS` | `!clip` / `!myclip` クールダウン免除ユーザー |
| `MANGA_COMMAND_ENABLED` / `MANGA_ADMIN_USERS` | mangaコマンドON/OFFと管理者 |
| `SHOUTOUT_ADMIN_USERS` | `!shoutout` / `!streamnotify` の追加管理者 |

## ログ確認

- PM2ログ: `npm run pm2:logs`
- Botログ: `logs/bot_YYYY-MM-DD.log`
- PM2個別ログ: `logs/pm2-out.log` / `logs/pm2-error.log`
- Clip調査: `data/clips.sqlite` の有無、更新時刻、`clip_cache` 件数、`unavailable_at`
- 配信まとめ調査: `data/stream-summary-state.json` の `status`、`startMessageId`、`threadId`、`postedClipIds`

## 性能上の注意

- Clip同期は起動時に直近同期と全期間バックフィルを始める。
- 全期間バックフィルは2016年5月から30日窓で走り、過密窓は再分割する。
- 直近Clip同期は1分ごとに既定6時間分を取り直し、日次再走査はオフライン時だけ24時間に1回。
- `node:sqlite` は同期APIなので、DB件数が増えた場合は `COUNT + OFFSET` のランダム取得時間を監視する。
- 配信まとめstateのコメント数保存は30秒デバウンス。Raid、停止、配信終了では即時flushしてまとめ数の取りこぼしを防ぐ。
- `!boom` は初回だけGraphQL取得が重い。最大4本並列と5分キャッシュで抑制している。
- Git更新処理は `execSync` で `git fetch/pull` と `npm run build` を実行するため、配信中に走るとイベントループを一時的に塞ぐ可能性がある。
