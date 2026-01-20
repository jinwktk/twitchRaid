# TwitchRaid

## セットアップ
- `pip install -r requirements.txt`
- `.env` に Twitch/Discord 認証情報と `LAST_STREAM_TITLE` を設定

## 配信通知仕様
- 配信開始検知時に Discord Webhook へ通知
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 最新のタイトルは自動で `.env` の `LAST_STREAM_TITLE` に書き戻され、次回判定時に `.env` から再読込される

## Clipコマンドメモ
- りきゃさん向け共有: `clip` コマンドは復旧済みで、帰還後すぐに利用できます
- `.env` の `CLIP_SPECIAL_USERS` (初期値: `nyme_ia,rukalun`) に含まれるユーザーはクールダウン無しで実行可能です
- 一般ユーザーは 30 分のクールダウンが適用されるため、リレー配信時には特別ユーザー枠を必要に応じて調整してください
- 一般ユーザーがクールダウン中に `!clip` を使おうとした場合、30 分後に Bot がチャットへ「リキャスト復帰」コメントを自動送信します

## コメント風速コマンド
- `!speed` で直近 60 秒のコメント数を元に、コメント/分を表示

## テスト
- `PYTHONPATH=. pytest -q`

## 実行
- `python main.py`
