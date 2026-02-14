import logging
import os
import aiofiles
from dotenv import dotenv_values
from twitchAPI.twitch import Twitch
from twitchAPI.oauth import UserAuthenticator, validate_token
from twitchAPI.helper import AuthScope
from twitchAPI.type import TwitchAuthorizationException
from twitchio.ext import commands
from discord_webhook import DiscordWebhook
import asyncio
import random
import time
import sys
import subprocess
import threading
from logging.handlers import RotatingFileHandler
from datetime import datetime, date
import requests
import json
from stream_notifications import StreamTitleNotifier
from clip_recast_notifier import ClipRecastNotifier
from comment_speed_meter import CommentSpeedMeter
from comment_count_formatter import format_total_comment_count
from comment_state_store import load_comment_state, save_comment_state
from message_filters import is_command_message
from env_store import update_env_file
from clip_selector import select_clip

# ログディレクトリとファイル設定
import os
from datetime import datetime

# ログディレクトリを作成
log_dir = "./logs"
os.makedirs(log_dir, exist_ok=True)

# 日付別ログファイルパス
today = datetime.now().strftime("%Y-%m-%d")
log_file_path = os.path.join(log_dir, f"bot_{today}.log")

# ログ設定（改善されたローテーション）
log_handler = RotatingFileHandler(
    log_file_path,
    maxBytes=10*1024*1024,  # 10MB（増加）
    backupCount=10,  # 10個のバックアップファイルを保持（増加）
    encoding="utf-8"
)
logging.basicConfig(
    level=logging.INFO,  # DEBUGからINFOに変更
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        log_handler,
        logging.StreamHandler()
    ]
)

def calculate_age():
    """誕生日（8月14日）から現在の年齢を計算"""
    today = date.today()
    birth_month = 8
    birth_day = 14
    
    # 今年の誕生日
    birth_this_year = date(today.year, birth_month, birth_day)
    
    # 今年の誕生日を迎えているかで年齢を計算
    # 2025年8月14日で43歳になるので、1982年生まれ
    birth_year = 1982
    age = today.year - birth_year
    
    # 今年の誕生日をまだ迎えていない場合は1歳引く
    if today < birth_this_year:
        age -= 1
    
    return age

class Config:
    """設定管理クラス"""
    def __init__(self, env_file=".env"):
        self.env_values = dotenv_values(env_file)
        self.env_file = env_file
        
        # Twitch設定
        self.LOGIN_CHANNEL = "rukalun"
        self.COMMAND_PREFIX = "!"
        self.TWITCH_CLIENT_ID = self.env_values.get("TWITCH_CLIENT_ID", "")
        self.TWITCH_ACCESS_TOKEN = self.env_values.get("TWITCH_ACCESS_TOKEN", "")
        self.TWITCH_REFRESH_TOKEN = self.env_values.get("TWITCH_REFRESH_TOKEN", "")
        self.TWITCH_SECRET_TOKEN = self.env_values.get("TWITCH_SECRET_TOKEN", "")
        self.TWITCH_BROADCASTER_ID = self.env_values.get("TWITCH_BROADCASTER_ID", "")
        self.TWITCH_MODERATOR_ID = self.env_values.get("TWITCH_MODERATOR_ID", "")
        
        # Discord設定
        self.DISCORD_WEBHOOK_URL = self.env_values.get("DISCORD_WEBHOOK_URL", "")
        
        # システム設定
        self.LAST_CLIP_TIME = float(self.env_values.get("LAST_CLIP_TIME", 0.0))
        self.LAST_STREAM_TITLE = self.env_values.get("LAST_STREAM_TITLE", "")
        self.RESTART_INTERVAL = 60 * 60 * 24  # 1日（秒）
        self.RESTART_FILE = "last_restart.txt"
        self.UPDATE_CHECK_INTERVAL = 600  # 10分（秒）
        self.RESTART_CHECK_INTERVAL = 300  # 5分（秒）
        
        # 特別ユーザー設定（Clipコマンドクールダウン無し）
        special_users_str = self.env_values.get("CLIP_SPECIAL_USERS", "nyme_ia,rukalun")
        self.CLIP_SPECIAL_USERS = [user.strip().lower() for user in special_users_str.split(",") if user.strip()]
    
    def update_access_token(self, access_token, refresh_token):
        """アクセストークンを更新"""
        self.TWITCH_ACCESS_TOKEN = access_token
        self.TWITCH_REFRESH_TOKEN = refresh_token
        
        # 環境変数を更新
        os.environ["TWITCH_ACCESS_TOKEN"] = access_token
        os.environ["TWITCH_REFRESH_TOKEN"] = refresh_token
        
        # .envファイルを更新
        update_env_file(
            self.env_file,
            {
                "TWITCH_ACCESS_TOKEN": access_token,
                "TWITCH_REFRESH_TOKEN": refresh_token,
            },
        )
    
    def update_last_clip_time(self, timestamp):
        """最新のクリップ時間を更新"""
        self.LAST_CLIP_TIME = timestamp
        os.environ["LAST_CLIP_TIME"] = str(timestamp)
        
        # .envファイルを更新
        update_env_file(self.env_file, {"LAST_CLIP_TIME": str(timestamp)})
    
    def update_last_stream_title(self, title: str):
        """最新の配信タイトルを記録"""
        normalized = title.strip()
        self.LAST_STREAM_TITLE = normalized
        os.environ["LAST_STREAM_TITLE"] = normalized
        update_env_file(self.env_file, {"LAST_STREAM_TITLE": normalized})
    
    def get_last_stream_title(self) -> str:
        """`.env` から最新の配信タイトルを取得"""
        try:
            values = dotenv_values(self.env_file)
            stored = values.get("LAST_STREAM_TITLE", "")
        except Exception as exc:
            logging.error(f"⚠️ LAST_STREAM_TITLE 読み込み失敗: {exc}")
            stored = self.LAST_STREAM_TITLE
        normalized = stored.strip()
        self.LAST_STREAM_TITLE = normalized
        return normalized

class GitManager:
    """Git操作管理クラス"""
    def __init__(self, config):
        self.config = config
    
    def should_restart(self):
        """再起動が必要かどうかを判定"""
        now = time.time()
        try:
            with open(self.config.RESTART_FILE, "r") as f:
                last = float(f.read())
        except:
            last = 0
        
        if now - last > self.config.RESTART_INTERVAL:
            with open(self.config.RESTART_FILE, "w") as f:
                f.write(str(now))
            return True
        return False
    
    def pull_and_restart_if_updated(self):
        """プルして更新があれば再起動"""
        result = subprocess.run(["git", "pull"], capture_output=True, text=True)
        logging.info(f"Git pull結果: {result.stdout}")
        
        if "Already up to date" not in result.stdout:
            logging.info("更新があったので再起動します")
            self.restart_process()
    
    def check_for_updates(self):
        """リモートの更新をチェック"""
        try:
            # リモートの最新情報を取得
            fetch_result = subprocess.run(["git", "fetch"], capture_output=True, text=True)
            if fetch_result.returncode != 0:
                logging.error(f"git fetch エラー: {fetch_result.stderr}")
                return False
            
            # リモートとローカルの差分を確認
            result = subprocess.run(
                ["git", "rev-list", "HEAD...origin/main", "--count"], 
                capture_output=True, text=True
            )
            
            if result.returncode != 0:
                logging.error(f"git rev-list エラー: {result.stderr}")
                return False
            
            updates_count = result.stdout.strip()
            if updates_count != "0":
                logging.info(f"リモートに {updates_count} 件の更新があります。プルして再起動します...")
                
                # プルを実行
                pull_result = subprocess.run(["git", "pull"], capture_output=True, text=True)
                if pull_result.returncode == 0:
                    logging.info("プル成功。再起動します...")
                    logging.info(f"プル結果: {pull_result.stdout}")
                    self.restart_process()
                    return True
                else:
                    logging.error(f"プルエラー: {pull_result.stderr}")
                    return False
            else:
                logging.info("更新なし - 最新状態です")
                return False
                
        except Exception as e:
            logging.error(f"GitHub更新確認エラー: {e}")
            return False
    
    def restart_process(self):
        """プロセスを再起動"""
        logging.info("プロセスを再起動します...")
        time.sleep(5)  # 安全な待機時間
        
        try:
            # より安全な再起動方法：subprocess + os._exit
            logging.info(f"🔄 Python実行パス: {sys.executable}")
            logging.info(f"🔄 起動引数: {sys.argv}")
            
            # 新しいプロセスを起動
            subprocess.Popen([sys.executable] + sys.argv, 
                           cwd=os.getcwd(),
                           creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0)
            
            logging.info("✅ 新プロセス起動完了。現プロセスを終了します...")
            time.sleep(2)
            
            # 現在のプロセスを即座に終了
            os._exit(0)
            
        except Exception as e:
            logging.error(f"❌ プロセス再起動失敗: {e}")
            # フォールバック: 従来のos.execv方式
            try:
                os.execv(sys.executable, [sys.executable] + sys.argv)
            except Exception as exec_error:
                logging.error(f"❌ execv再起動も失敗: {exec_error}")
                # 最後の手段: プロセス終了のみ
                logging.error("🚨 強制終了します。手動で再起動してください。")
                os._exit(1)

class SystemWatcher:
    """システム監視クラス"""
    def __init__(self, git_manager):
        self.git_manager = git_manager
    
    def update_watcher(self):
        """GitHub更新監視機能"""
        while True:
            try:
                time.sleep(self.git_manager.config.UPDATE_CHECK_INTERVAL)
                logging.info("GitHub更新確認中...")
                self.git_manager.check_for_updates()
                
            except Exception as e:
                logging.error(f"GitHub更新監視エラー: {e}")
                time.sleep(300)  # エラー時は5分待機してリトライ
    
    def restart_watcher(self):
        """定期再起動監視機能"""
        while True:
            try:
                time.sleep(self.git_manager.config.RESTART_CHECK_INTERVAL)
                if self.git_manager.should_restart():
                    logging.info("1日経過したので再起動を開始します...")
                    logging.info("再起動前の最終ログ - プロセス終了")
                    self.git_manager.restart_process()
                    
            except Exception as e:
                logging.error(f"再起動監視エラー: {e}")
                time.sleep(300)  # エラー時は5分待機してリトライ

# グローバル設定インスタンス
config = Config()
git_manager = GitManager(config)
system_watcher = SystemWatcher(git_manager)

# 起動時の処理
logging.info("=== TwitchRaid Bot Starting ===")
logging.info("GitHub更新チェックを実行中...")
git_manager.pull_and_restart_if_updated()

# 監視スレッド起動
logging.info("GitHub更新監視スレッドを開始...")
threading.Thread(target=system_watcher.update_watcher, daemon=True).start()

logging.info("定期再起動監視スレッドを開始...")
threading.Thread(target=system_watcher.restart_watcher, daemon=True).start()

logging.info("全ての監視スレッドが開始されました。")

# Twitch Bot クラスの定義
class Bot(commands.Bot):
    def __init__(self, token, config):
        self.config = config
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self.reconnect_delay = 30  # 初期再接続待機時間（秒）
        self.last_activity_time = time.time()  # アクティビティ追跡用
        self._reconnecting = False  # 再接続状態フラグ
        self.stream_notifier = StreamTitleNotifier(self.config, self.config.LOGIN_CHANNEL)
        self.clip_recast_notifier = ClipRecastNotifier(
            cooldown_seconds=1800,
            ready_message="⏱️ `clip` コマンドのリキャストが戻りました！もう一度 `!clip` でクリップできます。"
        )
        self.clip_recast_channel_name = self.config.LOGIN_CHANNEL
        self.comment_speed_meter = CommentSpeedMeter(window_seconds=60)
        total_count, stream_started_at = load_comment_state(self.config.env_file)
        self.comment_speed_meter.set_state(stream_started_at, total_count)
        try:
            super().__init__(
                token=token,
                prefix=self.config.COMMAND_PREFIX,
                initial_channels=[self.config.LOGIN_CHANNEL],
                heartbeat=30
            )
            self.twitch = Twitch(self.config.TWITCH_CLIENT_ID, self.config.TWITCH_SECRET_TOKEN)
            self.stream_live = True
            
        except TwitchAuthorizationException:
            logging.error("❌ 無効なリフレッシュトークン。新しい認証を開始します。")
            asyncio.create_task(refresh_access_token_advanced(self.config))

    async def initialize(self):
        """ 非同期初期化メソッド """
        if not self.config.TWITCH_ACCESS_TOKEN or not self.config.TWITCH_REFRESH_TOKEN:
            logging.warning("⚠️ アクセストークンが見つかりません。新しいトークンを取得します。")
            await refresh_access_token_advanced(self.config)
        await self.twitch.set_user_authentication(
            self.config.TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            self.config.TWITCH_REFRESH_TOKEN
        )

    # 配信のステータスを監視する非同期関数
    async def monitor_stream_status(self):
        error_count = 0
        max_errors = 5
        
        while True:
            try:
                streams = [stream async for stream in self.twitch.get_streams(user_login=self.config.LOGIN_CHANNEL)]
                if streams:
                    if not self.stream_live:
                        stream_title = streams[0].title
                        logging.info(f"🎥 配信が開始されました！タイトル: {stream_title}")
                        started_at = time.time()
                        self.comment_speed_meter.start_stream(started_at)
                        save_comment_state(self.config.env_file, 0, started_at)
                        self.stream_live = True
                        self.stream_notifier.notify_if_needed(stream_title, self.send_discord_notification)
                    if self.comment_speed_meter.stream_started_at() is None:
                        started_at = time.time()
                        self.comment_speed_meter.ensure_stream_started(started_at)
                        save_comment_state(
                            self.config.env_file,
                            self.comment_speed_meter.total_count(),
                            started_at,
                        )
                else:
                    if self.stream_live:
                        logging.info("📢 配信が終了しました！")
                        self.comment_speed_meter.reset_stream()
                        save_comment_state(self.config.env_file, 0, 0.0)
                        self.stream_live = False
                
                error_count = 0  # 成功したらエラーカウントをリセット
                
            except TwitchAuthorizationException as e:
                error_count += 1
                logging.error(f"⚠️ 配信状態チェック認証エラー ({error_count}/{max_errors}): {e}")
                
                if error_count >= max_errors:
                    logging.warning("🔄 エラーが続くため、トークンを自動更新します...")
                    new_token = await refresh_access_token_advanced(self.config)
                    if new_token:
                        # Twitchクライアントを再初期化
                        await self.twitch.set_user_authentication(
                            self.config.TWITCH_ACCESS_TOKEN,
                            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
                            self.config.TWITCH_REFRESH_TOKEN
                        )
                        error_count = 0
                        logging.info("✅ トークン更新完了。監視を継続します。")
                    else:
                        logging.error("❌ トークン更新失敗。30秒後に再試行します。")
                        await asyncio.sleep(30)
                        
            except Exception as e:
                logging.error(f"⚠️ 配信状態チェックエラー: {e}")
                
            await asyncio.sleep(180)  # 180秒ごとにチェック

    def send_discord_notification(self, message):
        """ Discord Webhook で通知を送る """
        if not self.config.DISCORD_WEBHOOK_URL:
            logging.warning("⚠️ DISCORD_WEBHOOK_URL が設定されていません。")
            return

        try:
            webhook = DiscordWebhook(url=self.config.DISCORD_WEBHOOK_URL, content=message)
            response = webhook.execute()
            logging.info(f"✅ Discord に通知を送信しました: {response}")
        except Exception as e:
            logging.error(f"❌ Discord Webhook の送信に失敗しました: {e}")

    async def get_stream_info(self):
        """ 現在の配信情報（タイトル・カテゴリなど）を取得 """
        try:
            async for info in self.twitch.get_channel_information(broadcaster_id=self.config.TWITCH_BROADCASTER_ID):
                return info
        except Exception as e:
            logging.error(f"❌ Failed to fetch stream info: {e}")
        return None


    # Botが起動した時に実行されるイベント
    async def event_ready(self):
        await validate_access_token(self.config)
        logging.info("✅ 全てのチャンネルにログインしました。")
        # TwitchIO 3.xでは属性名が変更されている可能性があるため、安全にチェック
        if hasattr(self, 'user_id'):
            logging.info(f'ユーザーID: {self.user_id}')
        elif hasattr(self, 'id'):
            logging.info(f'ユーザーID: {self.id}')
        
        if hasattr(self, 'nick'):
            logging.info(f'ユーザー名: {self.nick}')
        elif hasattr(self, 'name'):
            logging.info(f'ユーザー名: {self.name}')
        elif hasattr(self, 'display_name'):
            logging.info(f'ユーザー名: {self.display_name}')
        
        # 再接続成功時はカウンターをリセット
        self.reconnect_attempts = 0
        self.reconnect_delay = 30

        asyncio.create_task(self.monitor_stream_status())
        asyncio.create_task(self.keep_alive())  # キープアライブタスクを開始
        self.last_clip_time = self.config.LAST_CLIP_TIME
        cooldown_elapsed = time.time() - self.last_clip_time if self.last_clip_time else None
        if self.last_clip_time and cooldown_elapsed is not None:
            if cooldown_elapsed < self.clip_recast_notifier.cooldown_seconds:
                self.clip_recast_notifier.arm(
                    started_at=self.last_clip_time,
                    send_coroutine=self._default_clip_sender()
                )
                logging.info("⏱️ Clipコマンドのリキャスト監視を再開しました。")
            else:
                self.clip_recast_notifier.disarm()
        else:
            self.clip_recast_notifier.disarm()
        
        # 接続状態の詳細をログ出力 - 属性名を安全にチェック
        channels = getattr(self, 'initial_channels', None) or getattr(self, '_initial_channels', None) or [self.config.LOGIN_CHANNEL]
        prefix = getattr(self, 'prefix', None) or getattr(self, '_prefix', None) or self.config.COMMAND_PREFIX
        logging.info(f"🔗 接続詳細: チャンネル={channels}, プレフィックス='{prefix}'")
        logging.info(f"⚙️ Clip特別ユーザー: {self.config.CLIP_SPECIAL_USERS}")

    async def event_join(self, channel, user):
        """チャンネル参加イベント"""
        logging.info(f"📥 ユーザー参加: {user.name} が {channel.name} に参加")


    async def event_message(self, message):
        """メッセージ受信イベント - デバッグ用"""
        # アクティビティタイムスタンプを更新
        self.last_activity_time = time.time()
        
        # 詳細なデバッグ情報を出力
        logging.info(f"[DEBUG] メッセージ受信: echo={message.echo}, content='{message.content}', author={message.author.name if message.author else 'None'}")
        
        # echoやbotの自分のメッセージをスキップしないで全て処理
        if message.echo:
            logging.info("[DEBUG] 自分のメッセージなのでスキップ")
            return
            
        if not message.content:
            logging.info("[DEBUG] 空のメッセージなのでスキップ")
            return
        
        logging.info(f"✅ メッセージ受信: {message.author.name}: {message.content}")
        
        # コマンドかどうかをチェック
        is_command = is_command_message(message.content, self.config.COMMAND_PREFIX)
        if is_command:
            logging.info(f"🤖 コマンド検出: {message.content}")
        else:
            self.comment_speed_meter.record(time.time())
            started_at = self.comment_speed_meter.stream_started_at() or 0.0
            save_comment_state(
                self.config.env_file,
                self.comment_speed_meter.total_count(),
                started_at,
            )
        
        # 親クラスのメッセージ処理を呼び出し
        await self.handle_commands(message)

    def _default_clip_sender(self):
        """Clipリキャスト通知を送るための送信関数を生成"""
        channel_name = self.clip_recast_channel_name or self.config.LOGIN_CHANNEL

        async def sender(message: str):
            channel = None
            try:
                channel = self.get_channel(channel_name)
            except Exception as exc:
                logging.warning(f"Clipリキャスト通知のチャンネル取得に失敗: {exc}")

            if channel is None:
                connected = getattr(self, "connected_channels", None)
                if connected:
                    channel = connected[0]

            if channel is None:
                logging.warning(f"Clipリキャスト通知: チャンネル '{channel_name}' が未接続のため通知できませんでした。")
                return

            try:
                await channel.send(message)
            except Exception as send_error:
                logging.error(f"Clipリキャスト通知送信に失敗: {send_error}")

        return sender


    async def send_shoutout(self, to_broadcaster_id, retry=False):
        try:
            await self.twitch.send_a_shoutout(
                from_broadcaster_id=self.config.TWITCH_BROADCASTER_ID,
                to_broadcaster_id=to_broadcaster_id,
                moderator_id=self.config.TWITCH_MODERATOR_ID
            )
            logging.info(f"✅ Shoutout successfully sent to broadcaster {to_broadcaster_id}")
        except TwitchAuthorizationException:
            if not retry:
                logging.warning("⚠️ Authorization error detected, refreshing token and retrying...")
                await refresh_access_token_advanced(self.config)
                await self.send_shoutout(to_broadcaster_id, retry=True)
            else:
                logging.error("❌ Failed to send shoutout even after refreshing token.")
        except Exception as e:
            logging.error(f"❌ Failed to send shoutout: {e}")

    @commands.command(name='age')
    async def age_command(self, ctx):
        await validate_access_token(self.config)
        age = calculate_age()
        await ctx.send(str(age))

    @commands.command(name='goods')
    async def goods_command(self, ctx):
        await validate_access_token(self.config)
        await ctx.send("https://rukalun.booth.pm")
        
    @commands.command(name='weight')
    async def weight_command(self, ctx):
        await validate_access_token(self.config)
        # 面白さ重視で桁外れも含む幅広い範囲（15-200kg）でランダム生成
        weight = random.randint(15, 200)
        await ctx.send(f"{weight}kg")

    @commands.command(name='height')
    async def height_command(self, ctx):
        await validate_access_token(self.config)
        # 身長をランダム生成（120-220cm）
        height = random.randint(120, 220)
        await ctx.send(f"{height}cm")

    @commands.command(name='mood')
    async def mood_command(self, ctx):
        await validate_access_token(self.config)
        # 今日の気分をランダム選択
        moods = ["絶好調！", "眠い...", "お腹すいた", "やる気MAX", "ダルい", 
                "ハッピー♪", "ちょっと疲れた", "最高の気分", "普通", "テンション低め",
                "無敵モード", "まったり", "ワクワク", "ぼんやり", "元気いっぱい"]
        mood = random.choice(moods)
        await ctx.send(f"今日の気分：{mood}")

    @commands.command(name='menu')
    async def menu_command(self, ctx):
        await validate_access_token(self.config)
        # おすすめメニュー
        foods = ["ラーメン", "カレー", "寿司", "ピザ", "ハンバーガー", "パスタ", 
                "うどん", "そば", "焼肉", "唐揚げ", "オムライス", "チャーハン",
                "サンドイッチ", "お好み焼き", "たこ焼き", "親子丼", "天ぷら", 
                "しゃぶしゃぶ", "餃子", "麻婆豆腐", "牛丼", "豚丼", "かつ丼",
                "海鮮丼", "中華丼", "ステーキ", "ハンバーグ", "生姜焼き", "回鍋肉",
                "青椒肉絲", "酢豚", "エビチリ", "麻婆茄子", "八宝菜", "春巻き",
                "小籠包", "焼き鳥", "刺身", "寿司", "海鮮丼", "鉄火丼",
                "ちらし寿司", "握り寿司", "海苔巻き", "いなり寿司", "手巻き寿司",
                "煮物", "肉じゃが", "筑前煮", "角煮", "手羽先", "鶏の照り焼き",
                "魚の煮付け", "刺身定食", "焼き魚定食", "とんかつ", "チキンカツ",
                "メンチカツ", "コロッケ", "エビフライ", "アジフライ", "イカリング",
                "グラタン", "ドリア", "リゾット", "スパゲッティ", "ペンネ",
                "ラザニア", "ニョッキ", "カルボナーラ", "ペペロンチーノ", "ボロネーゼ"]
        food = random.choice(foods)
        await ctx.send(f"今日のおすすめ：{food}")

    @commands.command(name='speed')
    async def speed_command(self, ctx):
        await validate_access_token(self.config)
        current_time = time.time()
        rate = self.comment_speed_meter.rate_per_minute(current_time)
        count = self.comment_speed_meter.count(current_time)
        total_rate = self.comment_speed_meter.total_rate_per_minute(current_time)
        total_count = self.comment_speed_meter.total_count()
        await ctx.send(
            f"コメント風速: 直近60秒 {rate}/分 ({count}件) / "
            f"配信全体 {total_rate}/分 ({total_count}件)"
        )

    @commands.command(name='commentcount')
    async def commentcount_command(self, ctx):
        await validate_access_token(self.config)
        total_count = self.comment_speed_meter.total_count()
        await ctx.send(format_total_comment_count(total_count))

    async def get_clips_info(self, creator_id=None, creator_name=None):
        try:
            return await select_clip(
                twitch=self.twitch,
                broadcaster_id=self.config.TWITCH_BROADCASTER_ID,
                creator_id=creator_id,
                creator_name=creator_name,
            )
        except Exception as e:
            logging.error(f"❌ Failed to fetch clips: {e}")

    async def _handle_clip_command(self, ctx, command_name, creator_id=None, creator_name=None):
        # .envで設定された特別ユーザーはクールダウン無しで実行可能
        is_special_user = ctx.author.name.lower() in self.config.CLIP_SPECIAL_USERS
        self.clip_recast_channel_name = getattr(ctx.channel, "name", self.config.LOGIN_CHANNEL)

        current_time = time.time()

        # 一般ユーザーは30分クールダウンをチェック
        if (
            not is_special_user
            and self.last_clip_time
            and current_time - self.last_clip_time < 1800
        ):
            remaining_time = int(1800 - (current_time - self.last_clip_time))
            await ctx.send(
                f"⚠️ `{command_name}` コマンドは 30分に1回のみ使用できます。"
                f"あと {remaining_time // 60}分 {remaining_time % 60}秒 待ってください。"
            )
            self.clip_recast_notifier.arm(
                started_at=self.last_clip_time,
                send_coroutine=ctx.send
            )
            return

        await validate_access_token(self.config)
        clip = await self.get_clips_info(creator_id=creator_id, creator_name=creator_name)
        if clip:
            await ctx.send(clip.url)

            # 特別ユーザー以外の場合のみクールダウン時間を更新
            if not is_special_user:
                self.last_clip_time = current_time
                self.config.update_last_clip_time(current_time)
                self.clip_recast_notifier.arm(
                    started_at=current_time,
                    send_coroutine=ctx.send
                )
        else:
            if creator_id is not None or creator_name:
                await ctx.send("⚠️ あなたが作成したクリップが見つかりませんでした。")
            else:
                await ctx.send("⚠️ クリップが見つかりませんでした。")
    
    @commands.command(name='clip')
    async def clip_command(self, ctx):
        await self._handle_clip_command(ctx, command_name="clip")

    @commands.command(name='myclip')
    async def myclip_command(self, ctx):
        requester_id = getattr(ctx.author, "id", None)
        requester_name = getattr(ctx.author, "name", None)
        await self._handle_clip_command(
            ctx,
            command_name="myclip",
            creator_id=requester_id,
            creator_name=requester_name,
        )


    async def event_raw_usernotice(self, channel, tags):
        logging.debug(f"Raw USERNOTICE tags: {tags}")
        if tags['msg-id'] == 'raid':
            raider_name = tags.get('msg-param-login')
            raider_id = tags.get('user-id')
            logging.info(f"Raid detected from {raider_name}. Sending shoutout.")
            await self.send_shoutout(raider_id)
    
    async def event_error(self, error: Exception, data=None):
        """エラーイベントのハンドリング"""
        error_str = str(error)
        
        # WebSocket切断エラーの詳細検出
        websocket_errors = [
            "Websocket connection was closed",
            "Connection reset by peer", 
            "Connection aborted",
            "Connection lost",
            "WebSocket connection lost",
            "Connection closed"
        ]
        
        is_websocket_error = any(ws_error in error_str for ws_error in websocket_errors)
        
        if is_websocket_error or isinstance(error, ConnectionError):
            logging.warning(f"🔌 WebSocket接続問題を検出: {error_str}")
            # 即座に再接続を試行せず、少し待ってから処理
            asyncio.create_task(self.delayed_reconnect())
        else:
            logging.error(f"❌ その他のエラー: {error_str} (型: {type(error).__name__})")
            # 詳細なエラー情報を取得
            if hasattr(error, '__dict__') and error.__dict__:
                logging.error(f"エラー詳細: {error.__dict__}")
    
    async def delayed_reconnect(self):
        """遅延再接続処理 - WebSocket切断エラー専用"""
        # 5秒待ってから再接続判定
        await asyncio.sleep(5)
        
        # 既に再接続処理中なら重複実行を避ける
        if hasattr(self, '_reconnecting') and self._reconnecting:
            return
            
        self._reconnecting = True
        
        try:
            if self.reconnect_attempts >= self.max_reconnect_attempts:
                logging.error(f"🚨 最大再接続試行回数（{self.max_reconnect_attempts}回）到達。プロセス再起動を実行...")
                git_manager.restart_process()
                return
            
            self.reconnect_attempts += 1
            wait_time = min(15 + (self.reconnect_attempts * 5), 60)  # 15-60秒の範囲で段階的に増加
            
            logging.info(f"🔄 WebSocket再接続開始 ({self.reconnect_attempts}/{self.max_reconnect_attempts}) - {wait_time}秒待機...")
            await asyncio.sleep(wait_time)
            
            # 完全な再起動アプローチ
            logging.info("🔧 ボット接続を完全リセット中...")
            
            # 既存接続を強制クローズ
            try:
                if hasattr(self, '_connection') and self._connection:
                    await self._connection.close()
                if hasattr(self, 'loop'):
                    self.loop.stop()
            except:
                pass  # クローズエラーは無視
                
            await asyncio.sleep(10)  # 完全なクリーンアップ待機
            
            # トークン再検証
            valid_token = await get_valid_access_token(self.config)
            if not valid_token:
                logging.error("❌ トークン検証失敗。再試行をスケジュール...")
                self._reconnecting = False
                asyncio.create_task(self.delayed_reconnect())
                return
            
            # 新しいBotインスタンスで再起動
            logging.info("🚀 新しい接続で再起動中...")
            await self._restart_with_new_connection(valid_token)
            
        except Exception as e:
            logging.error(f"❌ 再接続処理中の致命的エラー: {e}")
            self._reconnecting = False
            # 致命的エラーの場合は短時間後に再試行
            if self.reconnect_attempts < self.max_reconnect_attempts:
                await asyncio.sleep(30)
                asyncio.create_task(self.delayed_reconnect())
            else:
                git_manager.restart_process()
    
    async def _restart_with_new_connection(self, token):
        """新しい接続でボットを再起動"""
        try:
            # 新しいBotインスタンス作成は危険なので、プロセス再起動を推奨
            logging.info("🔄 安全のためプロセス全体を再起動します...")
            git_manager.restart_process()
            
        except Exception as e:
            logging.error(f"❌ 接続再起動中にエラー: {e}")
            git_manager.restart_process()
    
    async def keep_alive(self):
        """改善されたキープアライブとヘルスチェック"""
        token_refresh_interval = 3600 * 2  # 2時間ごとにトークンをリフレッシュ
        last_token_refresh = time.time()
        connection_check_interval = 45  # 45秒ごとに接続チェック
        last_activity_time = time.time()
        
        while True:
            try:
                await asyncio.sleep(connection_check_interval)
                current_time = time.time()
                
                # 接続状態の詳細チェック
                connection_ok = True
                
                # WebSocket接続状態をチェック
                if hasattr(self, '_connection') and self._connection:
                    if not self._connection.is_alive:
                        connection_ok = False
                        logging.warning("🔌 WebSocket接続が非アクティブです")
                else:
                    connection_ok = False
                    logging.warning("🔌 WebSocket接続オブジェクトが見つかりません")
                
                # 長時間活動がない場合の検出
                if current_time - last_activity_time > 300:  # 5分間活動なし
                    logging.warning("⚠️ 5分間メッセージやイベントが無く、接続が停止している可能性があります")
                    connection_ok = False
                
                # 接続問題が検出された場合の対処
                if not connection_ok:
                    if not (hasattr(self, '_reconnecting') and self._reconnecting):
                        logging.info("🔄 予防的再接続を開始...")
                        asyncio.create_task(self.delayed_reconnect())
                
                # 定期的なトークンリフレッシュ（2時間ごと）
                if current_time - last_token_refresh > token_refresh_interval:
                    logging.info("⏰ 定期トークンリフレッシュを実行...")
                    new_token = await refresh_access_token_advanced(self.config)
                    if new_token:
                        last_token_refresh = current_time
                        logging.info("✅ 定期トークンリフレッシュ完了")
                        try:
                            await self.twitch.set_user_authentication(
                                self.config.TWITCH_ACCESS_TOKEN,
                                [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
                                self.config.TWITCH_REFRESH_TOKEN
                            )
                        except Exception as auth_error:
                            logging.warning(f"認証更新中にエラー: {auth_error}")
                    else:
                        logging.warning("⚠️ 定期トークンリフレッシュ失敗。次回再試行します。")
                
                # アクティビティタイムスタンプ更新（メッセージ受信時に更新される想定）
                if connection_ok:
                    self.last_activity_time = current_time
                    last_activity_time = current_time

                try:
                    await self.clip_recast_notifier.notify_if_ready(current_time)
                except Exception as notifier_error:
                    logging.error(f"Clipリキャスト通知処理中にエラー: {notifier_error}")
                
            except Exception as e:
                logging.error(f"❌ キープアライブ中にエラー: {e}")
                await asyncio.sleep(30)  # エラー時は短めの待機時間


async def validate_access_token(config):
    """ Twitchのアクセストークンの有効性を検証し、無効ならリフレッシュする """
    try:
        token_data = await validate_token(config.TWITCH_ACCESS_TOKEN)

        # 🔍 APIレスポンスの内容をログに記録（デバッグ用）
        logging.debug(f"📝 validate_token() のレスポンス: {token_data}")

        # トークンが無効（401 Unauthorized）なら、リフレッシュ
        if isinstance(token_data, dict) and token_data.get("status") == 401:
            logging.warning("⚠️ アクセストークンが無効です（401 Unauthorized）。リフレッシュを試みます...")
            return await refresh_access_token_advanced(config)  # 高度な自動リフレッシュ

        # `user_name` の代わりに `login` を使用する
        user_name = token_data.get('login')
        client_id = token_data.get('client_id')

        if user_name:
            logging.info(f"✅ アクセストークンは有効: {user_name} (Client ID: {client_id})")
            return config.TWITCH_ACCESS_TOKEN  # 有効なトークンを返す

        logging.warning("⚠️ 'login' キーがレスポンスに存在しません。トークンが無効の可能性があります。")
        return None  # トークンが無効
    except Exception as e:
        logging.error(f"❌ Twitchトークンの検証中にエラー: {e}")
        return None  # 不明なエラー


async def refresh_access_token_advanced(config):
    """ 高度な自動トークンリフレッシュ - 完全自動化対応 """
    try:
        logging.info("🚀 限界突破モード: 高度な自動トークンリフレッシュを開始...")
        
        # まずHTTP APIで直接リフレッシュを試みる
        token_url = "https://id.twitch.tv/oauth2/token"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": config.TWITCH_REFRESH_TOKEN,
            "client_id": config.TWITCH_CLIENT_ID,
            "client_secret": config.TWITCH_SECRET_TOKEN
        }
        
        logging.info("📡 Twitch APIに直接リクエスト送信中...")
        response = await asyncio.get_event_loop().run_in_executor(
            None, 
            lambda: requests.post(token_url, data=data, timeout=10)
        )
        
        if response.status_code == 200:
            token_data = response.json()
            new_access_token = token_data.get("access_token")
            new_refresh_token = token_data.get("refresh_token")
            
            if new_access_token:
                logging.info("⚡ 超高速トークン更新成功！")
                config.update_access_token(new_access_token, new_refresh_token or config.TWITCH_REFRESH_TOKEN)
                
                # トークン検証
                validate_url = "https://id.twitch.tv/oauth2/validate"
                headers = {"Authorization": f"OAuth {new_access_token}"}
                validate_response = await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: requests.get(validate_url, headers=headers, timeout=5)
                )
                
                if validate_response.status_code == 200:
                    validate_data = validate_response.json()
                    logging.info(f"✨ トークン検証完了: User={validate_data.get('login')}, Expires={validate_data.get('expires_in')}秒")
                    return new_access_token
        
        elif response.status_code == 400:
            error_data = response.json()
            if "Invalid refresh token" in str(error_data):
                logging.warning("⚠️ リフレッシュトークン無効。フォールバック処理を実行...")
                # フォールバック: 従来の方法を試す
                return await refresh_access_token_fallback(config)
        
        logging.error(f"❌ トークンリフレッシュ失敗: {response.status_code}")
        return None
        
    except Exception as e:
        logging.error(f"❌ 高度なトークンリフレッシュ中にエラー: {e}")
        # エラー時はフォールバック
        return await refresh_access_token_fallback(config)

async def refresh_access_token_fallback(config):
    """ フォールバック用の従来のトークンリフレッシュ """
    try:
        logging.info("🔄 フォールバック: 従来の方法でトークンリフレッシュ中...")
        twitch = Twitch(config.TWITCH_CLIENT_ID, config.TWITCH_SECRET_TOKEN)
        auth = UserAuthenticator(
            twitch, 
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS]
        )
        token_data = await auth.authenticate()

        if not token_data:
            logging.error("❌ トークンの取得に失敗しました。")
            return None

        access_token, refresh_token = token_data[:2]
        config.update_access_token(access_token, refresh_token)

        # Twitchの認証情報を更新
        await twitch.set_user_authentication(
            config.TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            config.TWITCH_REFRESH_TOKEN
        )

        logging.info("✅ フォールバック成功！新しいアクセストークンを取得しました！")
        return config.TWITCH_ACCESS_TOKEN

    except Exception as e:
        logging.error(f"❌ フォールバックも失敗: {e}")
        return None

async def refresh_access_token(config):
    """ 後方互換性のためのラッパー関数 """
    return await refresh_access_token_advanced(config)


async def get_valid_access_token(config):
    """ 有効なTwitchアクセストークンを取得し、必要ならリフレッシュ """
    is_valid = await validate_access_token(config)
    
    if is_valid:
        return config.TWITCH_ACCESS_TOKEN  # 有効ならそのまま返す
    else:
        logging.info("🔄 無効なトークンを検出。新しいトークンを取得します...")
        new_token = await refresh_access_token_advanced(config)

        if not new_token:
            logging.error("❌ トークンの更新に失敗しました。手動で `.env` を修正してください。")
            sys.exit(1)  # プログラムを強制終了
        return new_token


async def main():
    global bot
    max_retries = 10  # 限界突破: 再試行回数を増やす
    retry_count = 0
    backoff_delay = 10  # 初期待機時間
    
    while retry_count < max_retries:
        try:
            # 事前に有効なアクセストークンを取得
            valid_token = await get_valid_access_token(config)

            if not valid_token:
                logging.warning(f"⚠️ トークン取得失敗 ({retry_count + 1}/{max_retries})。自動リトライします...")
                retry_count += 1
                wait_time = min(backoff_delay * (2 ** retry_count), 300)  # 最大5分
                await asyncio.sleep(wait_time)
                continue

            bot = Bot(valid_token, config)
            
            await bot.initialize()
            await bot.start()
            break  # 正常に起動したらループを抜ける
            
        except TwitchAuthorizationException as e:
            logging.error(f"❌ Twitch 認証エラー: {e}")
            retry_count += 1
            
            if retry_count < max_retries:
                logging.info(f"🔄 自動トークンリフレッシュを試行 ({retry_count}/{max_retries})...")
                new_token = await refresh_access_token_advanced(config)
                
                if new_token:
                    logging.info("✅ トークンリフレッシュ成功！再接続します...")
                    await asyncio.sleep(5)
                    continue
                else:
                    wait_time = min(backoff_delay * (2 ** retry_count), 300)
                    logging.info(f"⏳ {wait_time}秒後に再試行します...")
                    await asyncio.sleep(wait_time)
            else:
                logging.error("❌ 最大再試行回数に達しました。プロセスを再起動します...")
                git_manager.restart_process()
                
        except Exception as e:
            logging.error(f"❌ メインループでエラー発生: {e}")
            retry_count += 1
            
            if retry_count < max_retries:
                wait_time = min(backoff_delay * (2 ** retry_count), 300)
                logging.info(f"🔄 自動復旧を試行 ({retry_count}/{max_retries})... {wait_time}秒待機")
                await asyncio.sleep(wait_time)
            else:
                logging.error("❌ 最大再試行回数に達しました。プロセスを再起動します...")
                git_manager.restart_process()

if __name__ == "__main__":
    try:
        asyncio.run(main())  # `asyncio.run()` を使用してイベントループを統一
    except RuntimeError as e:
        logging.error(f"⚠️ イベントループエラー: {e}")
