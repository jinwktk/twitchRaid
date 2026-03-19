# TwitchRaid

## セットアップ
- `pip install -r requirements.txt`
- `.env` に Twitch/Discord 認証情報と `LAST_STREAM_TITLE` を設定
- Twitch認証は Bot 動作に必要な最小スコープのみ要求（`chat` / `shoutout` / `chat message delete` 系）
- 再認可フロー（`UserAuthenticator`）では最初から `AuthScope` 全スコープを要求します
- トークン検証時に全スコープ不足を検知した場合、Bot は一度だけ再認可フローを自動実行します
- 再認可で追加スコープ取得に成功した場合、以降の `set_user_authentication` には拡張スコープ集合を適用します

## .env保護
- `.env` の更新は `env_store.py` で実行し、更新前に `.env.bak` を作成
- `.env` が空になった場合は `.env.bak` を基準に復旧して追記
- `.env.bak` と `.env.tmp` はバックアップ/一時ファイルのため Git 管理外


## 再起動ポリシー
- 定期再起動は 1 日 1 回
- GitHub 更新による再起動もクールダウン対象のため、更新は次の再起動タイミングで反映
## 配信通知仕様
- 配信開始検知時に Discord Webhook へ通知
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 最新のタイトルは自動で `.env` の `LAST_STREAM_TITLE` に書き戻され、次回判定時に `.env` から再読込される

## Clipコマンドメモ
- りきゃさん向け共有: `clip` コマンドは復旧済みで、帰還後すぐに利用できます
- `.env` の `CLIP_SPECIAL_USERS` (初期値: `nyme_ia,rukalun`) に含まれるユーザーはクールダウン無しで実行可能です
- 一般ユーザーは 30 分のクールダウンが適用されるため、リレー配信時には特別ユーザー枠を必要に応じて調整してください
- 一般ユーザーがクールダウン中に `!clip` を使おうとした場合、30 分後に Bot がチャットへ「リキャスト復帰」コメントを自動送信します
- 一般ユーザーの `!myclip` も 30 分クールダウンですが、`!clip` とは別管理（独立リキャスト）です
- 一般ユーザーがクールダウン中に `!myclip` を使おうとした場合も、`!myclip` 専用でリキャスト復帰を通知します
- `!myclip` はコマンド実行者が作成したクリップのみを対象にします
- Twitch API の `Get Clips` は作成者での直接フィルタに非対応のため、Bot 側で取得したクリップ（最大100件）から作成者一致を抽出しています

## コメント風速コマンド
- `!speed` で直近 60 秒のコメント/分と、配信全体の平均コメント/分を表示
- `!` などのコマンドは計測対象外（先頭に空白があっても除外）

## コメント件数コマンド
- `!commentcount` で配信開始からの累計コメント件数を表示
- 表示例: `配信開始からの累計コメント: 123件`
- 再起動が発生しても `.env` の状態を使って累計を引き継ぐ

## 漫画コマンド
- `!manga` で `https://www.dlsite.com/girls/ranking/day` の日間ランキングから作品タイトルを抽出し、ランダムに1作品表示
- `!manga` は `MANGA_COMMAND_ENABLED` が `1` のときのみ有効
- `!mangaon` / `!mangaoff` で `!manga` の有効/無効を切り替え（管理者のみ）
- 管理者判定: モデレーター/配信者、または `.env` の `MANGA_ADMIN_USERS` に含まれるユーザー
- `!manga` は `send_chat_message` が使える場合のみ返却 `message_id` で 5 秒後自動削除（`user:write:chat` と `moderator:manage:chat_messages` が必要）
- 上記スコープがない場合は `ctx.send` にフォールバックし、`echo` の `message_id` を使って `/delete` コマンドで5秒後削除を試行（権限不足時は削除不可）

## テスト
- `PYTHONPATH=. pytest -q`
- `.env` 更新安全化のテスト: `tests/test_env_store.py`
- 再起動間隔のテスト: `tests/test_restart_state_store.py`

## 実行
- `python main.py`
