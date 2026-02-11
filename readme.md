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
- `!speed` で直近 60 秒のコメント/分と、配信全体の平均コメント/分を表示
- `!` などのコマンドは計測対象外（先頭に空白があっても除外）

## コメント件数コマンド
- `!commentcount` で配信開始からの累計コメント件数を表示
- 表示例: `配信開始からの累計コメント: 123件`
- 再起動が発生しても `.env` の状態を使って累計を引き継ぐ

## テスト
- `PYTHONPATH=. pytest -q`
- `.env` 更新安全化のテスト: `tests/test_env_store.py`

## 実行
- `python main.py`
