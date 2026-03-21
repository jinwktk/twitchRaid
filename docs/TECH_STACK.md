# 技術スタック・運用環境

## 使用ライブラリ

| ライブラリ | バージョン | 用途 |
|-----------|----------|------|
| twitchio | 2.9.0 | Twitchチャットボットフレームワーク（IRC/WebSocket） |
| twitchAPI | 4.2.1 | Twitch Helix API（認証、クリップ、配信情報、シャウトアウト） |
| discord-webhook | - | Discord Webhook通知 |
| python-dotenv | - | `.env`設定管理 |
| aiofiles | - | 非同期ファイルI/O |
| requests | - | HTTP通信（DLsiteスクレイピング、トークンリフレッシュ） |
| pytest | - | テストフレームワーク |

## 運用環境

| 環境 | ホスト | パス |
|------|-------|------|
| 本番 | サブPC（192.168.0.99） | `E:\GitHub\twitchRaid` |
| 開発 | メインPC（192.168.0.100） | `C:\Users\mlove\Documents\GitHub\twitchRaid` |

- **SSH接続**: `mlove@192.168.0.99`（公開鍵認証、パスワード不要）
- **OS**: Windows（両PC）

## ログ管理

- **ログディレクトリ**: `./logs/`
- **ファイル名**: `bot_YYYY-MM-DD.log`（日付別）
- **ローテーション**: 10MB上限、10バックアップ保持（`RotatingFileHandler`）
- **フォーマット**: `%(asctime)s [%(levelname)s] %(message)s`
- **レベル**: INFO（本番）

### SSH経由でのログ確認

```bash
# 今日のログ末尾50行
ssh mlove@192.168.0.99 "powershell Get-Content E:\GitHub\twitchRaid\logs\bot_$(Get-Date -Format 'yyyy-MM-dd').log -Tail 50"

# ERRORだけ抽出
ssh mlove@192.168.0.99 "powershell Get-ChildItem E:\GitHub\twitchRaid\logs\*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Select-String -Path $_.FullName -Pattern ERROR -SimpleMatch }"
```

## .env設定一覧

### Twitch認証

| キー | 説明 | 自動更新 |
|-----|------|---------|
| `TWITCH_CLIENT_ID` | Twitch APIクライアントID | いいえ |
| `TWITCH_SECRET_TOKEN` | Twitchシークレット | いいえ |
| `TWITCH_ACCESS_TOKEN` | OAuthアクセストークン | はい（2時間ごと＋認証エラー時） |
| `TWITCH_REFRESH_TOKEN` | OAuthリフレッシュトークン | はい |
| `TWITCH_BROADCASTER_ID` | 配信者のユーザーID | いいえ |
| `TWITCH_MODERATOR_ID` | モデレーターのユーザーID | いいえ |

### Discord

| キー | 説明 |
|-----|------|
| `DISCORD_WEBHOOK_URL` | 配信通知用Webhook URL |

### コマンド設定

| キー | 説明 | 自動更新 |
|-----|------|---------|
| `LAST_CLIP_TIME` | `!clip`最終使用時刻（UNIX timestamp） | はい |
| `LAST_MYCLIP_TIME` | `!myclip`最終使用時刻（UNIX timestamp） | はい |
| `LAST_STREAM_TITLE` | 最後に通知した配信タイトル | はい |
| `CLIP_SPECIAL_USERS` | クールダウン免除ユーザー（カンマ区切り） | いいえ |
| `MANGA_COMMAND_ENABLED` | mangaコマンド有効/無効（0/1） | はい |
| `MANGA_ADMIN_USERS` | manga管理者ユーザー（カンマ区切り） | いいえ |

### .env安全更新フロー（env_store.py）

```
1. 既存.envを読み込み
2. 空ファイルの場合.env.bakから復旧
3. キー一致行を更新、未存在キーは末尾に追記
4. .env.bakにバックアップ作成
5. .env.tmpに書き込み → .envにatomicリネーム（Path.replace）
```

## 認証・トークン管理

### OAuthスコープ

| スコープ | 用途 | 必須 |
|---------|------|------|
| `chat:edit` | チャットメッセージ送信 | はい |
| `chat:read` | チャットメッセージ読み取り | はい |
| `moderator:manage:shoutouts` | シャウトアウト実行 | はい |
| `user:write:chat` | send_chat_message API | manga削除用 |
| `moderator:manage:chat_messages` | メッセージ削除 | manga削除用 |

### トークンリフレッシュフロー

```
1. validate_token() でトークン有効性チェック
2. 401 Unauthorized → refresh_access_token_advanced()
   a. HTTP API直接リフレッシュ（/oauth2/token）
   b. 成功 → 新トークンで.env更新 → 検証
   c. 失敗 → should_try_fallback()で判定
3. フォールバック → refresh_access_token_fallback()
   a. UserAuthenticator で全スコープ再認可
   b. ブラウザベースの認証フロー
```

### スコープ管理

- `active_auth_scopes_from_granted()`: 付与済みスコープからAuthScopeリスト生成
- `missing_scope_values()`: 必須スコープの不足を検出
- `normalize_scope_values()`: 表示用の正規化
- 付与済みスコープは`[ECHO]`ログで出力
- スコープ不足は警告のみ（トークン無効時のみ再取得）

## テスト

### 実行方法

```bash
PYTHONPATH=. pytest -q
```

### テストファイル一覧

| テストファイル | テスト対象 |
|-------------|----------|
| `test_env_store.py` | `.env`更新安全化 |
| `test_restart_state_store.py` | 再起動間隔管理 |
| `test_scope_policy.py` | スコープ反映ロジック |
| `test_token_refresh_policy.py` | トークン刷新フォールバック判定 |
| `test_clip_selector.py` | クリップ選択 |
| `test_clip_recast_notifier.py` | リキャスト通知 |
| `test_command_cooldown_state.py` | コマンドクールダウン |
| `test_comment_speed_meter.py` | コメント風速計測 |
| `test_comment_count_formatter.py` | コメント件数フォーマット |
| `test_comment_state_store.py` | コメント状態永続化 |
| `test_manga_selector.py` | DLsiteスクレイピング |
| `test_manga_command_control.py` | manga権限管理 |
| `test_message_filters.py` | メッセージフィルタ |
| `test_message_delete_tracker.py` | 削除予約追跡 |
| `test_chat_message_response.py` | メッセージID取得 |
| `test_stream_notifications.py` | 配信通知 |
| `test_config.py` | Config設定管理 |
| `test_git_manager.py` | Git操作管理 |
| `test_process_restart.py` | プロセス再起動 |
| `test_system_watcher.py` | システム監視 |
| `test_auth_scope_sets.py` | 認証スコープ定義 |
