# TypeScript版コマンド仕様

内部仕様書の正本は `internal-docs/twitchraid-bot-zukan.html` です。このMarkdownはチャットコマンド確認用の補助資料です。

## 基本コマンド

| コマンド | 機能 | 備考 |
|---|---|---|
| `!help` | 主要コマンド一覧を1通で表示 | 返信文頭に `!` を付けて読み上げ回避、権限不要、クールダウンなし |
| `!age` | 年齢を表示 | `src/commands/age.ts` |
| `!goods` | グッズ販売ページURLを表示 | `https://rukalun.booth.pm` |
| `!site` | Clip検索サイトURLを表示 | `https://www.rukalun.mydns.jp` |
| `!x` | XアカウントURLを表示 | `https://x.com/rukalunlol` |
| `!youtube` | YouTubeチャンネルURLを表示 | `https://is.gd/rukalunyt` |
| `!game` | ゲーム候補を表示 | Twitchに残っている過去アーカイブVODで配信したゲームからランダム。候補一覧は5分キャッシュ |
| `!weight` | ランダム体重を表示 | 15から200kg |
| `!height` | ランダム身長を表示 | 120から220cm |
| `!mood` | 今日の気分を表示 | ランダム |
| `!menu` | おすすめメニューを表示 | ランダム |
| `!chat <メッセージ>` | Bot宛てメンションなしでAI返信 | AIメンション会話と同じクールダウン、キュー、ローカル記憶メモ、外部検索、スタンプ付与を使用 |

## AIメンション会話メモ

- `CHAT_AI_MEMORY_ENABLED=true` の時だけ、ローカル記憶ストアをOllamaプロンプトへ参考メモとして渡す。
- 既定は `CHAT_AI_MEMORY_STORE=json` で、`CHAT_AI_MEMORY_PATH` のルート直下 `key: value` を共通semantic memoryとして扱い、`__meta` に `kind/status/sourceUser/createdAt/updatedAt` を持つ。`CHAT_AI_MEMORY_STORE=sqlite` では `CHAT_AI_MEMORY_DB_PATH` のSQLite DBを正本にし、JSONはDBが空の初回だけ移行元として読む。SQLite保存時にJSONバックアップは再生成しない。
- `status=inactive` は注入しない。全件を毎回入れず、質問文へのキー一致、語句一致、`updatedAt` の新しさ、DB/ファイル順で並べてから `CHAT_AI_MEMORY_MAX_ITEMS` / `CHAT_AI_MEMORY_MAX_CHARS` を適用する。
- `CHAT_AI_AUTO_LEARN_ENABLED=true` かつ発言者が `CHAT_AI_MEMORY_WRITER_USERS` に含まれる時だけ、`覚えて: key=value` などの明示依頼を保存する。未設定時のwriterは `rukalun`。`CHAT_AI_MEMORY_WRITER_USERS=all` は全ユーザー許可として扱う。
- `CHAT_AI_IMPLICIT_MEMORY_ENABLED=true` の時だけ、通常AI返信送信後に安全な短文事実・嗜好を `kind=implicit` として保存する。追加のOllama呼び出しや追加prompt生成は行わず、`CHAT_AI_AUTO_LEARN_ENABLED` と `CHAT_AI_MEMORY_WRITER_USERS` を同じgateにする。
- 記憶保存リクエストはOllamaへ送らず、保存成功/形式不正/安全拒否/権限拒否/無効を固定返信で返す。固定返信は通常AI会話のクールダウンを消費しない。
- `!chat 覚えて: ...` のコマンド検出ログは `[memory-request]` に伏せる。
- URL、メール、電話番号、token/API key/password系、本名/住所/誕生日などの個人情報キー、予約キー `global/users/__meta`、プロンプト注入文は保存しない。手動編集や旧形式に混入した危険メモも読み込み時に除外する。
- 管理用に `scripts/memory-web.mjs` を用意している。Windows側の `trmem-web` または `npm run memory:web` でメインPCローカル `http://127.0.0.1:3220/` に起動できる。サブPC常駐版はWebUI専用Docker serviceとして `http://192.168.0.99:3220/` に公開する。どちらもサブPC本番SQLiteメモを一覧/検索/Create/Update/Deleteでき、変更は `src/commands/mention-chat-memory.ts` の管理APIを通すため、安全フィルタを維持する。

## Clipコマンド

| コマンド | 機能 | クールダウン |
|---|---|---|
| `!clip` | 過去Clipをランダム表示 | 一般ユーザー30分、特別ユーザーなし |
| `!myclip` | 実行者が作成したClipをランダム表示 | `!clip` とは独立して30分 |
| `!clipsearch <キーワード>` | Clipタイトル/作成者表示名/ゲーム名から検索して1件表示 | なし |

- 特別ユーザーは `.env` の `CLIP_SPECIAL_USERS` で管理する。既定値は `nyme_ia,rukalun`。
- 通常は `data/clips.sqlite` のキャッシュから選ぶ。
- キャッシュ未準備時のみTwitch APIへフォールバックする。実運用のコマンド経路では最大200件、低レベル関数の既定値は最大1000件。実運用ではTwitch client id/access tokenを渡し、Helix clips APIを `Accept-Encoding: identity` 付きで直fetchする。`Premature close` などの一時通信エラーだけ再試行し、Twurple paginatorは認証情報がない場合の互換fallbackに限定する。
- 表示履歴は `clip_history` に保存し、`!clip` と `!myclip:<ユーザー>` ごとに重複を避ける。
- `!clipsearch` はSQLiteキャッシュのみを検索し、Twitch API全件検索へはフォールバックしない。
- `!clipsearch` の検索対象はClipタイトル、作成者表示名、ゲーム名。空白入り検索語を保持し、`%` / `_` は通常文字として扱う。
- `!clipsearch` がClip件数増加で遅くなった場合は、SQLite FTS5 または検索専用テーブルへの移行を検討する。
- `!clipsearch` の表示履歴は `clipsearch:<検索語>` ごとに保存する。
- 削除/非公開化でTwitch APIから返らなくなったClipは、日次再走査で `unavailable_at` を付けて候補から外す。直近同期でもDB既存Clipが一覧から消えた場合は `getClipsByIds` で確認し、返らないClipだけ無効化する。ただし作成から2時間以内のClipはTwitch API反映揺れとして直近同期の無効化対象から外し、すでに無効化されていた場合も有効へ戻す。

## GitHub Pages Clip検索

- Clip検索画面の正本は `RukalunPage/index.html`。twitchRaid側の `docs/` は旧URL互換リダイレクトだけを持つ。
- `RukalunPage/clip-search-data.json` を読み込み、ブラウザ内でClipタイトル/作成者表示名/ゲーム名を検索する。
- 公開データは `scripts/export-clip-search-data.mjs --out C:\Users\mlove\Documents\GitHub\RukalunPage\clip-search-data.json` で `data/clips.sqlite` から生成する。必要時は `--enrich-from-twitch` でTwitch APIからサムネイルURLとゲーム名を補完する。
- Bot自動公開では `CLIP_SEARCH_PUBLISH_REPO_DIR` をRukalunPage repoに向け、差分があればRukalunPageの `main` へcommit/pushする。
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
