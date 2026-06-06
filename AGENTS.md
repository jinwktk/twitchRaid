# Repository Guidelines

## プロジェクト構成とモジュール配置
- `main.py`: Twitch 配信監視と Discord 通知を統括するエントリーポイント。Bot 設定、ログ収集、Git 自動更新を内包。
- `clip_selector.py`: クリップ一覧取得と、必要に応じた作成者絞り込み後のランダム選択を担当。
- `command_cooldown_state.py`: `clip` / `myclip` のクールダウン時刻をコマンド別に管理。
- `manga_selector.py`: DLsite がるまに日間ランキングから作品タイトルを抽出し、ランダム選択するロジックを担当。
- `manga_command_control.py`: `manga` コマンドの管理者判定と ON/OFF フラグ変換を担当。
- `chat_message_response.py`: `send_chat_message` の返却値から `message_id` を取り出す検証ロジックを担当。
- `message_delete_tracker.py`: `ctx.send` フォールバック時の削除予約（message_id突合）を担当。
- `auth_scope_sets.py`: 実行時必須スコープと再認可要求スコープ（manga削除用追加分）を定義。
- `scope_policy.py`: 付与済みスコープから不足スコープ判定・適用スコープ解決・ログ表示用正規化を担当。
- `token_refresh_policy.py`: 高度トークンリフレッシュ失敗時にフォールバック実行可否を判定するロジックを担当。
- `process_restart.py`: 同一コンソール内でのプロセス再起動と、`execv` 失敗時フォールバック起動を担当。
- `src/commands/shoutout.ts`: TypeScript版のレイド自動シャウトアウトと `!shoutout` 手動デバッグコマンドの権限判定・対象ユーザー正規化を担当。Twurple の `asUser` で Bot/Moderator ユーザーコンテキストへ切り替えて実行する。
- `src/commands/boom.ts`: TypeScript版 `!boom` の集計ロジック。過去30日間のアーカイブ配信を Twurple Helix で取得し、Twitch GraphQL の VOD チャプターからゲーム別トータル時間と総配信時間を算出する。
- `src/commands/clip.ts`: TypeScript版 `!clip` / `!myclip` の選択ロジックを担当。通常はSQLiteキャッシュから即選択し、キャッシュ未準備時のみ軽いAPIフォールバックを使う。
- `src/commands/clip-cache-store.ts`: クリップ本体、走査済み期間、削除/非公開化でTwitch APIから返らなくなったClipの無効化状態、`!clip` / `!myclip:<ユーザー>` ごとの表示履歴を `data/clips.sqlite` に保存する。
- `src/commands/clip-cache-sync.ts`: 起動後の全期間バックグラウンド走査、完了済み期間スキップ、直近1時間の定期同期、直近同期完了後コールバック、配信していない時間の1日1回全期間再走査を担当。
- `src/streams/stream-summary.ts`: 配信終了まとめの表示文言作成、Discord Bot API/Webhook投稿、開始通知/まとめメッセージからのスレッド作成、ライブクリップURL投稿、終了時スレッドクローズを担当。
- `src/streams/stream-summary-state-store.ts`: 配信中/投稿待ち/投稿済みのまとめ状態を `data/stream-summary-state.json` へ保存し、再起動後の復元を担当。
- `logs/`: 日次ローテーション済みログを保存。調査時は最新ファイル `bot_YYYY-MM-DD.log` を参照。
- `requirements.txt`: 最低限の依存関係。仮想環境 `venv/` にインストール。
- `.env` (未コミット想定): Twitch と Discord の認証情報および内部ステート (`LAST_CLIP_TIME` 等) を保持。
- `CLAUDE.md` と `AGENTS.md`: 作業手順と変更履歴を日次で更新し、ドキュメントの重複を避ける。
- `tests/test_clip_selector.py`: クリップ選択ロジック（作成者絞り込み含む）のユニットテスト。
- `tests/test_command_cooldown_state.py`: コマンド別クールダウン独立性のユニットテスト。
- `tests/test_manga_selector.py`: DLsiteランキングHTMLからのタイトル抽出とランダム選択のユニットテスト。
- `tests/test_manga_command_control.py`: `manga` 管理者判定と ON/OFF フラグ変換のユニットテスト。
- `tests/test_chat_message_response.py`: `send_chat_message` 返却値の `is_sent` / `message_id` 検証ユニットテスト。
- `tests/test_message_delete_tracker.py`: `ctx.send` フォールバック時の削除予約一致判定ユニットテスト。
- `tests/test_auth_scope_sets.py`: 実行時必須スコープと再認可スコープ集合の妥当性テスト。
- `tests/test_scope_policy.py`: 不足スコープ判定ロジックのユニットテスト。
- `tests/test_token_refresh_policy.py`: トークンリフレッシュ失敗時のフォールバック判定テスト。
- `tests/test_process_restart.py`: 同一コンソール再起動とフォールバック経路のユニットテスト。
- `tests/commands/shoutout.test.ts`: TypeScript版シャウトアウトが Bot/Moderator ユーザーコンテキストで実行されること、手動コマンド権限判定、対象ユーザー名正規化を検証。
- `tests/commands/boom.test.ts`: TypeScript版 `!boom` のVODチャプター抽出、ゲーム別合算、1時間未満フィルタ、表示文言を検証。
- `tests/commands/clip.test.ts`: TypeScript版クリップ取得のAPIフォールバック、履歴回避、`myclip` の作成者フィルタを検証。
- `tests/commands/clip-cache-store.test.ts`: クリップSQLiteキャッシュ、履歴上限、走査済み期間、削除済みClipの無効化と候補除外を検証。
- `tests/commands/clip-cache-sync.test.ts`: クリップ全期間走査用の日付窓、直近同期、完了済み期間スキップ、日次再走査の配信中スキップと削除済みClip無効化を検証。
- `tests/streams/stream-summary.test.ts`: 配信終了まとめの整形、Discordスレッドへのライブ/終了時クリップ投稿、開始通知スレッド補完、終了時スレッドクローズ、投稿途中再開時の重複回避を検証。
- `tests/streams/stream-summary-state-store.test.ts`: 配信まとめ状態JSONの保存・復元・投稿済み更新を検証。
- `tests/notifications/discord-webhook.test.ts`: Discord Webhookの `wait` / `thread_id` 付与、Bot Tokenによるメッセージ投稿、メッセージスレッド作成、スレッドアーカイブを検証。
- `tests/git-manager.test.ts`: TypeScript版Git更新検知がpull/build後にクールダウンを挟まずPM2再起動をトリガーすることを検証。

## ビルド・テスト・開発コマンド
- `python -m venv venv && source venv/bin/activate`: Linux/Mac の仮想環境作成と有効化。Windows は `venv\Scripts\activate` を使用。
- `pip install -r requirements.txt`: 依存パッケージをローカル環境に導入。
- `python main.py`: Bot を前景で起動。手動停止時は `Ctrl+C`。
- `pytest -q`: テストが追加された後の標準実行。CI 導入前でもローカルで失敗確認を徹底。
- `npm test`: TypeScript版の Vitest ユニットテストを実行。
- `npm run build`: TypeScript版を `dist/` へビルドし、型エラーを確認。
- Node.js は `node:sqlite` を使用するため 22.5 以上が必要。

## 運用ルール
- Botは主にサブPCで稼働するため、ログ確認依頼ではローカル作業PCだけで判断しない。必ずサブPC側のPM2ログ、`logs/bot_YYYY-MM-DD.log`、関連するSQLite DB（例: `data/clips.sqlite`）の有無と更新時刻を確認する。

## コーディングスタイルと命名規約
- Python 3 系、PEP 8 準拠、インデントはスペース 4 個。関数名・変数名は `snake_case`、クラス名は `PascalCase`。
- Docstring は日本語で要約 → 実装ノートの順に記述。外部 API 名は英語表記を保持。
- フォーマッタは未バンドル。`pip install black isort` 後に `black .` と `isort .` を推奨。ログメッセージは INFO 基調で事実を簡潔に記録。

## テスト指針
- 新機能はまず `tests/` 配下に `test_<機能>.py` を作成し、期待値を `pytest` 形式で定義。
- Twitch や Discord など外部依存は `unittest.mock` または `pytest-mock` を用いてスタブ化。実トークンは `.env` から分離。
- エッジケース: トークン期限切れ、API エラー、ログファイル書き込み失敗などを必ず網羅。
- カバレッジ 80% 以上を目安。足りない場合はリファクタリング前に欠落分のテストを追加。

## コミットとプルリク運用
- コミットメッセージは 50 文字以内を目標に日本語サマリ。先頭に対象範囲 → 動作動詞 (`ログローテーション改善`, `テスト追加` など) を配置。
- コミット前に `README.md` と `AGENTS.md` を更新し、TDD の各段階でこまめに履歴を残す。意図しない差分があれば `git status` で確認。
- PR には目的、手順、検証結果、影響範囲を箇条書きで記述。ログ添付やスクリーンショットがある場合はリンク化。
- main へ直接 push しない。レビュー向けには小さな論理単位でブランチを切り、CI テスト (将来導入) の結果を添付。

## 設定とセキュリティ Tips
- `.env` には `TWITCH_CLIENT_ID`, `TWITCH_SECRET_TOKEN`, `TWITCH_ACCESS_TOKEN`, `TWITCH_REFRESH_TOKEN`, `TWITCH_BROADCASTER_ID`, `TWITCH_MODERATOR_ID`, `DISCORD_WEBHOOK_URL`, `LAST_CLIP_TIME`, `LAST_MYCLIP_TIME`, `MANGA_COMMAND_ENABLED`, `MANGA_ADMIN_USERS`, `SHOUTOUT_ADMIN_USERS`, 任意で `TWITCH_GQL_CLIENT_ID` を定義。更新は `Config.update_*` が担当。
- クリップキャッシュは任意で `TWITCH_CLIP_CACHE_DB_PATH` を使用。未設定時は `data/clips.sqlite` を使い、ローカル状態として Git 管理外。
- Clip全期間バックフィルは通常起動時は完了済み期間をスキップする。配信していない時間に1日1回だけ全期間を再走査し、Twitch APIから返らなくなったClipは `clip_cache.unavailable_at` を設定して `!clip` / `!myclip` / 配信まとめ候補から除外する。再走査の最終時刻は `clip_sync_state.daily_reconcile_at` に保存する。
- 配信まとめ状態は任意で `STREAM_SUMMARY_STATE_PATH` を使用。未設定時は `data/stream-summary-state.json` を使い、ローカル状態として Git 管理外。
- 配信まとめスレッド作成と投稿には `DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` を使う。Bot Token方式では開始通知、クリップURL、終了まとめをBot APIで投稿し、配信開始通知メッセージからスレッドを作る。未設定時や403などのBot API投稿失敗時は通常Webhook投稿へフォールバックする。
- Webhookだけで配信まとめスレッドを作る場合は、Webhook先をフォーラム/メディアチャンネルにし、`DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED=true` を設定する。通常テキストチャンネルWebhookではDiscord側が `thread_name` を拒否するため、通常Webhook投稿へフォールバックする。
- 機密情報は commit しない。漏洩した場合は Twitch/Discord のパネルから速やかに再発行し、`env_store.update_env_file` で反映。
- `.env` 更新前に `.env.bak` を作成し、空ファイル化を検出した場合はバックアップから復旧して追記。
- `logs/` は利用後にアーカイブか削除。容量監視は `du -sh logs` と `find logs -mtime +30 -delete` (必要に応じて) で対応。

## 2026-06-06 作業ログ
- 不具合報告: 配信通知が止まっている
- 本番確認: サブPC `192.168.0.99` のPM2では `twitchRaid` が online、PID `6788`、uptime `3h`、restart `76`。リポジトリは `main...origin/main` で `61c6630 manga管理者設定を記録`、未追跡は `.env.bak-manga-admin-20260603190856` のみ
- 本番ログ: `E:\GitHub\twitchRaid\logs\bot_2026-06-06.log` で 2026-06-06 10:06:27 に配信開始を検知後、10:06:28 に `Discord bot message failed: 403` で配信タイトル通知が失敗。配信終了まとめも同じ403で再試行を繰り返していた
- 本番状態: `data/stream-summary-state.json` は `status=active`、`streamId=316055131251`、`threadId` / `startMessageId` 未保存。`DISCORD_WEBHOOK_URL`、`DISCORD_BOT_TOKEN`、`DISCORD_SUMMARY_CHANNEL_ID` はすべて設定済み
- 原因: Bot Token方式を優先する実装で、Bot API投稿が403になった場合に既存Webhookへフォールバックせず、配信開始通知・配信まとめ投稿が停止していた
- TDD: `tests/streams/stream-summary.test.ts` に、Bot API投稿が403相当で失敗した場合に配信開始通知、配信終了まとめ、配信中クリップ投稿をWebhookへフォールバックするテストを追加し、未実装失敗を確認
- 実装: `src/streams/stream-summary.ts` でBot API投稿失敗時に `DISCORD_WEBHOOK_URL` があれば通常Webhook投稿へフォールバックするよう修正。Webhookへフォールバックした開始通知/まとめではBotスレッド作成を無理に続行しない
- 検証: `npm test -- --run tests/streams/stream-summary.test.ts` 16件、`npm test` 110件、`npm run build`、`npm run lint` が通過

## 2026-06-03 作業ログ
- 不具合報告: にめいやアカウントで `!mangaon` が実行できなくなった
- 原因: サブPC本番 `.env` に `MANGA_ADMIN_USERS` が存在せず、TypeScript版の既定値 `rukalun` のみが管理者扱いになっていた。`mangaon` / `mangaoff` はTwitch表示名ではなくログイン名で照合するため、にめいやは `nyme_ia` 登録が必要
- 対応: サブPC `E:\GitHub\twitchRaid\.env` をバックアップ後、`MANGA_ADMIN_USERS=rukalun,nyme_ia` を追加し、`pm2 restart twitchRaid --update-env` で反映。`.env.bak-manga-admin-20260603190856` を作成
- 確認: 本番 `.env` に `MANGA_COMMAND_ENABLED=false` と `MANGA_ADMIN_USERS=rukalun,nyme_ia` があること、PM2 `twitchRaid` が online で起動したことを確認

- 要望: `!boom` の表示文言が長く棒読みが暴走するため、読み上げスキップ用に返却文言の先頭へ `!` を付けたい
- TDD: `tests/commands/boom.test.ts` の `formatBoomSummary` 期待値を成功時・対象ゲームなし時ともに `!過去30日間...` へ変更し、未実装失敗を確認
- 実装: `src/commands/boom.ts` の `formatBoomSummary` で作る prefix を `!過去...` に変更し、集計ロジックは変更しない
- ドキュメント: `README.md` のBoomコマンドメモへ、長文読み上げ回避のため返却文頭に `!` を付ける仕様を追記
- 検証: `npm test -- --run tests/commands/boom.test.ts` 11件が通過

- 不具合報告: `!boom` が直近20配信集計へ戻っており、過去30日間集計からデグレしていた
- 原因: `a29611d boom集計を30日間へ変更` で導入した `lookbackDays` / `creationDate` / `totalStreamSeconds` が、後続の配信まとめ系変更後の `main` で20配信版に戻っていた
- TDD: `tests/commands/boom.test.ts` を30日仕様へ戻し、過去30日以内のVODのみ集計、古いVODで打ち切り、総配信時間表示を期待して失敗を確認
- 実装: `src/commands/boom.ts` を過去30日間集計へ戻し、`BoomSummary` に `lookbackDays` と `totalStreamSeconds` を復元。`formatBoomSummary` も「過去30日間の総配信時間 ...」表示へ戻した
- 検証: `npm test -- --run tests/commands/boom.test.ts` 11件が通過

- 要望: 削除されたClipが全期間バックフィルでどう扱われるか確認し、配信していない時間に1日1回再走査して削除済みClipを反映したい
- 調査: 既存の `saveClips` はUPSERTのみで、完了済み `clip_scan_windows` はスキップされるため、Twitch側で削除/非公開化されたClipは `data/clips.sqlite` に残り続け、`!clip` や配信まとめ候補に出る可能性があった
- TDD: `tests/commands/clip-cache-store.test.ts` に欠落Clipの無効化、無効Clipの候補除外、再発見時の復帰テストを追加し、未実装失敗を確認
- TDD: `tests/commands/clip-cache-sync.test.ts` に完了済み期間の再走査、配信中スキップ、1日1回制御のテストを追加し、未実装失敗を確認
- 実装: `clip_cache` に `last_seen_at` と `unavailable_at` を追加し、再走査で返らなかったClipを無効化、Twitch APIで再び返ったClipは自動で有効化するよう変更
- 実装: `selectRandomClip` と `listClipsCreatedBetween` は `unavailable_at IS NULL` のClipだけを候補にするよう変更
- 実装: `ClipCacheSynchronizer.runDailyReconcileIfDue` を追加し、配信中はスキップ、オフライン時のみ `daily_reconcile_at` から24時間以上経過していれば全期間再走査するよう変更
- 実装: `src/bot.ts` の配信状態監視でオフライン確認時に日次再走査を呼び、同期器のタイマーにも1時間ごとの期日チェックを追加
- 検証: `npm test -- --run tests/commands/clip-cache-store.test.ts tests/commands/clip-cache-sync.test.ts` 14件が通過

## 2026-06-02 作業ログ
- 要望: 配信まとめは良かったので、クリップをDiscordスレッドへ投稿し、Bot再起動後も配信まとめが確実に投稿されるよう情報を保持したい
- 調査: 既存TypeScript版は配信開始通知とコメント数永続化はあるが、配信終了まとめ・まとめ用状態ストア・Discordスレッド作成処理は未実装だった
- 方針: 配信中の stream id / タイトル / ゲーム名 / 開始時刻 / コメント数 / Raid数を `data/stream-summary-state.json` に保存し、配信終了または再起動後のオフライン検知時に保存済み状態からまとめ投稿する
- TDD: `tests/notifications/discord-webhook.test.ts`、`tests/streams/stream-summary-state-store.test.ts`、`tests/streams/stream-summary.test.ts`、`tests/commands/clip-cache-store.test.ts` に期待動作を追加し、未実装失敗を確認
- 実装: `src/streams/stream-summary-state-store.ts` を追加し、active / pending / posted 状態、投稿済みまとめID、スレッドID、投稿済みクリップIDをJSON保存できるようにした
- 実装: `src/streams/stream-summary.ts` を追加し、配信終了まとめの整形、Webhook `wait=true` 投稿、Discord Bot Tokenによるメッセージスレッド作成、スレッドへのクリップURL投稿、投稿済みクリップ重複回避を実装
- 実装: `src/notifications/discord-webhook.ts` に戻り値ありのWebhook実行と、Discord REST APIでまとめメッセージからスレッドを作る関数を追加
- 実装: フォーラム/メディアチャンネルWebhook向けに、`thread_name` でWebhookだけのスレッド作成を試す経路を追加。通常チャンネルで拒否された場合は通常Webhook投稿へフォールバック
- 実装: `ClipCacheStore.listClipsCreatedBetween` を追加し、配信開始から終了までのクリップを視聴数降順で抽出できるようにした
- 実装: `src/bot.ts` で配信開始時にまとめ状態を保存し、通常コメント/Raidで状態を更新、配信終了時または再起動後のオフライン検知時にまとめ投稿を再試行するよう変更
- 追加実装: Bot Token方式では配信終了時ではなく配信開始通知メッセージからスレッドを作成し、保存済み `threadId` へ配信終了まとめとクリップURLを投稿するよう変更
- 実地検証: テストチャンネル `1201193604731904030` で、開始通知 message `1511624974907998248` からスレッド `1511624974907998248` / `配信まとめテスト-878941` を作成し、終了まとめ message `1511624977747677264` とクリップ message `1511624979005964328` をスレッド投稿できることを確認
- 追加修正: 再起動時に現在配信中のstateへ `threadId` が無いケースを確認。同一タイトルで開始通知がスキップされても、保存済み開始通知メッセージIDがあればスレッド作成だけを再試行し、無ければ開始通知を1回投稿して `threadId` を保存するよう補完した
- 表示調整: Discordへ投稿する配信開始通知と配信終了まとめから配信URL行を削除し、タイトル・配信統計・クリップ中心の表示にした
- 追加実装: 直近クリップ同期を1分間隔に変更し、同期完了時に配信中stateの未投稿クリップを配信まとめスレッドへ投稿して `postedClipIds` に保存するよう変更
- 追加実装: 配信終了時は最終クリップ同期後に未投稿クリップを先にスレッドへ投稿し、終了まとめ投稿後にBot Tokenでスレッドをアーカイブして閉じるよう変更
- 追加実装: 配信まとめ系の開始通知、ライブクリップ、終了まとめ投稿をWebhook優先からBot API優先へ変更。`DISCORD_BOT_TOKEN` と `DISCORD_SUMMARY_CHANNEL_ID` があれば `DISCORD_WEBHOOK_URL` なしで投稿できるようにした
- 設定: `STREAM_SUMMARY_STATE_PATH`、`STREAM_SUMMARY_MAX_CLIPS`、`DISCORD_BOT_TOKEN`、`DISCORD_SUMMARY_CHANNEL_ID`、`DISCORD_SUMMARY_WEBHOOK_THREAD_ENABLED` を追加。Discordスレッド作成に必要な設定がない場合は通常Webhook投稿へフォールバック
- 検証: `npm test` 102件、`npm run build`、`npm run lint`、`python -m pytest -q` 106件が通過

## 2026-05-31 作業ログ
- 要望: Git更新時にPM2再起動がかかる設定へ戻したい
- 原因: TypeScript版 `GitManager.checkForUpdates` / `pullAndRestartIfUpdated` が、更新後も `restartWithCooldown` を通っていたため、24時間再起動クールダウン中は `restartPending=true` で保留され、pull/build後も実行プロセスが旧コードのままだった
- TDD: `tests/git-manager.test.ts` を追加し、Git更新後は `shouldRestart` を呼ばず `restartProcess` が直接呼ばれること、`restartPending` が残らないことを先に定義して失敗を確認
- 実装: `GitManager.restartAfterUpdate` を追加し、Git更新後は `last_restart.txt` を現在時刻へ更新してから即 `restartProcess()` を呼ぶよう変更。定期再起動の `restartWithCooldown` は維持
- 運用: `.env.backup` とAutopilot状態 `.omx/` をGit管理外へ追加

## 2026-05-30 作業ログ
- 要望: `!boom` で最近配信したゲームとトータル時間を表示し、統計対象は1時間以上遊んだものにしたい
- 方針: Twitch Helix のVOD一覧だけではゲーム名が取れないため、直近20本のアーカイブ配信を Twurple `getVideosByUserPaginated(..., { type: "archive" })` で取得し、各VODの Twitch GraphQL チャプターからゲーム区間を集計する
- TDD: `tests/commands/boom.test.ts` を追加し、GraphQL moments のゲーム名/時間抽出、時間欠損時の区間推定、ゲーム別合算、1時間未満フィルタ、表示文言を先に定義して未実装失敗を確認
- 実装: `src/commands/boom.ts` を追加し、ゲーム別合計時間が1時間以上のものを合計時間降順・最大6件で整形するよう実装
- 実装: `src/bot.ts` に `!boom` を追加し、取得失敗時はチャットへ失敗メッセージを返すようにした
- 設定: `src/config.ts` に任意の `TWITCH_GQL_CLIENT_ID` を追加し、未設定時はTwitch Webの公開Client-IDを使うようにした
- 検証: `npm test -- --run tests/commands/boom.test.ts`、`npm run build`、`npm run lint` が通過
- 不具合報告: `!boom` が「最近配信したゲーム時間の取得に失敗しました」を返す
- 原因: サブPCログで `Twitch GraphQL request failed: 400` を確認。通常のTwitch Client-ID / 古い `TWITCH_GQL_CLIENT_ID` が `https://gql.twitch.tv/gql` で拒否され、さらに手書きGraphQLクエリの `GameChangeMoment` 型も現行スキーマに合っていなかった
- 修正: `!boom` のGraphQL取得をTwitch persisted queryへ変更し、Twitch Webの公開Client-IDへ自動フォールバックするよう修正
- 修正: VODチャプターが空の単一ゲーム配信では、`VideoMetadata` の `game` と `lengthSeconds` を使って配信全体をそのゲーム時間として集計するよう変更
- 検証: サブPC上の実VOD 3件で `FINAL FANTASY XIV ONLINE:27615` 秒が取得できることを確認。`npm test` 75件、`npm run build`、`npm run lint`、`python -m pytest -q` 106件が通過
- 改善要望: `!boom` の取得までに時間がかかった
- 修正: `buildBoomSummary` をVOD単位で最大4本並列取得する方式に変更し、初回取得の待ち時間を短縮
- 修正: `BoomSummaryCache` を追加し、Bot内で `!boom` 結果を5分間メモリキャッシュして再実行時は即時応答できるようにした
- TDD: `tests/commands/boom.test.ts` にVOD並列取得とキャッシュTTLのテストを追加し、失敗確認後に実装
- 検証: `npm test -- --run tests/commands/boom.test.ts` 11件、`npm run build`、`npm run lint` が通過

## 2026-05-29 作業ログ
- ログ調査: サブPC `192.168.0.99` のPM2状態を確認し、`twitchRaid` は `online`、PID `1152`、uptime `16h`、restart `26`、PM2 error log は空であることを確認
- ログ調査: サブPC `E:\GitHub\twitchRaid\logs` の最新ログは `bot_2026-05-29.log` / `bot_2026-05-28.log`。直近は5分ごとの「直近clip同期完了: saved=0」と2時間ごとのトークンリフレッシュ成功ログが中心で、未捕捉例外や権限エラーは確認できず
- ログ調査: `data/clips.sqlite` は `2026-05-29 00:01:06` 更新、`clip_cache` 2736件、`clip_scan_windows` 129件すべて `completed`、`clip_history` 15件を確認。保存済みクリップ範囲は `2016-08-18T03:42:35.000Z` から `2026-05-26T15:32:18.000Z`
- 注意点: ログ本文の一部が文字化けしているため、サブPCのPM2/PowerShell出力文字コード設定は別途改善余地あり

## 2026-05-25 作業ログ
- ログ確認: サブPC `192.168.0.99` のPM2状態、`E:\GitHub\twitchRaid\logs\bot_2026-05-25.log`、`data/clips.sqlite` を確認。`twitchRaid` は online、`clip_cache` は 2734 件、`clip_scan_windows` は 124 件で全期間バックフィル完了を確認
- 不具合発見: `!myclip` はログイン名 (`nyme_ia`) でキャッシュ検索する一方、Twitch API由来のキャッシュは表示名 (`にめいや`) を `creator_name_lower` に保存していたため、SQLiteキャッシュに当たらずAPIフォールバックしていた
- 修正: `resolveClipCreatorId` を公開し、`!myclip` のキャッシュ検索前にTwitchユーザーIDを解決して `creator_id` でSQLite検索できるよう変更
- TDD: `tests/commands/clip.test.ts` に、`selectCachedClip` が解決済み `creatorId` を `ClipCacheStore.selectRandomClip` に渡すテストを追加し、失敗確認後に実装
- 運用ルール追加: ログ確認依頼では常にサブPC側のPM2ログ、日次Botログ、関連SQLite DBの有無と更新時刻を確認する方針を `readme.md` と `AGENTS.md` に追記
- 要望: Qiita記事の GraphQL 方式を使い、過去アーカイブから初コメの日時・内容をSQLiteへ保存し、今後の配信ではリアルタイムに初コメを保存して出力したい
- 調査: Qiita記事は Twitch公式 Helix ではなく `https://gql.twitch.tv/gql` の `VideoCommentsByOffsetOrCursor` を使う方式で、記事内にも公式推奨ではない旨があるため、VOD取得部分を `src/first-comment/vod-comments-client.ts` に隔離
- TDD: `tests/first-comment/` に SQLite保存、VOD先頭コメント抽出、バックフィル集計、チャット表示文言のテストを先に追加し、未実装による失敗を確認
- 実装: `src/first-comment/first-comment-store.ts` を追加し、`first_comments` テーブルへ stream key / stream id / video id / タイトル / コメント日時 / 投稿者 / 本文 / source を保存
- 実装: `src/first-comment/first-comment-backfill.ts` を追加し、Twurple の `getVideosByUserPaginated(..., { type: "archive" })` から全アーカイブを走査して、各VODの先頭コメントのみ保存
- 実装: `src/bot.ts` に `!firstcomment` と `!firstcommentbackfill` を追加。バックフィルは broadcaster / mod / `SHOUTOUT_ADMIN_USERS` のみ実行可能
- 実装: 今後の配信では `ChatClient.onMessage` の通常コメント受信時に、現在の Twitch stream id ごとに最初の1件だけ SQLite へ保存
- 実装: 配信監視を起動直後にも実行し、配信開始済みの状態でBotを起動した場合でも stream id / 開始時刻を早めに取得するよう変更
- 設定: `TWITCH_FIRST_COMMENT_DB_PATH` と `TWITCH_GQL_CLIENT_ID` を任意設定として追加し、既定DBを `data/first_comments.sqlite` に設定。SQLite DB は Git 管理外
- 環境: `node:sqlite` 使用のため Node.js 要件を 22.5 以上へ更新
- 検証: `npm test -- --run tests/first-comment` で 8 件すべて通過。`npm run build` 通過
- 追加要望: `firstcommentbackfill` コマンド不要で、Bot起動時に1回だけアーカイブから初コメを取得したい。大量アーカイブ向けに並列処理し、取得済みアーカイブは再取得しないようにしたい
- 追加要望: `!firstcomment` は実行者本人の初コメだけを取得したい
- 追加要望: 旧実装で保存された「配信ごとの先頭コメント」は削除したい
- 修正: 保存対象を「配信ごとの先頭コメント」から「ユーザーごとの、このチャンネルで確認できた最古コメント」へ変更
- 修正: `vod-comments-client.ts` を VOD先頭1件取得からページングによる全コメント取得へ変更
- 修正: `first-comment-backfill.ts` をVOD単位の並列ワーカー方式に変更し、`archive_comment_backfill_status` で `completed` / `no_comments` を処理済みとしてスキップ
- 修正: `src/bot.ts` は起動時に `runStartupFirstCommentBackfill` を fire-and-forget で1回だけ実行し、`firstcommentbackfill` チャットコマンドを削除
- 修正: `!firstcomment` はコマンド実行者のログイン名で `user_first_comments` を検索し、他ユーザー指定は受け付けない
- 修正: ライブコメント受信時は各ユーザーの初回コメントのみ保存し、後からアーカイブでより古いコメントが見つかった場合は最古日時へ更新
- 修正: `FirstCommentStore` 初期化時に旧 `first_comments` テーブルを空にして、配信先頭コメントを新仕様に混ぜない
- 設定: `FIRST_COMMENT_BACKFILL_CONCURRENCY` を追加し、既定並列数を8に設定
- 検証: `npm test -- --run tests/first-comment` で 11 件すべて通過、`npm test` で 62 件すべて通過、`npm run build` / `npm run lint` / `python -m pytest -q` 通過
- 追加要望: 全アーカイブを走査したい
- 修正: `FIRST_COMMENT_FORCE_FULL_RESCAN` を追加し、未設定時は次回起動で処理済みVODも含めて全走査する。成功後は `.env` を `false` へ更新し、以後は通常の取得済みスキップ動作へ戻る
- 追加判断: 過去配信からのコメント抽出は使わない
- 修正: `FIRST_COMMENT_ARCHIVE_BACKFILL_ENABLED` を追加し、既定OFFへ変更。Bot起動時はアーカイブバックフィルを起動せず、ライブコメントのみ保存
- 修正: `FirstCommentStore` 初期化時に `source='archive'` のユーザー初コメと `archive_comment_backfill_status` を削除し、アーカイブ由来の誤データを `!firstcomment` に出さない
- 検証: `npm test` で 64 件すべて通過、`npm run build` / `npm run lint` / `python -m pytest -q` 通過
- 要望: `!clip` と `!myclip` が毎回同じクリップに見えるため、同じものをなるべく出さず、クリップ全件からピックアップされているか確認したい
- 調査: 旧 `src/commands/clip.ts` は `!clip` が `getClipsForBroadcaster(... limit: 100)` の上位100件のみ、`!myclip` がページング最大500件で打ち切りだった。Twitch API は単一クエリのページング結果が約1000件で頭打ちになるため、全体寄せには日付範囲分割が必要
- TDD: `tests/commands/clip.test.ts` と `tests/commands/clip-history.test.ts` を追加し、ページング日付窓、直近履歴回避、`myclip` 作成者フィルタ、履歴永続化の期待値を先に定義
- 実装: `src/commands/clip.ts` を日付窓ごとの `getClipsForBroadcasterPaginated` 取得へ変更。既定30日単位で取得し、1窓が多すぎる場合は半分へ再分割して単一クエリ上限の偏りを抑制
- 実装: `src/commands/clip-history.ts` を追加し、`!clip` 全体と `!myclip:<ユーザー>` ごとに直近200件の表示済みクリップIDを保存。全候補が履歴内の場合だけ再候補化
- 実装: `src/bot.ts` でクリップ送信後に履歴を記録し、選択時に履歴を渡すよう変更。`src/config.ts` に `TWITCH_CLIP_HISTORY_PATH` を追加
- ドキュメント更新: `readme.md` にクリップ取得範囲、API制約、履歴ファイルを追記
- 検証: `npm test` で 71 件すべて通過、`npm run build` / `npm run lint` / `python -m pytest -q` 通過
- 要望: 初コメ保存を削除し、`!clip` / `!myclip` が30秒程度かかる問題を解消したい
- 原因: 日付窓ごとの全期間ページングをコマンド実行時に毎回行っていたため、チャット応答として重すぎた
- 実装: `src/bot.ts` から通常コメント受信時の初コメ保存、起動時バックフィル、`!firstcomment` コマンド、初コメDB close を削除
- 実装: `src/first-comment/` と `tests/first-comment/` を削除し、`src/config.ts` から `TWITCH_FIRST_COMMENT_DB_PATH` / `FIRST_COMMENT_*` 設定を削除
- 実装: `src/commands/clip.ts` は日付窓の全期間走査をやめ、Twurple のページング取得を最大1000件で打ち切る高速経路へ変更。表示履歴による重複回避は維持
- ドキュメント更新: `readme.md` から初コメ機能説明と `!firstcomment` を削除し、clip取得方針を高速ページングへ更新
- 要望: 全期間走査は維持したまま、`!clip` / `!myclip` のパフォーマンスを保ち、起動中に作成された新規クリップも候補へ入れたい
- 方針: Twitch API の重い全期間走査をチャットコマンド実行時から分離し、SQLiteキャッシュへバックグラウンド同期する
- TDD: `tests/commands/clip-cache-store.test.ts` と `tests/commands/clip-cache-sync.test.ts` を追加し、キャッシュ選択、履歴上限、走査済み期間、直近同期、完了済み期間スキップを検証
- 実装: `src/commands/clip-cache-store.ts` を追加し、`clip_cache` / `clip_history` / `clip_scan_windows` / `clip_sync_state` を `data/clips.sqlite` に作成
- 実装: `src/commands/clip-cache-sync.ts` を追加し、起動直後の直近1時間同期、5分ごとの直近同期、30日単位の全期間バックフィル、クリップ過密期間の分割、完了済み期間スキップを実装
- 実装: `src/bot.ts` は起動時に `ClipCacheSynchronizer` を開始し、`!clip` / `!myclip` はSQLiteキャッシュから即選択。キャッシュ未準備時のみ最大200件APIフォールバックを使う
- 実装: JSON履歴 `clip-history.ts` を削除し、表示履歴をSQLiteへ統合。`src/config.ts` に `TWITCH_CLIP_CACHE_DB_PATH` を追加
- ドキュメント更新: `readme.md` にクリップSQLiteキャッシュ、直近同期、全期間バックフィル仕様を追記

## 2026-05-11 作業ログ
- 要望: `!shoutout` で指定ユーザーを応援するテストコマンドを作り、実行権限を付けたい
- TDD: `tests/commands/shoutout.test.ts` に `isShoutoutAdmin` と `normalizeShoutoutTarget` の期待値を先に追加し、未実装による失敗を確認
- 実装: `src/commands/shoutout.ts` に broadcaster / mod / `SHOUTOUT_ADMIN_USERS` 許可ユーザーの権限判定と、`@ユーザー名` 入力の正規化を追加
- 実装: `src/config.ts` に `SHOUTOUT_ADMIN_USERS` 読み込みを追加し、未設定時は `rukalun` を許可
- 実装: `src/bot.ts` に `!shoutout <ユーザー名>` を追加し、既存の `sendShoutout` 経路を手動実行できるよう変更
- 実装: 手動 shoutout は成功/失敗をチャットへ返し、ログに実行者と対象ユーザーを記録
- ドキュメント更新: `readme.md` に `!shoutout` と `SHOUTOUT_ADMIN_USERS` を追記
- 不具合報告: Raid 検知後の自動 shoutout で `Tried to make an API call with a user context for user ID ... but no token was found` が発生し、自動リフレッシュ後のリトライでも同じエラーになる
- 原因: TypeScript版 `src/bot.ts` の `apiClient.chat.shoutoutUser` 直呼びが Twurple のデフォルト挙動により broadcaster ID のユーザーコンテキストを要求していたが、登録済みトークンは Bot ユーザー側だけだった
- TDD: `tests/commands/shoutout.test.ts` を先に追加し、`src/commands/shoutout` 未存在による失敗を確認
- 実装: `src/commands/shoutout.ts` を追加し、レイド元ユーザーID解決後に `apiClient.asUser(botUserId, ...)` で Bot/Moderator コンテキストへ切り替えて `chat.shoutoutUser` を実行
- 実装: `src/bot.ts` の通常送信・リトライ送信を `sendShoutout` ヘルパー経由へ変更
- テスト整備: `tests/test_system_watcher.py` で autouse fixture が `threading.Thread` をモック化したまま実スレッド起動を検証していたため、実スレッド参照を退避して使用するよう修正
- ドキュメント更新: `readme.md` にレイド自動シャウトアウトのユーザーコンテキスト方針を追記
- 検証: `npm test` で 45 件すべて通過、`npm run build` 通過、`python -m pytest -q` で 106 件すべて通過
- 追加対応: サブPC側で同エラー継続を確認。原因は修正ブランチが `main` に未反映で、自動更新対象の `origin/main` には旧直呼び実装が残っていたこと
- 追加対応: GitHub MCP の PR 作成は認証エラーだったため、検証済みコミット `f4283c6` を `main` へ fast-forward して push
- 運用メモ: TypeScript版は `dist/` が Git 管理外で PM2 は `dist/index.js` を実行する。`src/git-manager.ts` は pull 後に `npm run build` するが、再起動クールダウン中は新しい `dist` が生成されても実行プロセスは旧コードのままなので、即時反映には PM2 再起動が必要

## 2026-03-21 作業ログ
- 要望: 再起動時に別窓を開かず、同じ窓で再実行したい
- TDD: `tests/test_process_restart.py` を先に追加し、`ModuleNotFoundError` で失敗確認
- 実装: `process_restart.py` を追加し、`os.execv` 優先・失敗時のみ同一コンソール継続の `subprocess.Popen` へフォールバックする再起動処理を分離
- 実装: `main.py` の `restart_process` は `process_restart.restart_process_in_place` を利用するよう変更し、`CREATE_NEW_CONSOLE` を除去
- ドキュメント更新: `readme.md` に同一コンソール再起動方針を追記
- 検証: `PYTHONPATH=. pytest -q` で 69 件すべて通過を確認

## 2026-03-20 作業ログ
- 要望: 最初からフル権限でトークン取得する
- 実装: `auth_scope_sets.py` の `REAUTH_AUTH_SCOPES` を `list(AuthScope)` に変更し、再認可時に全スコープ要求へ更新
- 実装: `validate_access_token` の不足判定を manga追加2スコープから全スコープへ拡張
- 実装: 不足検知ログ文言を「フル権限スコープ不足」に更新
- テスト: `tests/test_auth_scope_sets.py` に `REAUTH_AUTH_SCOPES` が `AuthScope` 全体を網羅することを追加
- ドキュメント更新: `readme.md` の再認可方針を全スコープ要求に更新
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 不具合報告: 再認可成功後も `manga返信のAPI送信失敗: No authorization with correct scope set!` が継続
- 原因: `set_user_authentication` に常に最小スコープを渡しており、再認可で取得した追加スコープが認証コンテキストに反映されていない
- 修正: `Config.ACTIVE_AUTH_SCOPES` を導入し、検証結果に応じて最小/拡張スコープを動的切替
- 修正: `set_user_authentication` の全呼び出しを `ACTIVE_AUTH_SCOPES` 使用へ変更
- 修正: 再認可成功時は `REAUTH_AUTH_SCOPES` を有効化し、失敗時は `REQUIRED_AUTH_SCOPES` に戻す
- ドキュメント更新: `readme.md` に再認可後の拡張スコープ反映を追記
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: スコープ不足時に再取得（再認可）できるようにする
- TDD: `tests/test_scope_policy.py` を先に作成し、`ModuleNotFoundError` で失敗確認
- 実装: `scope_policy.py` を追加し、不足スコープ判定を実装
- 実装: `main.py` の `validate_access_token` で manga追加スコープ不足を検知した場合、同一トークンにつき1回だけ `refresh_access_token_fallback` を自動実行
- 実装: `Config` にスコープ再認可試行済みトークン管理を追加し、過剰な再認可ループを抑止
- ドキュメント更新: `readme.md` に不足スコープ検知時の自動再認可フローを追記
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: 再認可フローで `user:write:chat` / `moderator:manage:chat_messages` を確実に要求
- TDD: `tests/test_auth_scope_sets.py` を先に追加し、`ModuleNotFoundError` で失敗確認
- 実装: `auth_scope_sets.py` を追加し、`REQUIRED_AUTH_SCOPES` と `REAUTH_AUTH_SCOPES` を分離
- 実装: `main.py` は通常起動で最小スコープを使い、`UserAuthenticator`（再認可）で `REAUTH_AUTH_SCOPES` を要求するよう変更
- ドキュメント更新: `readme.md` に再認可時の追加2スコープ要求を追記
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: `!manga` 返信の自動削除を 10 秒から 5 秒へ短縮
- 実装: `main.py` に `MANGA_DELETE_DELAY_SECONDS = 5` を追加し、API送信時/`ctx.send`フォールバック時の削除予約秒数を統一
- ドキュメント更新: `readme.md` の `manga` 削除タイミング説明を 5 秒へ更新
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 不具合報告: `send_chat_message` 権限不足時に `ctx.send` フォールバックされ、`!manga` 返信が削除されない
- 修正: `message_delete_tracker.py` を再導入し、`ctx.send` フォールバック時の削除予約を保持
- 修正: `event_message` の `echo` で `message_id` を拾い、10秒後に `/delete <message_id>` を実行するフォールバック経路を追加
- 修正: API削除失敗時も `/delete` コマンドへ自動フォールバック
- ドキュメント更新: `readme.md` に `ctx.send` フォールバック時の `/delete` 試行仕様を追記
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 不具合報告: `given token is missing scope moderator:manage:chat_messages`
- 原因: `REQUIRED_AUTH_SCOPES` に削除用スコープを必須化していたため、既存トークンで起動時認証が失敗
- 修正: 必須スコープから `MODERATOR_MANAGE_CHAT_MESSAGES` / `USER_WRITE_CHAT` を除外して起動を優先
- 修正: `manga` はAPI送信失敗時に `ctx.send` へフォールバックし、削除はスキップする仕様を明記
- ドキュメント更新: `readme.md` の `manga` セクションをフォールバック仕様へ更新
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 不具合報告: `given token is missing scope analytics:read:extensions`
- 原因: 認証スコープを全要求 (`list(AuthScope)`) にしたことで、既存トークン検証が失敗
- 修正: `REQUIRED_AUTH_SCOPES` を Bot 実行に必要な最小セットへ戻し、不要スコープ依存を解消
- ドキュメント更新: `readme.md` の認証スコープ説明を最小スコープ方針へ修正
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: すべてのスコープでトークン取得するよう変更
- 実装: `main.py` の `REQUIRED_AUTH_SCOPES` を `list(AuthScope)` に変更し、認証時に全スコープを要求する設定へ更新
- ドキュメント更新: `readme.md` に全スコープ要求の注意点を追記
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: `!manga` 返信の `message_id` を `send_chat_message` 返却値から直接取得
- TDD: `tests/test_chat_message_response.py` を先に作成し、`ModuleNotFoundError` で失敗確認
- 実装: `chat_message_response.py` を追加し、`send_chat_message` 結果の妥当性検証と `message_id` 抽出を実装
- 実装: `main.py` の `manga` 返信送信を `ctx.send` から `send_chat_message` に切り替え、返却 `message_id` で10秒後削除を予約
- 実装: 旧 `echo` / 予約トラッカー方式（`message_delete_tracker.py`）を削除
- 実装: 認可スコープに `MODERATOR_MANAGE_CHAT_MESSAGES` と `USER_WRITE_CHAT` を追加
- ドキュメント更新: `readme.md` の削除仕様を `message_id` 直接取得方式に更新
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: `!manga` の返信が10秒後に消えない問題を修正
- 原因調査: `echo` 受信時の本文完全一致に依存しており、本文差異で削除予約が取りこぼされる可能性を確認
- 実装: `message_delete_tracker.py` にチャンネル単位フォールバック一致 (`pop_first_for_channel`) を追加
- 実装: `main.py` の削除予約処理で本文一致失敗時に同一チャンネル先頭予約へフォールバックし、削除予約ログを追加
- テスト: `tests/test_message_delete_tracker.py` にフォールバック一致のテストを追加
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 要望: `!manga` の返答を 10 秒後に削除
- TDD: `tests/test_message_delete_tracker.py` を先に作成し、`ModuleNotFoundError` で失敗確認
- 実装: `message_delete_tracker.py` を追加し、削除予約メッセージの追跡ロジックを実装
- 実装: `main.py` の `event_message` で自分の `echo` メッセージIDを取得し、`delete_chat_message` を 10 秒後に実行
- 実装: `manga` 返信を `_send_manga_reply` に統一し、自動削除予約を追加
- ドキュメント更新: `readme.md` に `!manga` 返信の 10 秒後自動削除を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_message_delete_tracker.py tests/test_manga_selector.py tests/test_manga_command_control.py` で 13 件すべて通過
- 要望: `mangaon` / `mangaoff` を追加し、管理者のみ実行可能に変更
- TDD: `tests/test_manga_selector.py` と `tests/test_manga_command_control.py` を先に作成し、`ModuleNotFoundError` で失敗確認
- 実装: `manga_selector.py` と `manga_command_control.py` を追加
- 実装: `main.py` に `!manga`, `!mangaon`, `!mangaoff` を追加し、管理者判定と `.env` 永続化 (`MANGA_COMMAND_ENABLED`) を実装
- ドキュメント更新: `readme.md` に `manga` 系コマンド仕様と管理者条件を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_manga_selector.py tests/test_manga_command_control.py` で 9 件すべて通過
- 要望: `!manga` コマンドを追加し、`https://www.dlsite.com/girls/ranking/day` からランダムでタイトルを返す仕様に変更
- TDD: `tests/test_manga_selector.py` を先に作成し、`ImportError` で失敗確認
- 実装: `manga_selector.py` を追加し、`dt.work_name` 配下のタイトル抽出 (`extract_manga_titles`) とランダム選択を実装
- 実装: `main.py` に `!manga` コマンドを追加し、`asyncio.to_thread` でランキング取得、失敗時メッセージ返却を実装
- ドキュメント更新: `readme.md` に `!manga` の取得元URLと失敗時挙動を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_manga_selector.py` で 4 件すべて通過
- 要望: `!manga` コマンド廃止
- 実装: `main.py` から `manga` コマンドと `manga_selector` import を削除
- 実装: `manga_selector.py` と `tests/test_manga_selector.py` を削除
- ドキュメント更新: `readme.md` の `!manga` 説明と、構成欄の manga 関連記述を整理
- 検証: `PYTHONPATH=. pytest -q` で全テスト通過を確認
- 不具合報告: 起動時トークン検証で `refresh_access_token_advanced` が `400` を返すと、フォールバック再認可に進まず終了する
- TDD: `tests/test_token_refresh_policy.py` を先に追加し、`ModuleNotFoundError` で失敗確認
- 実装: `token_refresh_policy.py` を追加し、`200` 以外はフォールバック再認可対象とする `should_try_fallback` を実装
- 実装: `main.py` の `refresh_access_token_advanced` を更新し、非200時はレスポンス本文をログして `refresh_access_token_fallback` を実行
- ドキュメント更新: `readme.md` に「高度リフレッシュ非200時は自動でフォールバック再認可」仕様を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_token_refresh_policy.py` で 3 件通過
- 検証: `PYTHONPATH=. pytest -q` で 59 件すべて通過
- 要望: トークンが使えなくなった時だけ再取得したい
- TDD: `tests/test_scope_policy.py` に、付与済みスコープから有効スコープ集合を解決するテストを先に追加し、`ImportError` で失敗確認
- 実装: `scope_policy.py` に `active_auth_scopes_from_granted` を追加
- 実装: `main.py` の `validate_access_token` を更新し、401時のみ再取得・それ以外は付与済みスコープを `ACTIVE_AUTH_SCOPES` へ反映
- 実装: 全スコープ不足を理由にした自動再認可トリガーを停止し、不要な再取得ループを解消
- ドキュメント更新: `readme.md` のトークン運用方針を「401時のみ再取得」に更新
- 検証: `PYTHONPATH=. pytest -q tests/test_scope_policy.py` で 4 件通過
- 検証: `PYTHONPATH=. pytest -q` で 61 件すべて通過
- 要望: 起動時とトークン再取得時に、付与済みスコープをECHO表示する
- TDD: `tests/test_scope_policy.py` に `normalize_scope_values` の期待値テストを先に追加し、`ImportError` で失敗確認
- 実装: `scope_policy.py` に `normalize_scope_values` を追加し、スコープ文字列の重複排除・ソートを実装
- 実装: `main.py` の `validate_access_token` で `[ECHO] 起動時トークンスコープ` を出力（同一トークンは1回のみ）
- 実装: `refresh_access_token_advanced` / `refresh_access_token_fallback` 成功時に `[ECHO] 再取得トークンスコープ` を出力
- ドキュメント更新: `readme.md` にスコープECHOログ仕様を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_scope_policy.py` で 6 件通過
- 検証: `PYTHONPATH=. pytest -q` で 63 件すべて通過
- 不具合報告: `[ECHO]` に存在する `chat:edit` / `chat:read` / `moderator:manage:shoutouts` が不足扱いになる
- 原因: `scope_policy.py` で `AuthScope` を `str()` 比較しており、`chat:edit` と一致せず誤検知していた
- TDD: `tests/test_scope_policy.py` に `AuthScope` 入力時の不足判定/有効スコープ解決テストを追加し、2件失敗を確認
- 実装: `scope_policy.py` に `_scope_value` 正規化ヘルパーを追加し、判定処理を `AuthScope` / 文字列混在対応へ修正
- ドキュメント更新: `readme.md` にスコープ判定の正規化比較仕様を追記
- 検証: `PYTHONPATH=. pytest -q tests/test_scope_policy.py` で 8 件通過
- 検証: `PYTHONPATH=. pytest -q` で 65 件すべて通過

## 2026-02-14 作業ログ
- 要望: `!myclip` コマンドを `!clip` と同仕様で追加し、作成者をコマンド実行者に限定
- 事前調査: Twitch API `Get Clips` は作成者をクエリで直接絞れないため、Bot 側で取得結果から作成者一致を抽出する方針を採用
- TDD: `tests/test_clip_selector.py` を先に追加し、`ModuleNotFoundError` で失敗確認
- 実装: `clip_selector.py` を追加し、作成者ID優先・作成者名フォールバックで絞り込み後にランダム選択
- `main.py` の `clip` 処理を共通化し、`!myclip` コマンドを追加
- ドキュメント更新: `readme.md` に `!myclip` の仕様と API 制約（最大100件から抽出）を追記
- 検証: `PYTHONPATH=. pytest -q` で 23 件すべて通過
- 要望: `!clip` と `!myclip` のリキャストを独立管理に変更
- TDD: `tests/test_command_cooldown_state.py` を先に追加し、`ModuleNotFoundError` の失敗確認
- 実装: `command_cooldown_state.py` を追加し、コマンド別の最終実行時刻を管理
- 実装: `main.py` に `LAST_MYCLIP_TIME` の保存処理と、`clip` / `myclip` 別のリキャスト通知管理を追加
- ドキュメント更新: `readme.md` に `clip` / `myclip` の独立リキャスト仕様を追記
- 検証: `PYTHONPATH=. pytest -q` で 26 件すべて通過

## 2026-02-11 作業ログ
- `.env` の内容が `COMMENT_TOTAL_COUNT` と `STREAM_STARTED_AT` のみになっていたため、必要キー一覧を復旧用テンプレートとして再生成
- 既存の `COMMENT_TOTAL_COUNT` と `STREAM_STARTED_AT` の値は保持し、他キーは空欄/既定値で追記
- ユーザー手元の控えから `.env` の Twitch/Discord 設定と `LAST_CLIP_TIME` を再反映
- `.env` 更新の安全化に向けて `tests/test_env_store.py` を追加し、`python3 -m pytest -q` で失敗を確認
- 定期再起動の判定ロジックを分離するため `tests/test_restart_state_store.py` を追加し、`python3 -m pytest -q` で失敗を確認
- `env_store.py` を追加し、`.env` 更新をバックアップ付きのアトミック書き込みに統一
- `comment_state_store.py` と `main.py` の `.env` 更新処理を `env_store.update_env_file` に切り替え
- `python3 -m pytest -q` で全テスト通過を確認
- `.env.bak` と `.env.tmp` を `.gitignore` に追加
- 再起動間隔の判定を `restart_state_store.py` に分離し、初回/欠損時の即時再起動を抑止
- GitHub更新による再起動もクールダウン対象にして保留→次回再起動で反映
- `python3 -m pytest -q` で全テスト通過を確認

## 2026-01-03 作業ログ
- README に `clip` コマンドの復旧状況と特別ユーザー設定 (`CLIP_SPECIAL_USERS`) を共有するメモを追加し、りきゃさん復帰時の周知事項として明記
- 一般ユーザーの `clip` コマンド使用後に 30 分経過すると Bot が自動で「リキャスト復帰」をコメントする仕組みを実装。`ClipRecastNotifier` のユニットテスト (`tests/test_clip_recast_notifier.py`) を追加し、`PYTHONPATH=. pytest -q` で全テストを通過確認

## 2026-01-20 作業ログ
- コメント風速（コメント/分）算出のため、`tests/test_comment_speed_meter.py` を追加し TDD の失敗確認まで実施
- `comment_speed_meter.py` を追加し、`!speed` コマンドで直近 60 秒のコメント/分を返すように実装
- `main.py` のメッセージ受信でコマンド以外のコメントを計測対象に追加
- README にコメント風速コマンドの説明を追記
- 配信全体の平均コメント/分を算出するため、`comment_speed_meter.py` に配信開始/終了のリセットと総数カウントを追加
- `tests/test_comment_speed_meter.py` に配信全体の風速とリセット動作のテストを追記し、`PYTHONPATH=. pytest -q` で通過確認
- `main.py` の配信状態監視で風速計測の開始/終了を同期し、`!speed` の出力を直近/全体の2段表示に変更
- README の `!speed` 説明を配信全体平均の表示に更新
- コマンド判定のユニットテスト `tests/test_message_filters.py` を追加
- `message_filters.py` を追加し、コマンド判定を切り出して先頭空白も含めて除外
- `main.py` の風速計測は `message_filters.is_command_message` を使うよう更新
- README にコマンド除外の詳細を追記
- `tests/test_comment_count_formatter.py` を追加し、累計コメント件数の表示文言をTDDで定義
- README に `!commentcount` コマンドの説明を追記
- `comment_count_formatter.py` を追加して累計コメント件数の表示文言を実装
- `main.py` に `!commentcount` コマンドを追加し、配信開始からの累計コメント件数を返すよう対応
- README に `!commentcount` の表示例を追記
- コメント件数の永続化テスト `tests/test_comment_state_store.py` を追加
- `comment_state_store.py` を追加し、`.env` に累計コメント件数と配信開始時刻を保存する仕組みを実装
- `comment_speed_meter.py` に状態復元用の `set_state` を追加
- `main.py` で配信開始/終了とコメント受信時にコメント件数を保存し、再起動後も引き継ぐよう対応
- README に累計コメント件数の引き継ぎ仕様を追記

## 2025-11-25 作業ログ
- 要望: 同一配信タイトル時のDiscord通知抑止
- `tests/test_stream_notifications.py` を追加し、タイトル比較ロジックのTDDテストを作成
- `stream_notifications.py` と `Config.update_last_stream_title` でタイトル永続化と通知判定を実装
- `main.py` の配信開始処理は `StreamTitleNotifier` を利用して通知重複を防止
- `requirements.txt` に `pytest` を追加し、`readme.md` へ `LAST_STREAM_TITLE` 設定とテスト実行手順を追記
- `.env` の `LAST_STREAM_TITLE` を都度読み書きするよう `StreamTitleNotifier` と `Config.get_last_stream_title` を強化
