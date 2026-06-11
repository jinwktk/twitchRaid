# TypeScript版 設計パターン

内部仕様書の正本は `internal-docs/twitchraid-bot-zukan.html` です。このMarkdownは実装方針を短く確認するための補助資料です。

## 設計原則

### 1. 入出力を薄くし、ロジックをテストしやすくする

外部APIを直接呼ぶ箇所と、判定・整形ロジックを分けています。

| ロジック | I/O |
|---|---|
| `formatRaidSourceInfoMessage()` | Twitch streams API |
| `formatBoomSummary()` / `parseGameChapters()` | Twitch GraphQL |
| `mergeStreamStartThreadResult()` | Discord Bot API / Webhook |
| `isShoutoutAdmin()` / `normalizeShoutoutTarget()` | Twurple shoutout API |

### 2. 永続化して再起動に強くする

- 配信まとめstateは `data/stream-summary-state.json` に保存する。
- 通常コメントによる配信まとめコメント数更新は `StreamSummaryCountBuffer` で30秒デバウンスし、Raid/停止/配信終了時だけ即時flushする。
- Clipキャッシュ、表示履歴、走査窓、同期状態は `data/clips.sqlite` に保存する。
- コメント数やコマンドクールダウンなどの互換状態は `.env` に保存する。
- `.env` 更新は `src/utils/env-store.ts` でバックアップ付きにする。

### 3. 外部API失敗時の逃げ道を持つ

- Discord Bot API失敗時はWebhookへフォールバックする。
- 開始通知スレッドが無い場合は、保存済み開始通知IDから再作成する。
- Raid元配信情報が取れない場合も、チャンネルURL付きメッセージを送る。
- Shoutout 429は即時再試行せず、2分待って再実行する。
- Twitch APIから消えたClipは日次再走査で候補から外す。

## 状態マージパターン

`!streamnotify` で新しい開始通知を送った場合、その通知から作ったスレッドを以後の集約先にします。

```text
通常通知:
  started.startMessageId が同じなら既存 threadId を保持
  started.startMessageId が新しいなら threadId も started.threadId に置換

手動通知:
  preferStartedThread=true
  新しい startMessageId / threadId を既存stateより優先
```

新しい開始通知に `threadId` が無い時は古い `threadId` を消します。これは別配信の古いスレッドへClipを投稿してしまう事故を避けるためです。

## Clipキャッシュパターン

```text
起動時
  -> 直近60分を同期
  -> 全期間バックフィルをバックグラウンド実行

配信中
  -> 1分ごとに直近60分を同期
  -> 新規Clipがあれば配信まとめスレッドへ投稿

オフライン時
  -> 24時間に1回だけ全期間再走査
  -> Twitch APIから返らないClipを unavailable_at 付きで無効化
```

## Queueパターン

Raid自動shoutoutは `ShoutoutQueue` で直列化します。

- enqueue直後、処理中でなければすぐ1件送る。
- 成功または対象なしなら次の対象へ進む。
- 429なら同じ対象をキュー先頭へ戻し、2分後に再実行する。
- 429以外の失敗は再試行せずログへ残す。

## テストパターン

- TypeScriptは Vitest を使う。
- 外部APIはテスト内のfake clientや関数差し替えで代替する。
- SQLiteは一時DBを使い、走査窓、履歴、無効化状態を検証する。
- Discord投稿は `sendWebhook` / `sendBotMessage` / `createThread` を差し替えて、Bot API失敗時のWebhook fallbackを検証する。
- Python版は現行運用対象ではないが、旧互換モジュールの破損検知として `python -m pytest -q` を通す。

## コード規約

- TypeScriptは `npm run lint` と `npm run build` を通す。
- 非同期処理は外部API失敗をログ化し、Bot全体を止めない。
- 共有stateを進める処理は、投稿成功後に `persistProgress` でこまめに保存する。
- 仕様変更時は `internal-docs/twitchraid-bot-zukan.html`、README、AGENTSを更新する。公開ページ変更時は `docs/clip-search.html` / `docs/index.html` も確認する。
