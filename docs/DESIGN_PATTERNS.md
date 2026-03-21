# 設計パターン・コード規約

## 設計原則

### 依存性注入（DI）

Configインスタンスが全主要コンポーネントに渡される。

```python
config = Config()                    # 設定読み込み
git_manager = GitManager(config)     # Git操作にConfig注入
system_watcher = SystemWatcher(git_manager)  # 監視にGitManager注入
bot = Bot(valid_token, config)       # BotにConfig注入
```

- グローバル変数は`config`, `git_manager`, `system_watcher`の3つのみ
- テスト時にモック可能な設計

### 単一責任原則（SRP）

1モジュール = 1つの明確な責任。

- `clip_selector.py`: クリップ選択ロジックのみ（API呼び出しは呼び出し側）
- `manga_selector.py`: HTTP取得＋HTML解析
- `manga_command_control.py`: 権限判定・有効/無効制御
- `env_store.py`: `.env`ファイルの安全な読み書きのみ

### ビジネスロジックとI/Oの分離

```
ビジネスロジック（テスト容易）     I/O（外部依存）
─────────────────────────────    ──────────────────────
clip_selector.select_clip()    ← twitch.get_clips()
manga_selector.extract_titles() ← requests.get()
stream_notifications.should_notify() ← Config.get_last_stream_title()
```

## エラーハンドリング戦略

### 3段階エラー回復

```
レベル1: 関数レベル
├── try/except で個別処理
├── エラーログ出力
└── 呼び出し元に結果返却

レベル2: 機能レベル
├── WebSocket切断 → delayed_reconnect（5秒待機→指数バックオフ15-60秒）
├── トークンエラー → refresh_advanced → refresh_fallback
└── 配信監視5回連続エラー → トークン自動更新

レベル3: プロセスレベル
├── 最大再接続試行（10回）超過 → git_manager.restart_process()
├── メインループ最大再試行（10回）超過 → restart_process()
└── os.execv失敗 → subprocess.Popen → os._exit
```

### WebSocket再接続フロー

```python
delayed_reconnect()
├── 5秒待機（重複実行防止フラグ）
├── 再接続試行回数チェック（max 10回）
├── 指数バックオフ待機（15 + 試行回数×5秒、最大60秒）
├── 既存接続クローズ → 10秒待機
├── トークン再検証
└── 最終的にプロセス全体再起動
```

### トークンリフレッシュ戦略

```
refresh_access_token_advanced()
├── HTTP API直接リフレッシュ（高速、サイレント）
│   ├── POST /oauth2/token (refresh_token grant)
│   └── 成功 → 検証 → .env更新
└── 失敗 → should_try_fallback()
    └── refresh_access_token_fallback()
        └── UserAuthenticator（ブラウザ認証、全スコープ要求）
```

## コールバック・通知パターン

### ClipRecastNotifier

```python
# arm: クールダウン開始を登録
notifier.arm(started_at=time.time(), send_coroutine=ctx.send)

# notify_if_ready: keep_aliveループで定期チェック
await notifier.notify_if_ready(current_time)  # 30分経過で自動通知

# disarm: 通知設定を解除
notifier.disarm()
```

### StreamTitleNotifier

```python
# 配信タイトル差分通知
notifier.should_notify(stream_title)  # 前回と比較
notifier.notify_if_needed(stream_title, sender_func)  # 差分あれば通知実行
```

### PendingDeleteTracker

```python
# manga返信の削除追跡
tracker.add(content, channel_name, delete_after_seconds, now)
matched = tracker.pop_matched(content, channel_name, now)  # echoで一致検索
# matched.delete_after_seconds 秒後に削除実行
```

## テストパターン

### テスト構成

- `tests/`ディレクトリに各モジュール対応の`test_*.py`
- pytest使用
- `PYTHONPATH=.`でインポート解決

### テスト設計方針

- 外部依存（Twitch API、Discord Webhook）はモック化
- `.env`操作は一時ファイルでテスト
- 純粋関数（clip_selector, manga_selector等）は入出力で直接テスト
- 状態管理クラスは状態遷移を網羅的にテスト

## ファイル構成

```
twitchRaid/
├── main.py                      # エントリーポイント（Config, GitManager, SystemWatcher, Bot）
├── requirements.txt             # 依存関係
├── .env                         # 環境変数設定（自動更新あり）
├── .gitignore                   # Git除外設定
├── readme.md                    # プロジェクト概要
├── CLAUDE.md                    # Claude Code開発ガイドライン
│
├── # ビジネスロジックモジュール
├── env_store.py                 # .env安全更新
├── stream_notifications.py      # 配信通知制御
├── clip_selector.py             # クリップ選択
├── clip_recast_notifier.py      # リキャスト通知
├── command_cooldown_state.py    # コマンドクールダウン
├── comment_speed_meter.py       # コメント風速計測
├── comment_count_formatter.py   # コメント件数フォーマット
├── comment_state_store.py       # コメント状態永続化
├── message_filters.py           # メッセージフィルタ
├── manga_selector.py            # DLsiteスクレイピング
├── manga_command_control.py     # manga管理制御
├── chat_message_response.py     # メッセージID取得
├── message_delete_tracker.py    # 削除予約追跡
├── auth_scope_sets.py           # 認証スコープ定義
├── scope_policy.py              # スコープポリシー
├── token_refresh_policy.py      # トークンリフレッシュ判定
├── process_restart.py           # プロセス再起動
├── restart_state_store.py       # 再起動状態管理
│
├── tests/                       # テストディレクトリ
│   ├── test_env_store.py
│   ├── test_clip_selector.py
│   ├── test_clip_recast_notifier.py
│   ├── test_command_cooldown_state.py
│   ├── test_comment_speed_meter.py
│   ├── test_manga_selector.py
│   ├── test_stream_notifications.py
│   └── ... (その他テストファイル)
│
├── docs/                        # ドキュメント
│   ├── ARCHITECTURE.md
│   ├── COMMANDS.md
│   ├── TECH_STACK.md
│   └── DESIGN_PATTERNS.md
│
├── logs/                        # ログディレクトリ（Git管理外）
│   └── bot_YYYY-MM-DD.log
│
├── last_restart.txt             # 最後の再起動時刻
└── start_services.bat           # サービス起動スクリプト
```
