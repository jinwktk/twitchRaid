# TwitchRaid

## セットアップ
- `pip install -r requirements.txt`
- `.env` に Twitch/Discord 認証情報と `LAST_STREAM_TITLE` を設定

## 配信通知仕様
- 配信開始検知時に Discord Webhook へ通知
- 直前に通知したタイトルと同一 (`LAST_STREAM_TITLE`) の場合は通知をスキップ
- 最新のタイトルは自動で `.env` の `LAST_STREAM_TITLE` に書き戻される

## テスト
- `python3 -m pytest -q`

## 実行
- `python main.py`
