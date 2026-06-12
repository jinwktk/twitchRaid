# TypeScript版コマンド仕様

内部仕様書の正本は `internal-docs/twitchraid-bot-zukan.html` です。このMarkdownはチャットコマンド確認用の補助資料です。

## 基本コマンド

| コマンド | 機能 | 備考 |
|---|---|---|
| `!help` | 主要コマンド一覧を1通で表示 | 返信文頭に `!` を付けて読み上げ回避、権限不要、クールダウンなし |
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
| `!clipsearch <キーワード>` | Clipタイトル/作成者表示名/ゲーム名から検索して1件表示 | なし |

- 特別ユーザーは `.env` の `CLIP_SPECIAL_USERS` で管理する。既定値は `nyme_ia,rukalun`。
- 通常は `data/clips.sqlite` のキャッシュから選ぶ。
- キャッシュ未準備時のみTwitch APIへフォールバックする。実運用のコマンド経路では最大200件、低レベル関数の既定値は最大1000件。
- 表示履歴は `clip_history` に保存し、`!clip` と `!myclip:<ユーザー>` ごとに重複を避ける。
- `!clipsearch` はSQLiteキャッシュのみを検索し、Twitch API全件検索へはフォールバックしない。
- `!clipsearch` の検索対象はClipタイトル、作成者表示名、ゲーム名。空白入り検索語を保持し、`%` / `_` は通常文字として扱う。
- `!clipsearch` がClip件数増加で遅くなった場合は、SQLite FTS5 または検索専用テーブルへの移行を検討する。
- `!clipsearch` の表示履歴は `clipsearch:<検索語>` ごとに保存する。
- 削除/非公開化でTwitch APIから返らなくなったClipは、日次再走査で `unavailable_at` を付けて候補から外す。直近同期でもDB既存Clipが一覧から消えた場合は `getClipsByIds` で確認し、返らないClipだけ無効化する。ただし作成から2時間以内のClipはTwitch API反映揺れとして直近同期の無効化対象から外し、すでに無効化されていた場合も有効へ戻す。

## GitHub Pages Clip検索

- `docs/clip-search.html` はチャットコマンドではなく、GitHub Pages用の検索画面。
- `docs/clip-search-data.json` を読み込み、ブラウザ内でClipタイトル/作成者表示名/ゲーム名を検索する。
- 公開データは `npm run docs:export-clips` で `data/clips.sqlite` から生成する。必要時は `--enrich-from-twitch` でTwitch APIからサムネイルURLとゲーム名を補完する。
- 公開項目はClip ID、URL、タイトル、作成者表示名、ゲーム名、サムネイルURL、作成日、再生数、Clip最終同期時刻のみ。削除/非公開化されたClipは除外する。
- Clip最終同期時刻は `clip_sync_state.recent_sync_at` を元に、画面上でJSTの秒単位まで表示する。
- 各Clipカードにはサムネイルとゲーム名を表示し、再生は `Twitchで見る` の外部リンクだけにする。ページ内Twitch iframe再生は置かない。

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
