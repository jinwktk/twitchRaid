# アーキテクチャ概要

## プロジェクト概要

Twitch配信者「rukalun」向けのチャットBot。Python + twitchio + twitchAPIで構築。
サブPC（192.168.0.99）で本番稼働中。メインPC（192.168.0.100）からSSHでログ確認可能。

## 主要クラス構成（main.py）

### Config（設定管理）

- `.env`から全設定を読み込み（`dotenv_values`）
- スレッドセーフ（`threading.Lock`）
- トークン、クリップ時間、配信タイトル、mangaコマンド状態を`.env`に書き戻し
- `env_store.py`経由で安全な`.env`更新（バックアップ→temp→replace）

### GitManager（Git操作＆プロセス管理）

- `check_for_updates()`: git fetch → rev-list → pull → 再起動判定
- `restart_with_cooldown()`: 24時間間隔の再起動クールダウン
- `restart_process()`: `os.execv`優先、失敗時`subprocess.Popen`フォールバック
- `_current_branch()`: 現在のブランチを動的検出

### SystemWatcher（バックグラウンド監視）

- `update_watcher()`: 10分間隔でGitHub更新チェック
- `restart_watcher()`: 5分間隔で再起動タイミングチェック
- デーモンスレッドで実行

### Bot（メインTwitchボット）

`twitchio.ext.commands.Bot`を継承。

- WebSocket再接続ロジック（最大10回、指数バックオフ15〜60秒）
- `keep_alive`: 45秒間隔の接続チェック＋2時間ごとのトークンリフレッシュ
- `monitor_stream_status`: 180秒間隔で配信状態監視
- コメント速度計測（`CommentSpeedMeter`）
- クリップコマンドクールダウン管理（`CommandCooldownState`）
- レイド検知→自動シャウトアウト

## スレッドアーキテクチャ

```
メインスレッド
└── asyncio.run(main())
    └── Bot.start()
        ├── monitor_stream_status (asyncioタスク)
        ├── keep_alive (asyncioタスク)
        └── リキャスト通知チェック (keep_alive内)

デーモンスレッド1: update_watcher
└── 10分間隔でgit fetch → 差分検知 → pull → 再起動

デーモンスレッド2: restart_watcher
└── 5分間隔で再起動タイミングチェック（24時間間隔）
```

## モジュール一覧

| ファイル | 責任 |
|---------|------|
| `env_store.py` | `.env`安全更新（バックアップ付きatomic書き込み） |
| `stream_notifications.py` | 配信タイトル差分によるDiscord通知制御 |
| `clip_selector.py` | クリップランダム選択（作成者フィルタ対応） |
| `clip_recast_notifier.py` | クリップコマンドリキャスト完了通知 |
| `command_cooldown_state.py` | コマンド別クールダウン状態管理 |
| `comment_speed_meter.py` | コメント風速計測（直近60秒＋配信全体平均） |
| `comment_count_formatter.py` | コメント件数フォーマット |
| `comment_state_store.py` | コメント状態の`.env`永続化 |
| `message_filters.py` | コマンドメッセージ判定 |
| `manga_selector.py` | DLsiteランキングスクレイピング |
| `manga_command_control.py` | manga管理者判定・有効/無効制御 |
| `chat_message_response.py` | 送信メッセージID取得 |
| `message_delete_tracker.py` | メッセージ削除予約の追跡 |
| `auth_scope_sets.py` | OAuth認証スコープ定義 |
| `scope_policy.py` | スコープ正規化・不足判定 |
| `token_refresh_policy.py` | トークンリフレッシュフォールバック判定 |
| `process_restart.py` | プロセス再起動（execv→Popen） |
| `restart_state_store.py` | 再起動状態の永続化 |

## データフロー

### メッセージ受信フロー

```
Twitch IRC → event_message()
├── echoメッセージ → 削除予約チェック → return
├── コマンドメッセージ → handle_commands() → 各コマンドハンドラ
└── 通常メッセージ → CommentSpeedMeter.record() → .envに状態保存
```

### トークンリフレッシュフロー

```
validate_access_token()
├── 有効 → スコープ確認・ログ出力 → return token
└── 401 → refresh_access_token_advanced()
         ├── HTTP API直接リフレッシュ成功 → return new_token
         └── 失敗 → refresh_access_token_fallback()
                   ├── UserAuthenticator再認可 → return new_token
                   └── 失敗 → return None
```

### デプロイフロー

```
メインPCで開発・コミット・プッシュ
→ サブPCのBotが10分間隔でgit fetch
→ 差分検知 → git pull
→ 24時間クールダウン考慮
→ os.execv でプロセス再起動（失敗時subprocess.Popen）
```
