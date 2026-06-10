# TypeScript版コマンド仕様

正本の仕様書は `docs/index.html` です。このMarkdownはチャットコマンド確認用の補助資料です。

## 基本コマンド

| コマンド | 機能 | 備考 |
|---|---|---|
| `!age` | 年齢を表示 | `src/commands/age.ts` |
| `!goods` | グッズ販売ページURLを表示 | `https://rukalun.booth.pm` |
| `!weight` | ランダム体重を表示 | 15から200kg |
| `!height` | ランダム身長を表示 | 120から220cm |
| `!mood` | 今日の気分を表示 | ランダム |
| `!menu` | おすすめメニューを表示 | ランダム |

## Clipコマンド

| コマンド | 機能 | クールダウン |
|---|---|---|
| `!clip` | 過去Clipをランダム表示 | 一般ユーザー30分、特別ユーザーなし |
| `!myclip` | 実行者が作成したClipをランダム表示 | `!clip` とは独立して30分 |
| `!clipsearch <キーワード>` | Clipタイトル/作成者表示名から検索して1件表示 | なし |

- 特別ユーザーは `.env` の `CLIP_SPECIAL_USERS` で管理する。既定値は `nyme_ia,rukalun`。
- 通常は `data/clips.sqlite` のキャッシュから選ぶ。
- キャッシュ未準備時のみTwitch APIへフォールバックする。実運用のコマンド経路では最大200件、低レベル関数の既定値は最大1000件。
- 表示履歴は `clip_history` に保存し、`!clip` と `!myclip:<ユーザー>` ごとに重複を避ける。
- `!clipsearch` はSQLiteキャッシュのみを検索し、Twitch API全件検索へはフォールバックしない。
- `!clipsearch` の検索対象はClipタイトルと作成者表示名。空白入り検索語を保持し、`%` / `_` は通常文字として扱う。
- `!clipsearch` がClip件数増加で遅くなった場合は、SQLite FTS5 または検索専用テーブルへの移行を検討する。
- `!clipsearch` の表示履歴は `clipsearch:<検索語>` ごとに保存する。
- 削除/非公開化でTwitch APIから返らなくなったClipは、日次再走査で `unavailable_at` を付けて候補から外す。

## mangaコマンド

| コマンド | 機能 | 権限 |
|---|---|---|
| `!manga` | DLsiteがるまに日間ランキングからランダム1作品を表示 | `MANGA_COMMAND_ENABLED=true` の時のみ |
| `!mangaon` | `!manga` をONにする | broadcaster / mod / `MANGA_ADMIN_USERS` |
| `!mangaoff` | `!manga` をOFFにする | broadcaster / mod / `MANGA_ADMIN_USERS` |

- `!manga` の返信はBot APIで送信できた場合、10秒後にTwitch chat message delete APIで削除する。
- Bot API送信に失敗した場合は `chatClient.say` へフォールバックする。

## 統計コマンド

| コマンド | 機能 | 備考 |
|---|---|---|
| `!speed` | 直近60秒のコメント風速と配信全体平均を表示 | コマンドは計測対象外 |
| `!commentcount` | 配信開始からの累計コメント件数を表示 | 再起動後も復元 |
| `!boom` | 過去30日間のゲーム別配信時間と総配信時間を表示 | 1時間以上のゲームを最大6件 |

- `!boom` はTwitch VODチャプターをGraphQLで取得する。
- VOD単位の取得は最大4本並列。
- 結果は5分間メモリキャッシュする。
- 長文読み上げを避けるため、返却文頭に `!` を付ける。

## 管理・復旧コマンド

| コマンド | 機能 | 権限 |
|---|---|---|
| `!shoutout <ユーザー名>` | 指定ユーザーへ手動shoutout | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` |
| `!streamnotify` | 現在の配信開始通知をDiscordへ強制送信 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` |

- `!streamnotify` は `LAST_STREAM_TITLE` の重複スキップを通さない。
- 手動通知で得た `startMessageId` / `threadId` は既存の配信まとめstateより優先する。
- `!shoutout` とRaid自動shoutoutはBot/Moderatorユーザーコンテキストで実行する。
- Raid自動shoutoutはキューで直列化し、429時は同じ対象をキュー先頭へ戻して2分後に再実行する。

## Raid時の自動チャット

Raid検知時は `src/commands/raid-info.ts` でRaid元の配信URL、タイトル、ゲーム名を取得し、次の形式でチャットへ投稿する。

```text
レイドありがとうD！！ @ユーザー さんは、「ゲーム名」で「配信タイトル」をしてたD！お疲れ様D！チャンネルはこD→URL
```

配信情報が取得できない場合でも、チャンネルURL付きのフォールバック文を送信する。
