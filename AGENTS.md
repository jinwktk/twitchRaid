# Repository Guidelines

## プロジェクト構成とモジュール配置
- `main.py`: Twitch 配信監視と Discord 通知を統括するエントリーポイント。Bot 設定、ログ収集、Git 自動更新を内包。
- `logs/`: 日次ローテーション済みログを保存。調査時は最新ファイル `bot_YYYY-MM-DD.log` を参照。
- `requirements.txt`: 最低限の依存関係。仮想環境 `venv/` にインストール。
- `.env` (未コミット想定): Twitch と Discord の認証情報および内部ステート (`LAST_CLIP_TIME` 等) を保持。
- `CLAUDE.md` と `AGENTS.md`: 作業手順と変更履歴を日次で更新し、ドキュメントの重複を避ける。

## ビルド・テスト・開発コマンド
- `python -m venv venv && source venv/bin/activate`: Linux/Mac の仮想環境作成と有効化。Windows は `venv\Scripts\activate` を使用。
- `pip install -r requirements.txt`: 依存パッケージをローカル環境に導入。
- `python main.py`: Bot を前景で起動。手動停止時は `Ctrl+C`。
- `pytest -q`: テストが追加された後の標準実行。CI 導入前でもローカルで失敗確認を徹底。

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
- `.env` には `TWITCH_CLIENT_ID`, `TWITCH_SECRET_TOKEN`, `TWITCH_ACCESS_TOKEN`, `TWITCH_REFRESH_TOKEN`, `TWITCH_BROADCASTER_ID`, `TWITCH_MODERATOR_ID`, `DISCORD_WEBHOOK_URL`, `LAST_CLIP_TIME` を定義。更新は `Config.update_*` が担当。
- 機密情報は commit しない。漏洩した場合は Twitch/Discord のパネルから速やかに再発行し、`set_key` で反映。
- `logs/` は利用後にアーカイブか削除。容量監視は `du -sh logs` と `find logs -mtime +30 -delete` (必要に応じて) で対応。

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
