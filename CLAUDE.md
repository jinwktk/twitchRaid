# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## 🖥️ サブPCログ確認（SSH経由）

本番BotはサブPC（192.168.0.99）で稼働中。メインPC（192.168.0.100）からSSH経由でログを確認できる。

```bash
# 今日のログ末尾50行を確認
ssh mlove@192.168.0.99 "powershell Get-Content E:\GitHub\twitchRaid\logs\bot_$(Get-Date -Format 'yyyy-MM-dd').log -Tail 50"

# 最新のログファイル末尾50行
ssh mlove@192.168.0.99 "powershell Get-ChildItem E:\GitHub\twitchRaid\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Get-Content $_.FullName -Tail 50 }"

# ログファイル一覧（最新順）
ssh mlove@192.168.0.99 "powershell Get-ChildItem E:\GitHub\twitchRaid\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | Format-Table Name, Length, LastWriteTime"

# ERRORだけ抽出（最新ログ）
ssh mlove@192.168.0.99 "powershell Get-ChildItem E:\GitHub\twitchRaid\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Select-String -Path $_.FullName -Pattern ERROR -SimpleMatch }"

# 特定日付のログ確認（例: 2026-03-22）
ssh mlove@192.168.0.99 "type E:\GitHub\twitchRaid\logs\bot_2026-03-22.log"
```

**接続情報**: ユーザー `mlove`、公開鍵認証設定済み（パスワード不要）

## サブエージェント運用ルール（spec-planner / spec-generator / spec-evaluator）

短いアイデアから製品を自動構築するための3エージェント連携フロー。

### 役割分担（厳守）
- **spec-planner**: 1〜4行のプロンプト → `specs/<product>.md` を生成。**実装詳細（DB・ライブラリ・クラス構造）は書かない**。機能16前後・10スプリント・受け入れ基準のみ。
- **spec-generator**: 仕様書を読み、**1スプリント=1機能**で実装。production-ready（TODO/モック禁止）。自己評価サマリを付けて evaluator に引き渡す。
- **spec-evaluator**: Playwright MCP で**実際に操作**して検証。5基準を0-10で採点し、**1つでも閾値未満なら不合格**。再現手順付きバグ報告を返す。

### 実行フロー
1. ユーザーの短いアイデア → spec-planner を起動し `specs/<product>.md` を作成
2. 仕様書を確認（必要なら人間がレビュー）
3. Sprint 1 から順に以下をループ:
   - spec-generator にスプリント番号を指定して実装依頼
   - spec-evaluator に同スプリントの検証依頼
   - **不合格** → 同一スプリント内で generator に修正依頼（最大3周まで）
   - **3周しても不合格** → 人間にエスカレーション
   - **合格** → 次スプリントへ
4. 全スプリント合格で完了

### 厳守ルール
- **仕様書は planner 以外が書き換えない**。generator/evaluator が仕様の不備を見つけた場合は、planner への差し戻しを人間に提案する
- **evaluator は静的レビューだけで判定しない**。必ず Playwright MCP で実操作し、スクリーンショット or コンソールログを証跡として残す
- **generator は evaluator のフィードバックのみに従う**。勝手にスコープを広げない（YAGNI）
- **スプリント跨ぎの修正禁止**。Sprint N の不合格は Sprint N 内で解決する
- planner → generator → evaluator は**逐次実行**（依存があるため並列化しない）
- 各スプリントの引き渡し情報は `specs/handoff/sprint-N.md` に追記し、状態を永続化する
- 3つとも opus モデルで動作する前提。モデル変更時は本ルールも見直す

### 失敗時のエスカレーション
- 同一スプリントで3回不合格 → 人間に「仕様が曖昧／技術的に困難」の可能性を報告
- evaluator が起動方法を特定できない → generator に引き渡しフォーマット再提出を依頼
- planner の仕様に矛盾発覚 → 実装を止めて planner に差し戻す

## 開発コマンド

### セットアップ（TypeScript版 v2.0）
```bash
npm install
npm run build
```

### アプリケーション実行
```bash
# PM2で起動（推奨）
npm run pm2:start

# 直接起動
npm start

# 開発モード
npm run dev
```

### Python版（レガシー）
```bash
pip install -r requirements.txt
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
- GitHub更新監視：10分間隔（UPDATE_CHECK_INTERVAL）、現在のブランチを動的検出
- 定期再起動監視：5分間隔（RESTART_CHECK_INTERVAL）
- 自動再起動：24時間間隔（RESTART_INTERVAL）

## ファイル構成

### TypeScript版（v2.0 - メイン）
- `src/` - TypeScriptソースコード
  - `src/index.ts` - エントリーポイント
  - `src/config.ts` - 設定管理
  - `src/bot.ts` - Bot本体（twurple統合）
  - `src/git-manager.ts` - Git更新検知・再起動
  - `src/system-watcher.ts` - 定期監視
  - `src/auth/` - OAuth認証管理
  - `src/commands/` - チャットコマンド
  - `src/chat/` - チャット機能
  - `src/notifications/` - 通知機能
  - `src/utils/` - ユーティリティ
- `package.json` - Node.js依存関係
- `tsconfig.json` - TypeScript設定
- `ecosystem.config.js` - PM2設定

### Python版（レガシー）
- `main.py` - 旧エントリーポイント
- `requirements.txt` - Python依存関係

### 共通ファイル
- `.env` - 環境変数設定（機密情報）
- `start_services.bat` - サービス起動スクリプト
- `last_restart.txt` - 最後の再起動時刻記録
- `.gitignore` - Git除外設定
- `readme.md` - プロジェクト概要
- `CLAUDE.md` - 開発ガイドライン（このファイル）

## 最新の変更履歴

### TypeScript移植 + PM2管理対応（2026-03-22）
- Python → TypeScript完全移植（twurple使用）
- PM2プロセス管理対応（ecosystem.config.js）
- winston + daily-rotate-fileによるログ管理
- RefreshingAuthProviderによる自動トークンリフレッシュ
- 全18モジュール + main.pyの機能を完全移植
- ビルド確認済み（tsc正常通過）

### 主要な改善点
- 大規模リファクタリング：アーキテクチャ改善とコード品質向上
- GitHub更新監視機能の強化と自動再起動システムの改善
- ログローテーション実装と監視間隔の最適化
- TwitchRaidとWhisperサーバーの統合
- **WebSocket接続の安定性向上（2025-08-06）**
  - 自動再接続ロジックの実装（最大10回試行、指数バックオフ付き）
  - エラーハンドリングの改善（`event_error`メソッド追加）
  - 接続キープアライブ機能の実装（60秒ごとに接続状態を確認）
  - ハートビート間隔を30秒に設定
  - メインループに再試行ロジックを追加
- **パフォーマンスチューニング＆コードレビュー修正（2026-03-21）**
  - トークン検証キャッシュ導入（5分TTL）でコマンド応答速度向上
  - event_message/event_joinのログレベルをDEBUGに最適化
  - asyncio.get_event_loop()→get_running_loop()に修正
  - update_last_clip_timeをset_keyに統一
  - keep_alive内のlast_activity_time同期バグ修正
  - send_discord_notification呼び出しをrun_in_executorで非同期化
  - __init__内の無効なasyncio.create_task削除
  - event_raw_usernoticeのKeyError防止
  - 未使用import/関数削除、bare except修正、stream_live初期値修正

### 開発プロセス改善
- テスト駆動開発（TDD）アプローチの採用
- 依存性注入パターンの実装
- スレッドセーフなアーキテクチャの構築

### 仕様ドキュメント作成（2026-03-22）
- `docs/`ディレクトリに包括的な仕様ドキュメントを追加
- `docs/ARCHITECTURE.md` - アーキテクチャ概要（クラス構成、スレッド設計、モジュール一覧、データフロー）
- `docs/COMMANDS.md` - コマンド仕様書（全12コマンド詳細、クールダウン、権限、自動機能）
- `docs/TECH_STACK.md` - 技術スタック・運用環境（ライブラリ、.env設定一覧、認証フロー、テスト一覧）
- `docs/DESIGN_PATTERNS.md` - 設計パターン（DI、SRP、エラーハンドリング戦略、ファイル構成）