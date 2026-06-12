# TypeScript版アーキテクチャ概要

内部仕様書の正本は `internal-docs/twitchraid-bot-zukan.html` です。このMarkdownは運用時に素早く読むための補助資料です。

## プロジェクト概要

Twitchチャンネル `rukalun` 向けの常駐Botです。現行運用対象は TypeScript 版のみで、起動入口は `src/index.ts`、Bot本体は `src/bot.ts` です。Twitchチャット、配信状態、Clip、Raid、VODを監視し、Discord通知、配信まとめスレッド、チャットコマンド応答、自動更新を行います。

## 主要コンポーネント

| 領域 | ファイル | 責務 |
|---|---|---|
| 起動 | `src/index.ts` | 設定読み込み、Git監視、再起動監視、token検証、Bot起動、Graceful shutdown |
| Bot本体 | `src/bot.ts` | Twurple ChatClientイベント、コマンド分岐、配信監視、Raid処理、Clip投稿接続 |
| 設定 | `src/config.ts` | `.env` 読み込み、認証情報、管理者、DB/stateパス、Discord設定 |
| 認証 | `src/auth/*` | token validate/refresh、必須スコープ、不足スコープ判定、validateキャッシュ |
| コマンド | `src/commands/*` | `!clip`、`!myclip`、`!clipsearch`、`!manga`、`!boom`、`!shoutout`、`!streamnotify` など |
| GitHub Pages | `docs/clip-search.html` / `scripts/export-clip-search-data.mjs` | SQLite Clipキャッシュから公開用JSONを生成し、静的ページでClip検索を提供 |
| 配信まとめ | `src/streams/*` | state保存、コメント数/Raid数のデバウンス保存、開始通知スレッド保証、Clip投稿、終了まとめ、開始通知の自動再投稿防止 |
| 通知 | `src/notifications/*` | Discord Bot API/Webhook投稿、開始通知本文、スレッド作成 |
| 監視 | `src/git-manager.ts` / `src/system-watcher.ts` | Git更新検知、build、PM2再起動、24時間定期再起動 |

## 実行時フロー

```text
src/index.ts
  -> Configで.envを読む
  -> GitManager.pullAndRestartIfUpdated()
  -> SystemWatcherでGit更新/定期再起動を監視
  -> getValidAccessToken()でTwitch tokenを検証
  -> Bot.start()
      -> RefreshingAuthProvider / ApiClient / ChatClientを初期化
      -> ClipCacheSynchronizer.start()
      -> onMessage / onRaid / onDisconnectを登録
      -> keep-aliveと配信監視を開始
```

## 配信まとめアーキテクチャ

```text
配信開始検知
  -> data/stream-summary-state.json に active state保存
  -> Discordへ開始通知投稿
  -> 開始通知メッセージからスレッド作成
  -> startMessageId / threadId保存

配信中
  -> 1分ごとに既定6時間分の直近Clip同期
  -> 未投稿ClipをthreadIdへ投稿
  -> postedClipIds保存

配信終了
  -> 配信時間帯Clipを最終同期
  -> threadIdが無ければ保存済み開始通知からスレッド保証
  -> 未投稿Clipと終了まとめを投稿
  -> スレッドはアーカイブせず、開始通知から見える状態を保つ
```

## 重要な設計判断

- TypeScript版の内部仕様書は `internal-docs/twitchraid-bot-zukan.html` を正本にする。公開用 `docs/index.html` はClip検索入口だけにする。
- Discord投稿はBot API優先。403などで失敗し、Webhook URLがある場合はWebhookへフォールバックする。
- `!streamnotify` は新しい開始通知の `startMessageId` / `threadId` を既存stateより優先する。
- 自動スレッド保証処理は、保存済み `startMessageId` からのスレッド作成だけを行い、開始通知を再投稿しない。通知を再送する場合は `!streamnotify` で明示する。
- 新しい開始通知に `threadId` が無い場合、古い `threadId` は保持しない。
- 通常コメントによる配信まとめコメント数更新は30秒デバウンスし、Raid/停止/配信終了時は即時flushする。
- Raid shoutoutは `ShoutoutQueue` で直列化し、429時は2分後に同一対象を再実行する。
- ClipはSQLiteキャッシュ優先。直近Clip同期はTwitch側の反映遅延を吸収するため既定6時間分を1分ごとに取り直し、必要なら `TWITCH_CLIP_RECENT_WINDOW_MINUTES` で広げる。`!clipsearch` はタイトル/作成者表示名/ゲーム名をキャッシュ内で部分一致検索し、Twitch API全件検索へはフォールバックしない。削除/非公開化されたClipはオフライン時の日次再走査で `unavailable_at` を入れて候補から外す。直近同期でもDB既存Clipが一覧から消えた場合は `getClipsByIds` で個別確認し、返らないClipだけ無効化する。ただし作成から2時間以内のClipはTwitch API反映揺れとして直近同期の無効化対象から外し、すでに無効化されていた場合も有効へ戻す。同期時はClipサムネイルURL、ゲームID、ゲーム名も保存する。
- GitHub PagesのClip検索画面は静的配信のため、`data/clips.sqlite` へ直接アクセスしない。`scripts/export-clip-search-data.mjs` で `docs/clip-search-data.json` を生成し、公開項目はClip ID、URL、タイトル、作成者表示名、ゲーム名、サムネイルURL、作成日、再生数、`clipSync.recentSyncedAt` のみに限定する。必要時は `--enrich-from-twitch` でTwitch APIからサムネイルURLとゲーム名を補完する。画面上のClip最終同期時刻はJSTの秒単位で表示し、各カードはサムネイル/ゲーム名と `Twitchで見る` 外部リンクだけを表示する。
- `!clipsearch` のLIKE部分一致検索がClip件数増加で重くなった場合は、SQLite FTS5 または検索専用テーブルへの移行を検討する。初回は1件URL返却の単純検索に限定し、FTSは導入しない。
- `!boom` は過去30日間のVODを対象に、最大4本並列でGraphQLを取得し、結果を5分キャッシュする。
