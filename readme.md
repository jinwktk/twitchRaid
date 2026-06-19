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
- PM2プロセス名は本番運用に合わせて `twitchRaid` に統一しています

### ログ確認運用
- BotはサブPCで動かす運用のため、問題確認時はローカル作業PCのログだけでなく、必ずサブPC側のPM2ログと `logs/bot_YYYY-MM-DD.log` を確認する
- SQLiteキャッシュ系の調査では、サブPC側の `data/clips.sqlite` の作成状況と更新時刻も確認する

### 技術設計書
- GitHub Pagesで公開するClip検索画面の正本は別リポジトリ `C:\Users\mlove\Documents\GitHub\RukalunPage` の `index.html` です
- 現行TypeScript版 Twitch Bot の内部仕様書は `internal-docs/twitchraid-bot-zukan.html` に移動しています
- Clip検索画面は `RukalunPage/clip-search-data.json` を読み込み、GitHub Pages上でタイトル/作成者名/ゲーム名検索できます。OGP/Twitter Card/JSON-LD、`RukalunPage/assets/rukalun/clip-search-og.png`、`RukalunPage/assets/rukalun` 配下のfavicon画像を使い、検索エンジンとSNS共有向けの公開情報を持たせています
- Clip検索画面は公開URLで使うため、画面上には仕様書、内部運用、JSON生成手順への導線を出しません
- twitchRaid側の `docs/index.html` / `docs/clip-search.html` / `docs/typescript-bot-spec.html` は `https://jinwktk.github.io/RukalunPage/` へ案内するだけの旧URL互換ページです
- RukalunPageの `main` ブランチ更新時にRukalunPage側の `.github/workflows/pages.yml` がGitHub Pagesへ公開します
- Markdown設計資料は `internal-docs/ARCHITECTURE.md` / `internal-docs/COMMANDS.md` / `internal-docs/DESIGN_PATTERNS.md` / `internal-docs/TECH_STACK.md` に補助資料として残しています

### 直接起動
```bash
npm start           # ビルド済みを実行
npm run dev         # ts-nodeで開発実行
npm run docs:export-clips # data/clips.sqlite から公開Clip検索JSONを生成
# 本番反映例: node scripts/export-clip-search-data.mjs --out C:\Users\mlove\Documents\GitHub\RukalunPage\clip-search-data.json
# 必要時: node scripts/export-clip-search-data.mjs --enrich-from-twitch
```

### 環境設定
- `.env` に Twitch/Discord 認証情報と `LAST_STREAM_TITLE` を設定
- Twitch認証は Bot 動作に必要な最小スコープのみ要求（`chat` / `shoutout` / `chat message delete` 系）。Botが使えるTwitchスタンプ一覧を取得する再認可では追加で `user:read:emotes` を要求します
- トークン検証時は 401 Unauthorized の場合のみ再取得を実行します
- 起動時の有効トークン検証と再取得成功時に、付与済みスコープ一覧を `[ECHO]` ログとして出力します
- `user:read:emotes` を含む更新可能なユーザートークン取得にはTwitch OAuth Authorization Code Grantが必要で、`.env` の `TWITCH_CLIENT_ID` と正しい `TWITCH_SECRET_TOKEN` が必要です。`invalid client secret` が出る場合はTwitch Developer ConsoleでClient Secretを再発行し、`.env` へ反映してから再認可してください
- `SHOUTOUT_ADMIN_USERS` に `!shoutout` を実行できる追加ユーザーをカンマ区切りで設定できます（未設定時は `rukalun`）
- `MANGA_ADMIN_USERS` に `!mangaon` / `!mangaoff` を実行できる追加ユーザーをカンマ区切りで設定できます。にめいやアカウントは表示名ではなくTwitchログイン名 `nyme_ia` で登録します
- `TWITCH_CLIP_CACHE_DB_PATH` に `!clip` / `!myclip` / `!clipsearch` のクリップキャッシュ SQLite DB パスを設定できます（未設定時は `data/clips.sqlite`）
- `TWITCH_CLIP_RECENT_WINDOW_MINUTES` に直近Clip同期で毎分取り直す時間幅を分単位で設定できます（未設定時は `360` = 6時間）。Twitch側のClip一覧API反映が遅い場合は `720` や `1440` へ広げられます
- `TWITCH_GQL_CLIENT_ID` に Twitch GraphQL 用 Client-ID を任意設定できます（未設定時はTwitch Webの公開Client-IDを使用し、指定値が拒否された場合も公開Client-IDへフォールバック）
- `STREAM_SUMMARY_STATE_PATH` に配信まとめの再起動復元用JSONパスを設定できます（未設定時は `data/stream-summary-state.json`）
- `STREAM_SUMMARY_MAX_CLIPS` に配信まとめスレッドへ投稿する最大クリップ数を設定できます（未設定時は `10`）
- `CHAT_RECOMMENDATION_ENABLED=false` で配信中の定期おすすめコメントを停止できます（未設定時は有効）。`CHAT_RECOMMENDATION_INTERVAL_MINUTES` で投稿間隔を分単位で変更できます（未設定時は `60`）
- `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` を設定すると、Bot APIで配信開始通知、クリップURL、終了まとめを投稿し、配信開始通知メッセージからDiscordスレッドを作成します。終了まとめとクリップは既存スレッドがある場合だけ投稿し、Bot API投稿が403などで失敗した場合の `DISCORD_WEBHOOK_URL` フォールバックも `thread_id` 付きで同じスレッドへ送ります。スレッドが無い場合は通常Webhookへ外出しせず、pending stateのまま再試行待ちにします
- `DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定すると、Webhookだけで `thread_name` によるスレッド作成を試します。この方式はDiscordのフォーラム/メディアチャンネルWebhook向けです。通常テキストチャンネルWebhookではDiscord側で拒否されるため、自動で通常Webhook投稿へフォールバックします
- `CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true` を設定すると、直近Clip同期完了後に公開JSONを再生成し、差分があれば `CLIP_SEARCH_PUBLISH_REPO_DIR` の `main` へcommit/pushします。RukalunPage分離後の既定値は `C:\Users\mlove\Documents\GitHub\RukalunPage` と、その配下の `clip-search-data.json` です。別パスで運用する場合だけ `CLIP_SEARCH_PUBLISH_REPO_DIR` と `CLIP_SEARCH_DATA_PATH` を指定します。公開前には公開repoで `git fetch <remote> <branch>` を行い、`git cherry -v <remote>/<branch> HEAD` でローカルだけのcommitを判定します。公開JSONだけを変更するBotの `Clip検索JSONを同期時刻更新` またはremote側に同等patchがある `-` commitだけなら `<remote>/<branch>` へ戻してから再生成します。ローカル未コミット変更や、`+` の非Bot開発commitがある場合は破壊せず自動公開をスキップし、ログに `protectedCommits` と `dropEligibleCommits` を出します。pushはcheckout branch名に依存しないよう `HEAD:<branch>` へ行います。新規/復活Clipが0件の同期も `CLIP_SEARCH_PUBLISH_MIN_INTERVAL_MS` ごとに公開し、新規/復活Clipまたは削除/非公開Clipの無効化があった場合は間隔内でも公開します。保存0件かつ無効化0件で直前HEADが `Clip検索JSONを同期時刻更新` の場合だけ、そのBot同期commitをamendして `--force-with-lease` でpushします。直前HEADがCodexなどの開発commitの場合や、Clip追加・復活・削除/非公開化がある同期では通常commit/pushします。未設定時の公開間隔は5分、remote/branchは `origin` / `main` です。Bot再起動時は既存JSONの `generatedAt` を読んで公開間隔を引き継ぎます
- サブPC運用では `E:\GitHub\RukalunPage` を `https://github.com/jinwktk/RukalunPage.git` のcloneとして用意してください。既存フォルダに `clip-search-data.json` だけがあり `.git` が無い場合、同期後処理で `fatal: not a git repository` になります
- `OLLAMA_SHOUTOUT_ENABLED=true` と `OLLAMA_SHOUTOUT_MODEL` を設定すると、Raid時にOllama `POST /api/generate` で1通のRaid挨拶文を生成してチャットへ送信します。AI生成文はコード側で250文字以内に丸めます。`OLLAMA_BASE_URL` は未設定時 `http://127.0.0.1:11434`、`OLLAMA_SHOUTOUT_TIMEOUT_MS` は未設定時 `15000`、`OLLAMA_SHOUTOUT_KEEP_ALIVE` は未設定時 `30m` です
- `CHAT_AI_ENABLED=true` と `CHAT_AI_MODEL`（未設定時は `OLLAMA_MODEL`、さらに `OLLAMA_SHOUTOUT_MODEL`）を設定すると、通常チャットで `@にめいやボットくん` や `@nyme_ia2` のようにBotへメンションされた時だけOllamaで短い返信を生成します。`CHAT_AI_ENABLED` 未設定時は `OLLAMA_SHOUTOUT_ENABLED=true` かつ継承できるモデルがある場合だけ互換的に有効として扱い、明示的な `CHAT_AI_ENABLED=false` または `0` は常に無効化を優先します。`CHAT_AI_BASE_URL` は未設定時 `OLLAMA_BASE_URL` または `http://127.0.0.1:11434`、`CHAT_AI_TIMEOUT_MS` は未設定時 `8000`、`CHAT_AI_KEEP_ALIVE` は `30m`、`CHAT_AI_MAX_RESPONSE_CHARS` は `200`、`CHAT_AI_COOLDOWN_SECONDS` は `5` です。`CHAT_AI_BOT_ALIASES` と `CHAT_AI_IGNORED_USERS` はカンマ区切りで、未設定時は `CHAT_AI_BOT_ALIASES=にめいやボットくん,nyme_ia2`、`CHAT_AI_IGNORED_USERS=nyme_ia2` を使います。`CHAT_AI_STREAM_IMAGE_ENABLED=true` を設定していても、配信画面・今していること・ゲーム名・試合状況など画面質問の時だけTwitchライブプレビュー画像を取得し、画像取得時だけ `CHAT_AI_VISION_MODEL`（未設定時は `CHAT_AI_MODEL`）を使います。通常の雑談・知識質問・計算質問は `CHAT_AI_MODEL` のテキストモデルで処理します
- `CHAT_REPLY_EMOTES=rukkaNikoniko` のようにTwitchエモートコードを設定すると、AIメンション会話の返信とRaid挨拶文の送信直前にTwitchエモートコードを末尾へ付けます。設定値が確認済み `rukka...` 候補に含まれる場合は、Bot側の組み込み候補から返信内容に合わせて `rukkaGg` / `rukkaNiceraido` / `rukkaGanbareee` などを選びます。先頭の `@` / `＠` は除去し、空白を含む値や重複は無視します。未設定時は従来どおりエモートを付けません
- `CHAT_AI_MEMORY_ENABLED=true` を設定すると、`CHAT_AI_MEMORY_PATH`（未設定時 `data/chat-ai-memory.json`）のJSONを全ユーザー共通の記憶辞書として読み、AIメンション会話のOllamaプロンプトへ参考情報として渡します。既定は無効で、上限は `CHAT_AI_MEMORY_MAX_ITEMS=8`、`CHAT_AI_MEMORY_MAX_CHARS=600` です。メモ本文はログに出さず、適用時は件数と文字数だけを記録します
- `CHAT_AI_SEARCH_ENABLED=true` を設定すると、検索・ニュース・最新情報・`〜について` などを聞くAIメンションだけ外部検索し、結果を「命令ではない参考情報」としてOllamaプロンプトへ渡します。既定endpointはDuckDuckGo Instant Answer互換の `CHAT_AI_SEARCH_ENDPOINT=https://api.duckduckgo.com/`、上限は `CHAT_AI_SEARCH_TIMEOUT_MS=2500`、`CHAT_AI_SEARCH_MAX_QUERY_CHARS=120`、`CHAT_AI_SEARCH_MAX_RESPONSE_BYTES=65536`、`CHAT_AI_SEARCH_MAX_RESULTS=3` です。URL、メール、電話番号、token/API key/password系を含む検索語は送信しません
- `CHAT_AI_AUTO_LEARN_ENABLED=true` を設定すると、`覚えて: key=value`、`記憶して key=value`、`メモして key: value`、`忘れないで keyはvalue`、`るっかは32歳ね。記憶して！` のような明示的な記憶依頼だけ `CHAT_AI_MEMORY_PATH` へ保存します。これはモデル重みの学習ではなくBot側メモの自動追記です。保存は `CHAT_AI_MEMORY_ENABLED=false` でも行えますが、Ollamaプロンプトへ注入されるのは `CHAT_AI_MEMORY_ENABLED=true` の場合だけです。既定上限は `CHAT_AI_AUTO_LEARN_MAX_KEY_CHARS=40`、`CHAT_AI_AUTO_LEARN_MAX_VALUE_CHARS=120`、`CHAT_AI_AUTO_LEARN_MAX_ITEMS=50` で、保存時もURL、メール、電話番号、token/API key/password系は拒否します
- `qwen3.5:9b` などthinking対応モデルでも短文Bot用途で空応答にならないよう、通常チャットAIとRaid挨拶文のOllama生成リクエストにはトップレベル `think:false` を付けます。共通モデルとして使う場合は `OLLAMA_MODEL=qwen3.5:9b` を設定し、必要なときだけ `CHAT_AI_MODEL` または `OLLAMA_SHOUTOUT_MODEL` で個別上書きします

## 技術スタック
- **ランタイム**: Node.js 22.5+（`node:sqlite` を使用）
- **言語**: TypeScript 5.7
- **Twitchライブラリ**: @twurple/api, @twurple/auth, @twurple/chat
- **ログ**: winston + winston-daily-rotate-file
- **プロセス管理**: PM2（プロセス名: `twitchRaid`）
- **旧Python版**: `main.py` などは過去資産・互換テスト用に残存。現行運用と仕様書の正本はTypeScript版

## コマンド一覧

| コマンド | 説明 | 備考 |
|---------|------|------|
| `!help` | 主要コマンド一覧をチャットに表示 | 返信文頭に `!` を付けて読み上げ回避、権限不要、クールダウンなし |
| `!age` | 年齢を表示 | |
| `!goods` | グッズ販売ページのURLを表示 | [booth.pm](https://rukalun.booth.pm) |
| `!site` | Clip検索サイトのURLを表示 | [rukalun.mydns.jp](https://www.rukalun.mydns.jp) |
| `!x` | XアカウントのURLを表示 | [x.com/rukalunlol](https://x.com/rukalunlol) |
| `!youtube` | YouTubeチャンネルのURLを表示 | [is.gd/rukalunyt](https://is.gd/rukalunyt) |
| `!game` | ランダムなゲーム候補を表示 | Twitchに残っている過去アーカイブVODで配信したゲームからランダム、権限不要、クールダウンなし |
| `!weight` | ランダムな体重を表示（15〜200kg） | ネタ枠 |
| `!height` | ランダムな身長を表示（120〜220cm） | ネタ枠 |
| `!mood` | 今日の気分をランダム表示 | 15種類からランダム |
| `!menu` | 今日のおすすめメニューをランダム表示 | 70種類以上からランダム |
| `!chat <メッセージ>` | Bot宛てメンションなしでAIメンション会話と同じ返信を生成 | 既存AI会話と同じクールダウン、キュー、MemoryHub、外部検索、スタンプ付与を使用 |
| `!clip` | 過去のクリップをランダム表示 | 30分クールダウン（特別ユーザー除外） |
| `!myclip` | 自分が作成したクリップをランダム表示 | 30分クールダウン（`!clip`とは独立） |
| `!clipsearch <キーワード>` | Clipタイトル/作成者名/ゲーム名から過去クリップを検索して1件表示 | SQLiteキャッシュ検索、クールダウンなし |
| `!manga` | DLsite日間ランキングからランダムに1作品表示 | ON/OFF切替可、10秒後自動削除 |
| `!mangaon` | `!manga` コマンドを有効化 | 管理者のみ |
| `!mangaoff` | `!manga` コマンドを無効化 | 管理者のみ |
| `!shoutout <ユーザー名>` | 指定ユーザーへ手動 shoutout を実行 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ |
| `!speed` | コメント風速を表示（直近60秒＋配信全体平均） | コマンドは計測対象外 |
| `!commentcount` | 配信開始からの累計コメント件数を表示 | 再起動後も引き継ぎ |
| `!boom [日数]` | 指定期間（省略時30日）で1時間以上遊んだゲーム別トータル時間と総配信時間を表示 | 日数は1〜60の整数、VODチャプター情報を集計 |
| `!streamnotify` | 現在の配信開始通知をDiscordへ手動送信 | broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ |

## 定期おすすめコメント
- 配信中のみ、配信開始から1時間後に最初のおすすめコメントを投稿し、それ以降は既定1時間ごとに1通ずつ投稿する。起動直後や配信開始直後には即投稿しない
- 投稿文は読み上げ対象にしてよいため先頭に `!` を付けず、配信開始からの経過時間を入れて次の2種類をローテーションする

```text
【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp
【定期】配信開始から2時間経過しました。るっかるんのグッズはこちら！→ https://rukalun.booth.pm
```

- 送信失敗時はローテーション位置を進めず、次回の定期処理で同じコメントを再試行する。送信中に次の45秒キープアライブが来ても重複送信しない
- Bot再起動時に配信中stateを復元した場合は、配信開始時刻から見た直近の1時間境界へ送信基準を揃え、停止中の過去分をまとめて送らない

## AIメンション会話
- `CHAT_AI_ENABLED=true`、または `CHAT_AI_ENABLED` 未設定かつ `OLLAMA_SHOUTOUT_ENABLED=true` で継承モデルがあるときだけ、通常チャット内の `@にめいやボットくん` / `@nyme_ia2` など `CHAT_AI_BOT_ALIASES` に一致するBot宛てメンション、または `!chat <メッセージ>` へAI返信する。未設定時の反応名は `にめいやボットくん` と `nyme_ia2` で、`@るっかるん` は明示的に `CHAT_AI_BOT_ALIASES` へ入れない限り反応しない。`CHAT_AI_ENABLED=false` / `0` は常に無効化を優先する。`!help @にめいやボットくん` のような `!chat` 以外のコマンド本文は従来どおりコマンドとして扱い、AIは介入しない
- 返信はOllama `POST /api/generate` で生成し、単一行・最大 `CHAT_AI_MAX_RESPONSE_CHARS` 文字へ整形する。成功応答が空でなければ、`GG！` のような短い英字返答も含めて原則そのまま送信する。先頭 `!`、引用符、絵文字、改行は除去または抑止する。勝敗質問では `スコア100` や `ゲームはApexです` のような断定に使いにくい返答だけ安全な定型文へフォールバックする。`CHAT_REPLY_EMOTES` が設定されていれば、最終送信本文の500文字上限内でTwitchエモートコードを末尾へ付ける。確認済み `rukka...` 候補が設定されている場合は、`GG` 系なら `rukkaGg`、Raidなら `rukkaNiceraido` のように文脈別に選ぶ
- Bot自身や `CHAT_AI_IGNORED_USERS` の発言には返信しない。除外ユーザーのBot宛てメンションは `AIメンション会話をスキップ: ignored_user=...` とINFOログへ残る。Ollama処理中、キュー処理中、クールダウン中の追加メンションはチャットへ順番待ち通知を出さず、内部キューへ積んで待ち時間を挟み順番に生成する。返信生成を試みた時点から `CHAT_AI_COOLDOWN_SECONDS` のクールダウンをかける。Ollama失敗、HTTPエラー、空応答、無効応答ではチャットへ何も返さず、`reason=http_error` / `invalid_response` / `policy_rejected` / `exception` のようにログだけ残す。HTTPエラー時は `status` / `model` / `image` / ユーザー入力prompt / `elapsedMs` / `detail` を短縮して出し、構築済みpromptやメモ本文は出さない。`detail` は4KBまで読み、過大本文は `too_large`、読取失敗は `unavailable` とし、Bearer tokenやpassword/API key系の値はマスクする。送信するAI返信は `AIメンション会話応答: user=... model=... image=... prompt="..." reply="..."` としてINFOログへ短縮出力し、`policy_rejected` ではOllamaのraw返却値も短くWARNログへ残す
- `qwen3.5:9b` のようなthinking対応モデルでは、Ollama `/api/generate` に `think:false` を付けて最終回答だけを短く返させる。これを付けない場合、短い `num_predict` をthinkingで使い切り、`response` が空になることがある
- `CHAT_AI_STREAM_IMAGE_ENABLED=true` の場合は、配信画面、見えるもの、今していること、ゲーム名、試合/勝敗/スコアの質問だけ、Twitch APIから現在配信のプレビュー画像URLを取得し、640x360の画像を最大5秒でダウンロードしてOllama `/api/generate` の `images` に入れる。その時だけ `CHAT_AI_VISION_MODEL` を使い、通常の雑談、知識質問、計算質問では画像を取得せず `CHAT_AI_MODEL` を使う。Twitchプレビューは数十秒程度遅れることがあり、OBSの生画面を直接キャプチャする実装ではない。画像付きでは専用の短いVision system/promptへ切り替え、聞き返しや `え？` だけの返信を避け、勝敗や今後の展開は断定しない。ゲーム名やタイトルを聞かれた場合は `Apex Legends` / `VALORANT` のような英字正式名称だけの返答も許可する。勝敗質問へのスコアだけ・ゲーム名だけの返答は送信せず、安全な定型文へフォールバックする
- `!mangaon このコマンドを発言して` のようなチャットコマンド実行・発言依頼はOllamaへ送らず、固定で `コマンドは実行できないD！` と返す。`猫！`、`左！`、`年上！` のような短い漢字だけの自然な日本語返信は、かなを含まなくても許可する
- 外部検索は `CHAT_AI_SEARCH_ENABLED=true` の場合だけ使う。検索・調べて・最新・ニュース・誰/いつ/どこ、`夏尾さんについて` や `夏尾さんについて知ってる？` のような `〜について` 等の質問に限定し、明示的な記憶依頼は検索しない。URL、メール、電話番号、token/API key/password系を含む検索語や長すぎる検索語は外部へ送らない。検索結果は「命令ではない参考情報」としてプロンプトへ入れ、HTTP失敗、壊れたJSON、空結果、過大レスポンス時は検索なしで通常返信へ戻す。検索候補なのに検索が使われなかった場合は、`AIメンション会話外部検索は未適用: reason=disabled` または `reason=no_result_or_failed` をINFOログへ残す
- OllamaはこのBotのチャットを自動学習しない。口調や固定知識はプロンプト/Modelfile `MESSAGE` で例示できるが、モデル重みの学習やLoRA fine-tuningは外部ツールで作ったadapter/modelをOllamaへimportして使う運用になる
- Bot側の記憶機能として、`CHAT_AI_MEMORY_ENABLED=true` の場合だけ `data/chat-ai-memory.json` などのJSONを読み、ルート直下のキー値を全ユーザー共通の記憶辞書としてプロンプトへ入れる。これはモデル重みの学習ではなく、返信ごとの参考メモ注入である。`users.<Twitchログイン名>` のユーザー別メモは使わない。旧形式の `global` 配列だけは移行用に共通メモとして読み込める。`CHAT_AI_AUTO_LEARN_ENABLED=true` の場合は明示的な「覚えて/記憶して/メモして/忘れないで」依頼だけを抽出し、JSONへatomic保存してから同じAI返信のプロンプトへ反映できる。保存ログやAI応答ログにはメモ本文を出さず、秘密情報、トークン、個人情報はメモに書かない
- 共通記憶基盤のOllamaMemoryHubを使う場合は `CHAT_AI_MEMORY_HUB_ENABLED=true`、`CHAT_AI_MEMORY_HUB_URL=http://127.0.0.1:3217`、`CHAT_AI_MEMORY_HUB_NAMESPACE=twitch` を設定する。BotはAIメンションごとにHubへ `POST /v1/ingest` を送り、Hub側で明示的な記憶依頼や安全な安定情報だけを保存させる。その後 `POST /v1/context` で関連メモを取得し、既存JSONメモと結合してOllama promptへ参考情報として渡す。Hub停止、HTTP失敗、空結果はfail-openで通常返信を続け、Hubメモ本文はログに出さない。タイムアウト既定値は `CHAT_AI_MEMORY_HUB_TIMEOUT_MS=1200`

```json
{
  "bot-tone": "短く、語尾にDを自然に使う",
  "呼び方": "にめいやボットくん",
  "配信者": "るっかるん"
}
```

- 現行の配信画像入力はTwitchプレビュー画像のみ。OBS画面の直接キャプチャ、画像保存、連続フレーム解析、画面内個人情報のマスクは未実装で、必要になった場合に別途設計する

## .env保護
- `.env` の更新は `env-store.ts` で実行し、更新前に `.env.backup` を作成
- `.env.backup` と `.env.tmp` はバックアップ/一時ファイルのため Git 管理外

## 再起動ポリシー
- 定期再起動は 1 日 1 回
- GitHub 更新による再起動はクールダウン対象外。pull と build が終わったら即 `process.exit(0)` でPM2再起動をトリガーする
- 旧運用互換として `docs/clip-search-data.json` だけの更新は公開データのみの差分として扱う。RukalunPage分離後の公開JSON更新は別repoで行うため、twitchRaidのbuild/再起動対象にはならない
- PM2管理下では `process.exit(0)` でPM2が自動再起動
- TypeScript版は `dist/` を Git 管理しないため、GitHub更新検知後に自動で `npm run build` を実行
- 定期再起動だけは `last_restart.txt` による1日クールダウンを維持する

## 配信通知仕様
- 配信開始検知時に Discord Bot API で通知（Bot設定が無い場合、またはBot API投稿が失敗した場合はWebhookへフォールバック）
- 配信開始通知は本文 `@everyone` とDiscord Embedで投稿する。Embedには配信タイトル、Twitch URL、ゲーム名、視聴者数、Twitchプレビュー画像を含める。Twitchプレビュー画像URLは配信が変わっても同じ文字列になりやすいため、配信IDがあれば `stream_id`、無ければ開始時刻の `stream_started_at` クエリを付け、Discordが配信ごとに画像を再取得できるようにする
- 通常開始通知または手動 `!streamnotify` がDiscord投稿結果を得た後は、ログに `streamPreviewImage=...` として実際にDiscordへ渡したEmbed画像URLを出す。サブPC反映後の初回配信で、このURLに `stream_id` または `stream_started_at` が付いていることを確認できる
- 配信開始通知が漏れた場合は、管理者が `!streamnotify` を実行すると現在の配信情報でDiscordへ手動送信する。通常のタイトル重複スキップは通さない
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 配信開始中は `STREAM_SUMMARY_STATE_PATH` に stream id / タイトル / ゲーム名 / 開始時刻 / コメント数 / Raid数を保存
- 通常コメントによる配信まとめコメント数更新は30秒デバウンスでJSON保存し、Raid受信・停止・配信終了時は即時flushして取りこぼしを防ぐ
- `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` がある場合、配信開始通知メッセージからDiscordスレッドを作成し、そのスレッドIDを保存する
- 同一タイトルで開始通知がスキップされた再起動ケースでも、保存済み開始通知メッセージIDがあれば重複投稿せずスレッド作成だけを再試行する。開始通知メッセージIDも無い場合、自動スレッド保証処理は新しい開始通知を投稿しない
- 通常の配信開始通知を送った直後にスレッド作成だけ失敗した場合、同じ開始処理内では新しい開始通知を投稿し直さない。Clip/終了まとめ前のスレッド保証でも開始通知を自動再投稿しない。これによりDiscordへ開始通知が2通流れることを防ぐ
- `!streamnotify` で手動送信した場合は、新しく送った通知投稿の `startMessageId` / `threadId` を既存stateより優先し、その通知投稿から作成したスレッドへ以後のクリップと終了まとめを集約する
- 直近クリップ同期は1分ごとに実行し、既定では過去6時間分を取り直す。配信中に新規クリップを検知したら未投稿分だけ配信まとめスレッドへ投稿して `postedClipIds` に保存する
- クリップ検知時に `threadId` が無い場合は、保存済み `startMessageId` からスレッド作成だけを再試行する。`startMessageId` も無い場合やスレッド作成に失敗した場合は、開始通知を再投稿せず警告ログで止める
- 開始通知そのものを再送したい場合は、管理者が `!streamnotify` を使って明示的に手動送信する
- 新しい開始通知が投稿されたが `threadId` が返らなかった場合は、古い `threadId` を保持せずクリアする。これにより、存在しない/古いスレッドへ投稿済み扱いで `postedClipIds` だけ進むことを防ぐ
- 配信終了検知時に「配信終了まとめ」をDiscordへ投稿し、配信時間、ゲーム、コメント数、Raid数、クリップ数、ハイライト候補を表示
- まとめ投稿前に配信時間帯のクリップを最終同期し、active/pendingどちらの状態でも開始通知起点のスレッド保証を通してから、未投稿クリップと終了まとめを投稿する
- 終了まとめ投稿後も配信まとめスレッドはアーカイブせず、開始通知から見える状態を保つ
- 配信開始時にスレッド作成済みなら、クリップURLと終了まとめはそのスレッドへ投稿する
- 配信開始時にBot API投稿ができなかった場合、開始通知は通常Webhook投稿へフォールバックする。終了まとめとクリップURLは開始通知スレッドがある場合だけ投稿し、Bot API失敗時も `thread_id` 付きWebhookで同じスレッドへフォールバックする。開始通知スレッドを保証できない場合は通常Webhookへ外出しせず、pending stateを残して次回起動/監視または `!streamnotify` 復旧後に再試行する
- 配信中の新規Clip URL投稿はBot側で直列化し、再起動直後に配信開始監視と直近Clip同期完了コールバックが同時に動いても、同じClipを二重投稿しない。処理中に追加呼び出しが来た場合は投稿完了後に最新stateで再確認する
- Bot Tokenを使わずWebhookだけで完結させたい場合は、Webhook先をフォーラム/メディアチャンネルにし、`DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定する。まとめ投稿に `thread_name` を付けてスレッドを作成し、返却されたスレッドIDへクリップURLを投稿する
- Bot再起動時に未投稿の配信まとめ状態が残っていて、Twitchがオフラインなら保存済み情報から投稿を再試行

## レイド自動シャウトアウト
- レイド検知時は `src/commands/shoutout.ts` でレイド元のユーザーIDを解決し、Bot/Moderator のユーザーコンテキストで `chat.shoutoutUser` を実行
- レイド検知時は `src/commands/raid-info.ts` でレイド元の配信情報を取得し、Ollamaが無効または失敗した場合はチャットへ `レイドありがとうD！！ @ユーザー さんは、「ゲーム名」で「配信タイトル」をしてたD！お疲れ様D！チャンネルはこD→URL` を1通だけ送信する
- `OLLAMA_SHOUTOUT_ENABLED=true` の場合は、取得したRaid元のユーザー名/ゲーム/タイトル/URLをもとに `src/commands/shoutout-introduction.ts` で同じ役割のRaid挨拶文を生成し、固定文の代わりに1通だけ送信する。Raid人数はAI入力に含めず、人数の多い少ないには触れさせない
- Ollama挨拶文生成はshoutoutキュー投入後に実行する。AI生成文は `@ユーザー名` とチャンネルURLを必ず含むよう補正し、絵文字を除去し、URLを残したまま250文字以内へ丸める。取得済みゲーム名や配信タイトルがAI文から抜けた場合は、固定文へ戻さずコード側で不足分だけを補ってAI文として採用する。タイトルの括弧内装飾や `@ユーザー名` まで完全一致していなくても、主要部が既に含まれていれば長い定型紹介文は追記しない。`人数少なかった`、`少人数`、`寂しい` などRaid規模を下げる表現を含む場合はAI文を採用せず、固定のRaid挨拶文へフォールバックする。Ollamaが未設定、タイムアウト、HTTPエラー、空応答、日本語かなを含まない返答の場合も固定文へフォールバックし、Twitch shoutout APIは継続する。`CHAT_REPLY_EMOTES` が設定されていれば、AI/固定フォールバックどちらのRaid挨拶にもTwitchエモートコードを末尾へ付ける
- Ollama挨拶文の採用/フォールバックは `Ollama Raid挨拶文を採用` / `Ollama Raid挨拶文を固定文へフォールバック` として、対象ユーザー、理由、所要時間をログに出す。チャット送信に成功した場合は `Raid挨拶文を送信` として対象ユーザー、Raid人数、実際の送信本文を短縮してINFOログに出す
- Raid元の配信がすでにオフライン、またはTwitch APIでタイトル/ゲームを取得できない場合でも、チャンネルURL付きのフォールバック文を送信する
- Raid自動shoutoutは `ShoutoutQueue` で直列化し、Twitchの `429 Too Many Requests` に当たった対象はキュー先頭へ戻して2分後に再実行する
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
- 配信していない時間に1日1回、全期間を再走査してTwitch側で返らなくなったClipを `unavailable_at` 付きで無効化する。直近同期でも、DBに既にあるClipが一覧から消えた場合は `getClipsByIds` で個別確認し、返らないIDだけ削除/非公開として無効化する。ただし作成から2時間以内のClipはTwitch API反映の揺れとして直近削除確認の対象外にし、すでに無効化されていた場合も直近同期時に有効へ戻す
- 無効化されたClipは `!clip` / `!myclip` と配信まとめクリップ候補から除外され、Twitch APIで再び返った場合は自動で有効化される
- 日次再走査の最終実行時刻は `clip_sync_state` の `daily_reconcile_at` に保存する。通常バックフィルと競合して未完了だった場合は実行済みにしない
- 直近6時間のクリップは起動直後と1分ごとに再同期し、Twitch側のClip一覧APIへの反映が1時間以上遅れたClipも候補へ入れる。時間幅は `.env` の `TWITCH_CLIP_RECENT_WINDOW_MINUTES` で調整できる
- 直近同期ログの `fetched` はTwitch APIから返ったClip件数、`saved` は新規または無効化から復活したClip件数、`unavailable` は削除/非公開として新たに無効化したClip件数。既存Clipの再保存だけでは `saved=0` のままにする
- `!clip` / `!myclip` 実行時はSQLiteキャッシュから即選択し、キャッシュ未準備時のみ最大200件の軽いAPIフォールバックを使う
- `!clipsearch <キーワード>` はSQLiteキャッシュ内のClipタイトル、作成者表示名、ゲーム名を部分一致検索し、履歴を避けて1件のURLを返す。検索語に空白を含められ、`%` / `_` はワイルドカードではなく通常文字として扱う
- `!clipsearch` はTwitch API全件検索へフォールバックしない。キャッシュ未準備や一致なしの場合は見つからない旨を返す
- `!clipsearch` がClip件数増加で遅くなった場合は、SQLite FTS5 または検索専用テーブルへの移行を検討する。初回実装では単純部分一致に留める
- 直近に表示したクリップIDはSQLite内の `clip_history` に保存し、`!clip` 全体と `!myclip:<ユーザー>` ごとに重複を避ける。全候補を出し切った場合のみ履歴内のクリップも再候補に戻す
- `!clipsearch` の表示履歴は `clipsearch:<検索語>` ごとに保存する

## GitHub Pages Clip検索
- 公開Clip検索画面の正本は別リポジトリ `C:\Users\mlove\Documents\GitHub\RukalunPage`。GitHub Pages URLは `https://jinwktk.github.io/RukalunPage/`
- twitchRaid 側の `docs/index.html` / `docs/clip-search.html` / `docs/typescript-bot-spec.html` は旧URL互換のリダイレクトだけを持つ。公開ページ本体、公開JSON、公開用 `assets/rukalun` はこのリポジトリでは管理しない
- `RukalunPage/index.html` は静的GitHub Pages上で動くClip検索画面。るっかるん向けに淡いピンク、ミント、空色、レモン色を使ったゆるふわ系デザインにしている。提供画像から作った `assets/rukalun/clip-search-hero.png` をヒーロー背景、`assets/rukalun/clip-search-og.png` をOG画像、`assets/rukalun/clip-search-favicon.png` / `assets/rukalun/clip-search-favicon.ico` / `assets/rukalun/clip-search-apple-touch-icon.png` をfaviconやホーム画面アイコンに使う。画面内のブランドマークやボタン小アイコンも `assets/rukalun/Hi-112px.png`、`assets/rukalun/プレゼント-112px.png`、`assets/rukalun/bikkuri-112px.png` を使う
- 検索エンジン/SNS向けに、description、canonical、robots、OGP、Twitter Card、JSON-LD `CollectionPage` / `SearchAction` を設定する。`?q=検索語` がある場合は検索欄へ初期入力する
- 検索データは `RukalunPage/clip-search-data.json`。ブラウザ内でタイトル/作成者表示名/ゲーム名を検索し、作成者フィルタ、新しい順/古い順/お気に入り順/再生数順/タイトル順の並び替え、件数表示、追加表示、Clip最終同期時刻の秒単位表示に対応する
- スマホ幅では上部の検索条件を「検索条件を開く」ボタン配下へ折りたたみ、必要な時だけ開けるようにする。トグル内は条件概要と右端固定の `▽` を分け、長い検索条件でもアイコン位置が崩れないようにする。PC/タブレット幅では従来通り検索条件を常時表示する
- 各Clipカードにはサムネイル、ゲーム名、作成者、作成日、再生数を表示する。作成日時が現在時刻から3日以内のClipには `NEW` マークを付ける。再生はページ内iframeではなく `Twitchで見る` の外部リンクだけにする
- お気に入りは各ブラウザの `localStorage` にClip IDと登録時刻だけを保存する。公開JSONやサーバー側状態にはお気に入り情報を持たせず、`お気に入り順` はお気に入りを登録が新しい順で先頭に並べる
- 公開画面には仕様書リンク、内部運用情報、データ生成コマンド、DB由来説明を表示しない。内部向け仕様書からも公開Clip検索画面へのリンク導線は置かない
- 公開JSONは `scripts/export-clip-search-data.mjs` で `data/clips.sqlite` から生成する。`--out C:\Users\mlove\Documents\GitHub\RukalunPage\clip-search-data.json` のように出力先を指定して使う。必要時は `--enrich-from-twitch` でTwitch APIからサムネイルURLとゲーム名を補完する。自動公開時は毎回API全補完を行わず、既存の公開JSONにあるサムネイルURL/ゲーム名をDB欠落分へ引き継ぐ
- Bot運用時に `CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true` を設定している場合、直近Clip同期完了後に `src/docs/clip-search-data-publisher.ts` が公開JSONを再生成し、差分があれば `CLIP_SEARCH_PUBLISH_REPO_DIR` の `main` へcommit/pushする。未指定時は隣の `RukalunPage` repoを公開先にする。公開前に設定済みremote/branchへ `git fetch` し、`git cherry -v <remote>/<branch> HEAD` でローカルだけのcommitを判定する。公開JSONだけを変更するBot同期commitまたはremote側に同等patchがある `-` commitだけなら `git reset --hard <remote>/<branch>` で追従し、未コミット変更や `+` の非Bot開発commitがある場合は自動公開をスキップする。pushは `HEAD:<branch>` を使うため、checkout branch名と公開branch名が違っても公開先branchへ反映できる。新規/復活Clipが0件の同期も既定5分ごとに公開し、新規/復活Clipまたは削除/非公開Clipの無効化があった場合は間隔内でも公開する。保存0件かつ無効化0件の同期時刻だけの更新では、直前HEADの件名が `Clip検索JSONを同期時刻更新` の場合だけ `git commit --amend --no-edit` と `git push --force-with-lease` を使う。直前HEADが開発commitの場合や、Clip追加・復活・削除/非公開化がある場合は通常commit/pushにする。Bot再起動時は既存JSONの `generatedAt` を読んで公開間隔を引き継ぐ
- サブPCでは `CLIP_SEARCH_PUBLISH_REPO_DIR=E:\GitHub\RukalunPage` と `CLIP_SEARCH_DATA_PATH=E:\GitHub\RukalunPage\clip-search-data.json` を明示しておく。`E:\GitHub\RukalunPage` はGit repoである必要があり、JSON単体のフォルダでは自動commit/pushできない
- 公開JSONへ含めるClip項目は `id`、`url`、`title`、`creator`、`gameName`、`thumbnailUrl`、`createdAt`、`views` のみ。同期stateは `clipSync.recentSyncedAt` のみ公開し、`creator_id`、ゲームID、履歴、その他の内部state、認証情報は含めない
- `unavailable_at` が入った削除/非公開Clipは公開JSONから除外する。そのためログの `clip全期間バックフィル完了: total=...` はDB内総件数、Clip検索画面の件数は公開対象件数として差が出ることがある
- サブPCの実データをPagesへ反映する場合は、サブPCの `data/clips.sqlite` を元にJSONを生成し、`RukalunPage` の `main` へコミット・プッシュする

## Boomコマンドメモ
- `!boom` は既定で過去30日間、`!boom 7` のように1〜60の整数を付けた場合は指定日数分のアーカイブ配信を対象に、Twitch GraphQL の VOD チャプターからゲーム別の配信時間と総配信時間を集計する
- 数値以外、0、61以上、小数などは集計せず `⚠️ 使い方: !boom [日数]（1〜60の整数）` を返す
- ゲーム別合計が1時間未満のものは表示対象外
- 表示は合計時間の長い順で最大6件まで
- 返却文言は棒読みの長文読み上げを避けるため、先頭に `!` を付けて読み上げスキップ対象にする
- VOD単位のGraphQL取得は最大4本並列で実行し、結果は日数別に5分間メモリキャッシュする

## プロジェクト構成

```
src/
├── index.ts                       # エントリーポイント
├── config.ts                      # .env設定管理
├── bot.ts                         # Bot本体（Twurple統合）
├── git-manager.ts                 # Git更新検知・build・再起動
├── system-watcher.ts              # 定期監視（更新・再起動）
├── auth/
│   ├── auth-scope-sets.ts         # 必須OAuthスコープと再認可用追加スコープ
│   ├── scope-policy.ts            # スコープ不足判定
│   ├── token-manager.ts           # token validate/refresh
│   └── token-refresh-policy.ts    # refresh fallback判定
├── chat/
│   ├── command-cooldown-state.ts  # コマンド別クールダウン
│   ├── comment-count-formatter.ts # コメント数文言
│   ├── comment-speed-meter.ts     # コメント風速
│   ├── message-filters.ts         # コマンド判定
│   └── reply-emotes.ts            # AI/Raid返信へのTwitchエモート付与
├── commands/
│   ├── age.ts
│   ├── boom.ts                    # !boom 指定期間ゲーム時間集計
│   ├── clip-cache-store.ts        # Clip SQLiteキャッシュ
│   ├── clip-cache-sync.ts         # Clip同期/日次再走査
│   ├── clip.ts                    # !clip / !myclip / !clipsearch
│   ├── game.ts                    # !game VOD由来ゲーム候補
│   ├── manga.ts                   # !manga / 管理者判定
│   ├── mention-chat.ts            # @メンションAI会話
│   ├── mention-chat-memory-hub.ts # OllamaMemoryHub連携
│   ├── raid-info.ts               # Raid元配信情報文言
│   ├── random-commands.ts         # !weight / !height / !mood / !menu
│   ├── shoutout-introduction.ts   # OllamaによるRaid挨拶文生成
│   ├── shoutout.ts                # shoutout権限/キュー
│   └── stream-notify.ts           # !streamnotify
├── notifications/
│   ├── clip-recast-notifier.ts
│   ├── discord-webhook.ts         # Discord Bot/Webhook/Thread
│   ├── periodic-recommendation-notifier.ts # 配信中の定期おすすめコメント
│   └── stream-notifications.ts    # 配信開始通知Embed
├── streams/
│   ├── stream-summary-count-buffer.ts # コメント数/Raid数のデバウンス保存
│   ├── stream-summary-state-store.ts
│   └── stream-summary.ts          # 配信まとめ/Clip投稿/スレッド保証
├── docs/
│   └── clip-search-data-publisher.ts # Clip検索JSONの自動生成・commit/push
└── utils/
    ├── comment-state-store.ts
    ├── env-store.ts
    ├── logger.ts
    ├── process-restart.ts
    └── restart-state-store.ts
scripts/
└── export-clip-search-data.mjs    # RukalunPage向けClip検索JSON生成
docs/
├── clip-search.html               # RukalunPageへの旧URL互換リダイレクト
├── index.html                     # RukalunPageへの公開ルートリダイレクト
└── typescript-bot-spec.html       # RukalunPageへの旧URL互換リダイレクト
../RukalunPage/
├── .github/workflows/pages.yml    # RukalunPage GitHub Pages公開
├── assets/rukalun/                # Clip検索画面用の軽量画像と小アイコン
├── clip-search-data.json          # 公開用Clip検索データ
├── clip-search.html               # 新repo内の互換リダイレクト
├── index.html                     # Clip検索画面の正本
└── tests/page.test.mjs            # 公開HTMLと必須ファイルの検証
internal-docs/
├── twitchraid-bot-zukan.html      # 内部向けTypeScript版総合仕様書
├── ARCHITECTURE.md
├── COMMANDS.md
├── DESIGN_PATTERNS.md
└── TECH_STACK.md
```

## 更新履歴
- **2026-06-19**: Twitchチャットで日本語ハンドルURLがリンク化されず、ASCIIエンコードURLも読み上げが長くなるため、`!youtube` の返却URLを作成済み短縮URL `https://is.gd/rukalunyt` へ変更した。短縮URLは指定YouTubeチャンネルへ301リダイレクトすることを確認済み
- **2026-06-19**: `!youtube` の返却URLを短縮表記 `https://youtube.com/@るっかるんるっか` へ変更した
- **2026-06-19**: `!youtube` コマンドを追加し、指定YouTubeチャンネルURLをチャットへ返せるようにした。`!help` の一覧にも `!youtube` を追加
- **2026-06-19**: `!boom 7` のように日数を指定できるようにした。省略時は従来どおり30日、指定値はTwitch VOD保存期間に合わせて1〜60の整数だけ受け付け、期間別に5分キャッシュして `!boom 7` と `!boom` の結果が混ざらないようにした
- **2026-06-19**: AIメンション外部検索で `夏尾さんについて` のような `〜について` 質問が検索対象にならない問題を調査。この作業PCの `logs/` とPM2ログには実運用の夏尾発言は見つからず、`.env` では `CHAT_AI_SEARCH_ENABLED` 未設定のため検索無効だった。コード上も検索トリガーに `について` がなく、`tests/commands/mention-chat-search.test.ts` に失敗テストを追加して再現後、語尾の `〜について` と `について教えて/知りたい` を検索対象へ追加した。追加調査で `夏尾さんについて知ってる？` も検索候補にし、検索候補なのに検索無効または結果なし/失敗で未適用だった場合の理由ログを追加した
- **2026-06-19**: `夏尾さんについて` の外部検索ログを再確認。このPCの `logs/bot_2026-06-19.log` に出ている `夏尾さんについて` と `reason=disabled` / `reason=no_result_or_failed` はVitestの `viewer` テストログで、実運用発言は確認できなかった。`C:\Users\mlove\.pm2\logs` にアプリログはなく、PM2本体ログだけだった。ローカル `.env` は引き続き `CHAT_AI_SEARCH_ENABLED` 未設定で、DuckDuckGo Instant Answer APIへ `夏尾さんについて` を直接問い合わせても `Heading` / `AbstractText` / `Answer` / `RelatedTopics` / `Results` が空だったため、有効化後も現行endpointでは検索文脈なしになり得る
- **2026-06-19**: サブPC `E:\GitHub\twitchRaid` の `.env` を `.env.bak-ai-search-20260619155050` にバックアップし、`CHAT_AI_SEARCH_ENABLED=true`、`CHAT_AI_SEARCH_ENDPOINT=https://api.duckduckgo.com/`、`CHAT_AI_SEARCH_TIMEOUT_MS=4000`、`CHAT_AI_SEARCH_MAX_RESULTS=3` を追加/更新。`npm run build` と `pm2 restart twitchRaid --update-env` を実行し、`twitchRaid` online を確認。サブPCのビルド済み `dist/` で `夏尾さんについて` は検索候補になるが、現行DuckDuckGo Instant Answer endpointは同クエリで結果なしのため、Ollamaへ検索文脈が入らない場合は `reason=no_result_or_failed` ログで追う
- **2026-06-18**: `!chat <メッセージ>` を追加。Bot宛て `@` メンションなしでもAIメンション会話と同じOllama生成、MemoryHub文脈、外部検索、クールダウン/キュー、返信スタンプ付与を使って返信できるようにした。空の `!chat` は使い方を返す
- **2026-06-18**: サブPCログで、通常質問まで配信画像付きの `gemma3:4b` Vision経路へ流れていること、OllamaMemoryHubの`twitch` namespaceに実メモが入っていないこと、`記憶して！` やコマンド読み上げ依頼の判定漏れを確認。通常質問は画像取得せず `CHAT_AI_MODEL` へ流し、画面質問だけ `CHAT_AI_VISION_MODEL` と `images` を使うよう変更。`るっかは32歳ね。記憶して！` のような後置き記憶依頼と、`!mangaon` の読み上げ/再投稿依頼を固定拒否できるようにした
- **2026-06-18**: AIメンション会話にOllamaMemoryHub連携を追加。`CHAT_AI_MEMORY_HUB_ENABLED=true` の場合、明示メモ依頼をHubの `/v1/ingest` へ送り、`/v1/context` の関連メモを既存JSONメモと結合してOllama promptへ渡す。Hub失敗時は通常返信へfail-openし、メモ本文はログに出さない。サブPC常駐用にOllamaMemoryHub側へPM2設定 `OllamaMemoryHub` を追加し、サブPC `E:\GitHub\OllamaMemoryHub` へSSH配置してPM2 online / health OKを確認。twitchRaid側 `.env` もHub有効化済み
- **2026-06-17**: AIメンション会話でOllamaが `GG！` のような短い成功応答を返した場合に、非日本語/低情報判定だけで `policy_rejected` として無言にしないよう変更。空応答、HTTP失敗、無効応答は従来どおり無言でログ化し、勝敗質問のスコアだけ・ゲーム名だけ返答は安全定型へフォールバックする
- **2026-06-17**: `CHAT_REPLY_EMOTES` が確認済み `rukka...` 候補を含む場合、AIメンション会話の返信とRaid挨拶文で組み込みの `rukka` 候補から文脈別にスタンプを選ぶよう変更。`GG！` には `rukkaGg`、Raid挨拶には `rukkaNiceraido` を優先し、未設定時や未知候補だけの設定では従来挙動を維持する
- **2026-06-17**: `CHAT_REPLY_EMOTES` を追加し、AIメンション会話の返信とRaid挨拶文の送信直前に設定済みTwitchエモートコードを末尾へ付けられるようにした。未設定時は従来どおりで、設定値はカンマ区切り、先頭の `@` / `＠` は除去、空白入り値と重複は無視する
- **2026-06-17**: Botが使えるTwitchスタンプ一覧取得に向け、TypeScript版の再認可スコープへ `user:read:emotes` を追加。通常起動の最小スコープには含めず、再認可時だけ要求する。現ローカル `.env` はTwitch側で `invalid client secret` になるため、実認可には正しいClient Secretの反映が必要
- **2026-06-17**: AIメンション会話の返信ログを再調査。実運用ログでは `http_error status=500` が多く、HTTP失敗時だけOllama返却本文・モデル・画像有無・prompt・経過時間が不足していたため、HTTP失敗ログへ `status` / `model` / `image` / `prompt` / `elapsedMs` / `detail` を追加。`detail` はOllama JSON `error` またはテキスト本文を4KBまで短縮し、過大本文は `too_large`、読取失敗は `unavailable`、token/password/API key系はマスクする。promptは構築済みpromptではなくユーザー入力だけを短縮し、記憶依頼本文は失敗ログでも `[memory-request]` に伏せる
- **2026-06-16**: AIメンション会話に外部検索とBot側自動学習を追加。検索系質問だけDuckDuckGo Instant Answer互換APIの結果を参考情報としてOllamaへ渡し、URL/メール/電話番号/token/API key/password系は外部送信しない。`覚えて: key=value` など明示的な記憶依頼だけ `CHAT_AI_MEMORY_PATH` へatomic保存し、`CHAT_AI_MEMORY_ENABLED=true` の場合だけ同一返信からプロンプトへ注入する
- **2026-06-16**: AIメンション会話のBot側記憶をユーザー別ではなく全ユーザー共通の1個の辞書に変更。`data/chat-ai-memory.json` はルート直下のキー値を `key: value` として読む。`users` は無視し、旧 `global` 配列は移行用に共通メモとして読み続ける
- **2026-06-16**: AIメンション会話のBot側記憶機能を追加。`CHAT_AI_MEMORY_ENABLED=true` の場合だけ `CHAT_AI_MEMORY_PATH` のJSONから `global` とユーザー別メモを読み、Ollamaプロンプトへ参考メモとして渡す。メモ本文はログに出さず、適用時は件数と文字数だけ記録する
- **2026-06-16**: 配信中の新規Clip URLがDiscordへ二重投稿される問題を修正。再起動直後に配信開始監視と直近Clip同期完了コールバックが同時に `_postNewStreamClipsToSummaryThread` を呼び、保存前の同じ `postedClipIds` を見ていたため、Bot側でClip投稿を直列化し、処理中の追加呼び出しは再実行予約にするよう変更
- **2026-06-16**: Raid挨拶文が言われなくなったように見える件をサブPCログで確認。18:15のRaidは検知、shoutout、Ollama採用まで通っていたが、`chatClient.say` 成功後の本文ログが無く送信内容を追えなかったため、`Raid挨拶文を送信: target=... viewerCount=... message=...` をINFOログに追加
- **2026-06-16**: AIメンション会話でクールダウン中の追加メンションもスキップせずキュー登録し、待ち時間後に順番処理するよう変更。キュー登録時のチャット通知は出さず、内部ログだけにする
- **2026-06-16**: AIメンション会話の画像質問で、ゲーム名やタイトルを聞かれた場合は `Apex Legends` / `VALORANT` のような英字正式名称だけの返答もpolicy rejectedにせず送信するよう変更
- **2026-06-16**: AIメンション会話の診断用に、実際に送る返信を `AIメンション会話応答: user=... model=... image=... prompt="..." reply="..."` としてINFOログへ残すようにした。`policy_rejected` ではOllamaのraw返却値も短縮してWARNログへ出す。返信品質調整としてOllama temperatureを0.4へ下げ、画像付き時も画面質問/今していること/ゲーム名/試合/勝敗/スコアの質問だけ専用の短いVision system/promptへ切り替え、聞き返しや `え？` だけの返信を避け、勝敗や今後の展開は断定しないよう調整。`める！` や `スコア100` のような低情報返信、勝敗質問へのゲーム名だけの返答は破棄し、安全な定型文へフォールバックする
- **2026-06-16**: AIメンション会話の実ログで `猫！`、`左！`、`年上！` がかな未検出で捨てられ、`!manga` 系コマンド発言依頼に `マジで！？` と返していたため、短い漢字だけの日本語返信を許可し、コマンド実行・発言依頼はOllamaへ投げず `コマンドは実行できないD！` に固定補正するよう変更
- **2026-06-16**: AIメンション会話に配信画像送信を追加。`CHAT_AI_STREAM_IMAGE_ENABLED=true` のときTwitchライブプレビュー画像を取得し、OllamaのVision対応モデルへ `images` として渡す。画像取得時は `CHAT_AI_VISION_MODEL` を使い、取れない場合は通常テキストモデルへ戻す
- **2026-06-16**: AIメンション会話でOllama処理中に追加メンションが来た場合、スキップせず内部キューへ登録し、現在の返信後に順番に処理するよう変更。Ollamaは会話から自動学習せず、fine-tuned adapter/modelは外部学習後にimportする運用であることをREADMEへ明記
- **2026-06-16**: AIメンション会話の既定反応名に `nyme_ia2` を追加。通常チャットで `@にめいやボットくん` だけでなく `@nyme_ia2` でも反応し、発言者が `nyme_ia2` の場合は従来どおり自己返信防止で無視する
- **2026-06-16**: サブPC本番ログでAIメンション会話が `The operation was aborted due to timeout` になっていたため、`qwen3.5:9b` 用にサブPC `.env` の `CHAT_AI_TIMEOUT_MS` と `OLLAMA_SHOUTOUT_TIMEOUT_MS` を `30000` へ延長。`pm2 restart twitchRaid --update-env` 後、ビルド済みコードから `qwen3.5:9b` で日本語返信が返ることを確認
- **2026-06-15**: Bot Token運用の配信終了まとめで、開始通知スレッドを保証できない場合に終了まとめとクリップURLを通常Webhookへ外出ししないよう修正。スレッド未作成時はpending stateを保持し、次回監視または `!streamnotify` 復旧後に再試行する
- **2026-06-15**: AIメンション会話がサブPCの既存Ollama設定だけでは動かない問題を修正。`CHAT_AI_ENABLED` 未設定時は `OLLAMA_SHOUTOUT_ENABLED=true` かつ継承モデルがある場合だけ互換的に有効化し、モデルは `CHAT_AI_MODEL` → `OLLAMA_MODEL` → `OLLAMA_SHOUTOUT_MODEL` の順で解決するようにした。明示的な `CHAT_AI_ENABLED=false` / `0` は引き続き無効化を優先
- **2026-06-15**: AIメンション検知を改善。半角 `@` だけでなく全角 `＠` のBot宛てメンションも検知し、`CHAT_AI_IGNORED_USERS` による自己ユーザー除外はINFOログへ出して運用中に原因を追えるようにした
- **2026-06-15**: AIメンションの既定反応名を配信チャンネル名 `rukalun` から `にめいやボットくん` へ変更。自己返信防止の既定除外ユーザーは `nyme_ia2` にし、日本語aliasの部分一致も拾わないようUnicode境界判定にした
- **2026-06-15**: AIメンション会話の既定クールダウンを5秒へ短縮。Ollama処理中またはクールダウン中にスキップしたメンションは、理由と対象文をチャットへ短く返すようにした
- **2026-06-15**: サブPCのOllamaで `qwen3.5:9b` を検証。モデルはインストール済みでロード可能だったが、`think:false` なしの `/api/generate` はthinkingだけで `response` が空になったため、通常チャットAIとRaid挨拶文の生成リクエストへトップレベル `think:false` を追加
- **2026-06-15**: サブPCではClip DB同期が動いているのに公開Clip検索JSONが更新されない問題を調査。RukalunPage公開repoが履歴整理後にローカルahead/remote behindとなり、publisherが開発commit保護としてスキップしていたため、公開前に `git cherry -v <remote>/<branch> HEAD` で同等patchを判定し、公開JSONだけを変更するBot同期commitまたはremoteに同等patchがあるcommitだけならresetできるようにした。`+` の非Bot commitは引き続き保護し、ログに保護/破棄可能commit数を出す。pushは `HEAD:<branch>` にして、checkout branchと公開branchが違っても反映先を固定した
- **2026-06-15**: 通常チャットでBotへ `@` メンションした時だけOllamaで短い日本語返信を返すAIメンション会話を追加。初回版は既定無効、自己返信除外、60秒クールダウン、Ollama処理中スキップ、失敗時無言、失敗理由ログ、コマンド非介入として実装。配信画面をAIへ渡すVision質問応答は次フェーズとして分離
- **2026-06-15**: 定期おすすめコメントを読み上げ対象にするため、投稿文の先頭 `!` を外し、`【定期】配信開始から...` で送るよう変更
- **2026-06-15**: `!game` コマンドを追加。固定候補ではなくTwitchに残っている過去アーカイブVODのゲーム名から1件を選び、`ゲーム候補：...` 形式でチャットへ返すようにした。候補一覧は5分キャッシュし、`!help` の一覧にも `!game` を追加
- **2026-06-14**: `!x` コマンドを追加し、`https://x.com/rukalunlol` をチャットへ返せるようにした。`!help` の一覧にも `!x` を追加
- **2026-06-14**: `!site` コマンドを追加し、`https://www.rukalun.mydns.jp` をチャットへ返せるようにした。`!help` の一覧にも `!site` を追加
- **2026-06-13**: 配信中に `!【定期】配信開始から1時間経過しました。るっかるんのClip検索サイトはこちら！→ https://www.rukalun.mydns.jp` と `!【定期】配信開始から2時間経過しました。るっかるんのグッズはこちら！→ https://rukalun.booth.pm` のような定期おすすめコメントを投稿する機能を追加。投稿文は読み上げ回避のため先頭 `!` 付きにし、配信開始から1時間後、以降1時間ごとに2種類をローテーションする。`CHAT_RECOMMENDATION_ENABLED=false` で停止、`CHAT_RECOMMENDATION_INTERVAL_MINUTES` で間隔変更できる
- **2026-06-13**: Discord配信開始通知EmbedのTwitchプレビュー画像URLに、配信ID優先の `stream_id` または開始時刻fallbackの `stream_started_at` クエリを付けるよう変更。通常通知と `!streamnotify` の両方でDiscordの画像キャッシュを配信単位に分け、同じ過去画像が表示され続ける問題を抑止する。投稿確認ログに `streamPreviewImage` も出し、サブPCで実URLを確認できるようにした
- **2026-06-12**: RukalunPage側の履歴を手動で戻した後、サブPCの公開repoが古い `origin/main` を見たまま `--force-with-lease` して `stale info` になったため、Clip検索JSON自動公開の前に公開repoで `git fetch origin main` を行うようにした。ローカルだけに残ったcommitがBot同期commitだけなら `origin/main` へ戻してから再生成し、開発commitや未コミット変更がある場合はスキップして破壊しない
- **2026-06-12**: Clip検索JSON自動公開で、保存0件かつ無効化0件の同期時刻だけの更新は、直前HEADがBotの `Clip検索JSONを同期時刻更新` commitの場合だけamendして `--force-with-lease` でpushするようにした。直前HEADがCodexなどの開発commitの場合や、Clip追加・復活・削除/非公開化がある同期は通常commit/pushのままにした
- **2026-06-12**: 公開Clip検索画面を `RukalunPage` リポジトリへ分離。twitchRaid側の `docs/` は新URLへの互換リダイレクトだけにし、公開JSONと公開用 `assets/rukalun` は `RukalunPage` 側で管理するようにした。`CLIP_SEARCH_PUBLISH_REPO_DIR` を追加し、Botの同期後JSON自動公開は別Git repoへcommit/pushできる
- **2026-06-12**: 14:03作成Clipが `14:10:26 JST` の公開JSONへ一度入った後、`14:12:26 JST` の同期で消える挙動を確認。直近削除確認が新規ClipのTwitch API反映揺れを削除/非公開扱いにできてしまうため、作成から2時間以内のClipは直近同期の無効化対象から外し、旧ロジックで無効化済みの場合も直近同期時に有効へ戻すようにした
- **2026-06-12**: 削除済みClipが直近同期後も公開JSONに残る問題を修正。直近同期でDB既存Clipが一覧から消えた場合は `getClipsByIds` で個別確認し、返らないClipだけ `unavailable_at` を付けるようにした。`unavailable > 0` の同期は保存0件でもClip検索JSONを即時公開し、全期間バックフィル競合時は日次再走査の `daily_reconcile_at` を更新しない
- **2026-06-12**: `!help` の返信文頭に `!` を付け、読み上げ対象になりにくいヘルプ一覧にした
- **2026-06-12**: `!help` コマンドを追加。チャット1通で基本/Clip/統計/漫画/管理系の主要コマンド一覧を返し、`!mangaon` / `!mangaoff` も含めて確認できるようにした
- **2026-06-12**: Twitch側のClip一覧API反映遅延対策として、直近Clip同期の既定取得窓を1時間から6時間へ拡大し、`.env` の `TWITCH_CLIP_RECENT_WINDOW_MINUTES` で調整可能にした。`saveClips` の返り値は新規/復活Clip数に変更し、既存Clipの再保存でClip検索JSON自動公開が毎分走らないようにした。直近同期ログは `fetched` / `saved` / `windowMinutes` を出す
- **2026-06-12**: Clip検索ページのfavicon/Apple touch icon/ICOを `docs/assets/rukalun` 配下の `Hi-112px.png` 由来に変更し、旧 `docs/assets/clip-search-favicon.png` / `docs/assets/apple-touch-icon.png` / `docs/favicon.ico` を削除。画面内のブランドマーク、入口ページ、ボタン小アイコンも `rukalun` 素材参照へ寄せた
- **2026-06-12**: `docs/assets/rukalun` の提供画像を使い、Clip検索画面のヒーロー画像とOGP画像を軽量派生画像へ差し替え。旧生成OG画像は削除し、公開ページ/入口ページ/旧URL互換ページのOGP/Twitter画像を `assets/rukalun/clip-search-og.png` に統一
- **2026-06-11**: Clip検索公開JSONの自動pushをGit更新監視とself-hosted `Auto Deploy` が検知し、Botが数分おきに自己再起動して起動時バックフィルを繰り返す問題を修正。`docs/clip-search-data.json` だけの更新ではBot内Git監視はpullのみ、`Auto Deploy` は `paths-ignore` で非起動にした。DB総件数と公開件数の差は、削除/非公開化で `unavailable_at` が入ったClipを公開JSONから除外しているため
- **2026-06-11**: GitHub Pages Clip検索画面のSP検索トグルを調整。条件概要テキストと右端の `▽` を別カラムに分け、開閉アイコンが右側に固定されるようにした
- **2026-06-11**: GitHub Pages Clip検索画面で、作成日時が3日以内のClipに `NEW` マークを表示するようにした
- **2026-06-11**: Clip同期ログでは `直近clip同期完了: saved=0` が続いていたが、GitHub Pages用 `docs/clip-search-data.json` が再生成・pushされず `Clip最終同期` が古いままになる問題を修正。`CLIP_SEARCH_AUTO_PUBLISH_ENABLED=true` で同期後に公開JSONを自動生成し、保存0件でも既定5分ごとにmainへcommit/pushするようにした
- **2026-06-11**: GitHub Pages Clip検索画面のSP表示で、上部検索条件を開閉式に変更。初期状態は折りたたみ、条件概要を表示して検索結果の縦領域を確保するようにした
- **2026-06-11**: GitHub Pages Clip検索画面用faviconを生成。`docs/assets/clip-search-favicon.png`、`docs/assets/apple-touch-icon.png`、`docs/favicon.ico` を追加し、公開3ページから参照するようにした
- **2026-06-11**: GitHub Pages Clip検索画面へOGP/Twitter Card/JSON-LD/canonical/descriptionを追加し、生成画像 `docs/assets/clip-search-og.png` をOG画像とヒーロー背景に設定。`?q=検索語` で初期検索できるようにした
- **2026-06-11**: GitHub Pages Clip検索画面へサムネイルとゲーム名表示を追加。公開JSONに `gameName` / `thumbnailUrl` を追加し、必要時は `--enrich-from-twitch` でTwitch APIから補完できるようにした
- **2026-06-11**: `docs/index.html` を公開Clip検索入口に変更し、内部仕様書は `internal-docs/twitchraid-bot-zukan.html` へ移動。旧仕様書URLもClip検索入口へ案内するだけにした
- **2026-06-11**: Clip検索画面のページ内再生を撤去し、各カードは `Twitchで見る` の外部リンクのみへ変更
- **2026-06-11**: 直近Clip同期で保存件数が0件でも同期確認できるよう、サブPCDBから `docs/clip-search-data.json` を再生成し、`JSON生成` と `Clip最終同期` を最新時刻へ更新
- **2026-06-11**: GitHub Pages Clip検索画面に古い順とお気に入り機能を追加。お気に入りはブラウザlocalStorageにClip IDと登録時刻だけ保存し、`お気に入り順` では登録が新しいお気に入りを先頭へ並べる
- **2026-06-11**: 公開予定のGitHub Pages Clip検索画面から、Bot仕様書リンク、データソース表示、内部運用説明を削除。内部仕様書からClip検索画面へのリンク導線も外した
- **2026-06-11**: GitHub Pages Clip検索画面にページ内再生を追加。各Clipカードの `ページで再生` からTwitch Clip iframeを1つのプレイヤーパネルへ読み込み、`parent` は現在ホスト名、`autoplay=false` で埋め込む
- **2026-06-11**: GitHub Pages Clip検索画面にClip最終同期時刻を追加。`clip_sync_state.recent_sync_at` を `clipSync.recentSyncedAt` として公開JSONへ出し、画面ではJSTの秒単位で表示
- **2026-06-11**: GitHub Pages用Clip検索画面 `docs/clip-search.html` を追加。サブPCのSQLite Clipキャッシュから `docs/clip-search-data.json` を生成し、タイトル/作成者名検索、作成者フィルタ、並び替え、追加表示に対応
- **2026-06-10**: `!clipsearch <キーワード>` を追加。SQLite Clipキャッシュのタイトル/作成者表示名を部分一致検索し、`clipsearch:<検索語>` 履歴で重複を避けて1件URLを返す
- **2026-06-10**: Ollama Raid挨拶文の配信情報補完を調整。AI文がゲーム名とタイトル主要部を既に含む場合は、`配信では...` の長い定型紹介文を追記せず、完全に抜けた項目だけ最小限補うよう変更
- **2026-06-09**: Ollama Raid挨拶文の採用/フォールバック理由ログを追加。冷間ロード対策として既定タイムアウトを15秒、keep_aliveを30分へ変更し、AI文がゲーム名/配信タイトルを落とした場合はコード側で補って採用するよう変更
- **2026-06-09**: 配信開始通知の二重送信を防ぐため、配信まとめスレッド保証処理が開始通知を自動再投稿しないよう変更。保存済み `startMessageId` が無い競合タイミングでは送信せず、必要時は `!streamnotify` で明示的に再送する
- **2026-06-08**: 配信終了まとめ後も開始通知スレッドをアーカイブしないよう変更。既存通知にスレッドが建っていないように見えた原因は、スレッド作成後に `archived=true` になっていたため
- **2026-06-08**: 配信開始通知を `@everyone` 付きDiscord Embedへ変更。タイトル、ゲーム名、視聴者数、Twitchプレビュー画像をEmbedに入れ、Bot API/Webhookどちらの投稿でも同じ見た目になるようにした
- **2026-06-08**: Ollama Raid挨拶文をコード側で250文字以内へ制限。プロンプトから `250文字以内` の数値指示を外し、モデルが文字数を人数として誤読するリスクを下げる
- **2026-06-08**: Ollama Raid挨拶文の低人数ネガティブ表現を禁止。AI入力からRaid人数を外し、`人数少なかった` / `少人数` / `寂しい` 系の生成文は採用せず固定Raid挨拶文へフォールバックする
- **2026-06-08**: Ollama Raid挨拶文を紹介文として強化。AI文にゲーム名と配信タイトルが含まれない場合は採用せず、何をして遊んでいたかが手短に分かる文だけを使う
- **2026-06-07**: Raid時の挨拶文をOllamaで生成する任意機能を追加。`OLLAMA_SHOUTOUT_ENABLED=true` と `OLLAMA_SHOUTOUT_MODEL` 設定時だけ、サブPC上のOllama APIへ1通のRaid挨拶文を依頼し、失敗時は固定Raid挨拶文へフォールバックする。生成文は `@ユーザー名` とURLを保証し、絵文字は除去する
- **2026-06-07**: 配信開始通知直後のスレッド補完で、保存済み `startMessageId` からスレッド作成に失敗しても同じ開始処理内では開始通知を投稿し直さないよう修正。クリップ/終了まとめ前の保証処理では従来どおり必要時のみ再投稿する
- **2026-06-06**: ソース側の性能レビュー反映として、通常コメント1件ごとの配信まとめstate JSON同期書き込みを廃止。`StreamSummaryCountBuffer` で30秒デバウンスし、Raid/停止/配信終了時は即時flushするよう変更
- **2026-06-06**: GitHub Pagesの仕様書を `docs/index.html` に一本化し、`docs/typescript-bot-spec.html` は統合先への案内ページへ変更。図解中心のTypeScript版総合仕様書として、配信通知、Clip同期、Raid情報、shoutoutキュー、Boom集計、フォールバック、品質ゲートを追記
- **2026-06-06**: PM2プロセス名の記述を本番運用に合わせて `twitchRaid` に統一
- **2026-06-06**: 配信開始通知が漏れた時の復旧用に、管理者限定の `!streamnotify` コマンドを追加
- **2026-06-06**: 配信開始通知へ `🔴 配信URL: https://www.twitch.tv/rukalun` の表示を復元
- **2026-06-06**: サブPC本番ログで配信開始通知が `Discord bot message failed: 403` により停止していたことを確認。`DISCORD_WEBHOOK_URL` が設定済みだったため、配信開始通知・配信終了まとめ・配信中クリップ投稿でBot API失敗時にWebhookへフォールバックするよう修正
- **2026-06-02**: 配信終了まとめを追加。配信中状態をJSONに保持し、再起動後も未投稿まとめを復元してDiscordへ再試行。クリップはまとめメッセージのDiscordスレッドへ投稿可能
- **2026-06-02**: フォーラム/メディアチャンネルWebhook向けに、Bot Tokenなしで `thread_name` から配信まとめスレッドを作るWebhook-onlyモードを追加
- **2026-06-03**: Bot Token方式を配信開始通知スレッド化へ変更。配信開始通知から作成したスレッドへ、配信終了まとめとクリップを投稿
- **2026-06-03**: 再起動時に同一タイトルで開始通知がスキップされても、配信まとめstateにスレッドIDがなければ開始通知メッセージからスレッド作成を補完するよう修正
- **2026-06-03**: Discordへ投稿する配信開始通知と配信終了まとめから、配信URL行を一度削除（2026-06-06に開始通知の配信URL行を復元済み）
- **2026-06-03**: 配信中の新規クリップを1分ごとの直近同期で検知して配信まとめスレッドへ随時投稿するよう変更
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
- **2026-05-25**: 初コメ保存と `!firstcomment` を削除。当時の `!clip` / `!myclip` を高速ページング最大1000件へ変更（現行のコマンド実運用フォールバックは最大200件）
- **2026-05-25**: `!clip` / `!myclip` を日付窓ページング取得へ変更し、表示履歴で重複をなるべく回避
- **2026-05-25**: ユーザー別初コメを SQLite に保存し、`!firstcomment` 本人表示を追加。過去アーカイブ抽出は無効化
- **2026-05-11**: `!shoutout <ユーザー名>` デバッグコマンドと権限設定 `SHOUTOUT_ADMIN_USERS` を追加
- **2026-05-11**: shoutout修正を `main` に反映。Git更新後の build と再起動クールダウン時の注意を追記
- **2026-05-11**: レイド自動シャウトアウトを Bot/Moderator ユーザーコンテキストで実行するよう修正
- **2026-03-22**: TypeScript移植 + PM2管理対応（v2.0）
- **2026-03-22**: 仕様ドキュメント作成（docs/ディレクトリに4ファイル追加）
- **2026-03-21**: パフォーマンスチューニング＆コードレビュー修正
