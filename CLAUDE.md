# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## 開発コマンド

### セットアップ
```bash
pip install -r requirements.txt
```

### アプリケーション実行
```bash
python main.py
```

### テスト・検証
```bash
# 構文チェック
python -m py_compile main.py

# デバッグログで実行（main.pyのログレベルをDEBUGに変更）
```

### Git操作
アプリケーションには自動Git操作機能が組み込まれており、10分ごとに更新をチェックし、変更が検出されると再起動します。

## アーキテクチャ概要

### 主要クラス

**Config** - 設定管理の中心クラス
- `.env`ファイルからすべての設定を読み込み
- Twitch API認証情報、Discord Webhook、システム設定を管理
- トークンとクリップタイムスタンプの更新メソッドを提供
- 環境変数の同期を処理

**GitManager** - Git操作とプロセスライフサイクル管理
- git fetch、pull、更新検知を処理
- コード変更検出時の自動再起動を管理
- `last_restart.txt`経由で再起動間隔（24時間サイクル）を追跡
- `os.execv`を使用した安全なプロセス再起動を実行

**SystemWatcher** - バックグラウンド監視サービス
- 更新チェックを10分ごとに実行（設定可能）
- 再起動チェックを5分ごとに実行（設定可能）
- 監視スレッドの例外回復とリトライロジックを処理

**Bot** - メインTwitchボット機能
- `twitchio.ext.commands.Bot`を継承
- 配信状態を監視しDiscord通知を送信
- Twitchコマンドを処理：`!age`、`!goods`、`!weight`、`!clip`
- レイド時の自動シャウトアウト機能を実装
- クリップコマンドのクールダウン管理（30分間隔）

### 重要な統合ポイント

**依存性注入パターン**
- Configインスタンスがすべての主要コンポーネントに渡される
- グローバル変数依存を排除
- テスト性とモジュラリティを向上

**スレッドアーキテクチャ**
- メインスレッドで非同期Twitchボットを実行
- バックグラウンドデーモンスレッドでGit監視と再起動スケジューリングを処理
- すべてのスレッドが同じConfigインスタンスを共有して連携

**トークン管理フロー**
1. `validate_access_token()`でトークンの有効性をチェック
2. `refresh_access_token()`で必要時に新しいトークンを取得
3. Configクラスでメモリと`.env`ファイルの両方を更新
4. ボットが新しい認証情報で再初期化

### 環境設定

必要な`.env`変数：
- `TWITCH_CLIENT_ID`、`TWITCH_SECRET_TOKEN` - Twitch API認証情報
- `TWITCH_ACCESS_TOKEN`、`TWITCH_REFRESH_TOKEN` - OAuthトークン（自動管理）
- `TWITCH_BROADCASTER_ID`、`TWITCH_MODERATOR_ID` - チャンネル識別子
- `DISCORD_WEBHOOK_URL` - 配信通知用
- `LAST_CLIP_TIME` - クリップコマンド使用状況追跡（自動管理）

### サービスエコシステム

このボットは`start_services.bat`で管理される大規模な配信セットアップの一部です：
- VOICEVOX：TTS機能
- RVC：音声変換
- Whisperサーバー：音声認識
- yomiage-bot-ts：追加チャット機能

ボットは独立して動作しますが、共有環境を通じてこれらのサービスと連携します。

## 開発時の注意点

### コード修正時
- 変更をコミット・プッシュすると自動的にボットが更新され再起動される
- ログは`bot_log.txt`でローテーション管理される（5MB、3ファイル保持）
- 構文エラーがあると再起動時にクラッシュするため、事前に構文チェックを実行

### トークン管理
- アクセストークンは自動更新されるが、初回設定時は手動で`.env`に設定が必要
- トークンの有効期限切れ時は自動的にリフレッシュを試行
- 認証エラーが継続する場合は手動でトークンを再生成

### 監視システム
- GitHub更新監視：10分間隔（UPDATE_CHECK_INTERVAL）
- 定期再起動監視：5分間隔（RESTART_CHECK_INTERVAL）
- 自動再起動：24時間間隔（RESTART_INTERVAL）

## ファイル構成

### メインファイル
- `main.py` - アプリケーションのエントリーポイント
- `requirements.txt` - Python依存関係
- `.env` - 環境変数設定（機密情報）
- `start_services.bat` - サービス起動スクリプト

### 設定・ログファイル
- `bot_log.txt` - ボットのログファイル（自動ローテーション）
- `last_restart.txt` - 最後の再起動時刻記録
- `.gitignore` - Git除外設定

### 開発サポート
- `check_rvc.ps1` - RVCサービス確認スクリプト
- `readme.md` - プロジェクト概要
- `CLAUDE.md` - 開発ガイドライン（このファイル）

## 最新の変更履歴

### 主要な改善点
- 大規模リファクタリング：アーキテクチャ改善とコード品質向上
- GitHub更新監視機能の強化と自動再起動システムの改善
- ログローテーション実装と監視間隔の最適化
- TwitchRaidとWhisperサーバーの統合

### 開発プロセス改善
- テスト駆動開発（TDD）アプローチの採用
- 依存性注入パターンの実装
- スレッドセーフなアーキテクチャの構築