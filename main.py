import logging
import os
import aiofiles
from dotenv import dotenv_values, set_key
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

# ログ設定
log_handler = RotatingFileHandler(
    "./bot_log.txt",
    maxBytes=5*1024*1024,  # 5MB
    backupCount=3,  # 3つのバックアップファイルを保持
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
        self.RESTART_INTERVAL = 60 * 60 * 24  # 1日（秒）
        self.RESTART_FILE = "last_restart.txt"
        self.UPDATE_CHECK_INTERVAL = 600  # 10分（秒）
        self.RESTART_CHECK_INTERVAL = 300  # 5分（秒）
    
    def update_access_token(self, access_token, refresh_token):
        """アクセストークンを更新"""
        self.TWITCH_ACCESS_TOKEN = access_token
        self.TWITCH_REFRESH_TOKEN = refresh_token
        
        # 環境変数を更新
        os.environ["TWITCH_ACCESS_TOKEN"] = access_token
        os.environ["TWITCH_REFRESH_TOKEN"] = refresh_token
        
        # .envファイルを更新
        set_key(self.env_file, "TWITCH_ACCESS_TOKEN", access_token)
        set_key(self.env_file, "TWITCH_REFRESH_TOKEN", refresh_token)
    
    def update_last_clip_time(self, timestamp):
        """最新のクリップ時間を更新"""
        self.LAST_CLIP_TIME = timestamp
        os.environ["LAST_CLIP_TIME"] = str(timestamp)
        
        # .envファイルを更新
        with open(self.env_file, "r", encoding="utf-8") as env_file:
            lines = env_file.readlines()
        
        with open(self.env_file, "w", encoding="utf-8") as env_file:
            updated = False
            for line in lines:
                if line.startswith("LAST_CLIP_TIME="):
                    env_file.write(f"LAST_CLIP_TIME={timestamp}\n")
                    updated = True
                else:
                    env_file.write(line)
            if not updated:
                env_file.write(f"LAST_CLIP_TIME={timestamp}\n")

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
        os.execv(sys.executable, [sys.executable] + sys.argv)

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
        try:
            super().__init__(
                token=f"oauth:{token}",
                prefix=self.config.COMMAND_PREFIX,
                initial_channels=[self.config.LOGIN_CHANNEL]
            )
            self.twitch = Twitch(self.config.TWITCH_CLIENT_ID, self.config.TWITCH_SECRET_TOKEN)
            self.stream_live = True
        except TwitchAuthorizationException:
            logging.error("❌ 無効なリフレッシュトークン。新しい認証を開始します。")
            asyncio.create_task(refresh_access_token(self.config))

    async def initialize(self):
        """ 非同期初期化メソッド """
        if not self.config.TWITCH_ACCESS_TOKEN or not self.config.TWITCH_REFRESH_TOKEN:
            logging.warning("⚠️ アクセストークンが見つかりません。新しいトークンを取得します。")
            await refresh_access_token(self.config)
        await self.twitch.set_user_authentication(
            self.config.TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            self.config.TWITCH_REFRESH_TOKEN
        )

    # 配信のステータスを監視する非同期関数
    async def monitor_stream_status(self):
        while True:
            try:
                streams = [stream async for stream in self.twitch.get_streams(user_login=self.config.LOGIN_CHANNEL)]
                if streams:
                    if not self.stream_live:
                        stream_title = streams[0].title
                        logging.info(f"🎥 配信が開始されました！タイトル: {stream_title}")
                        self.stream_live = True
                        self.send_discord_notification(
                            f"{stream_title}\n🔴 配信URL: https://www.twitch.tv/{self.config.LOGIN_CHANNEL}"
                        )
                else:
                    if self.stream_live:
                        logging.info("📢 配信が終了しました！")
                        self.stream_live = False
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
        logging.info(f'ユーザーID: {self.user_id}')
        logging.info(f'ユーザー名: {self.nick}')

        asyncio.create_task(self.monitor_stream_status())
        self.last_clip_time = self.config.LAST_CLIP_TIME


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
                await refresh_access_token(self.config)
                await self.send_shoutout(to_broadcaster_id, retry=True)
            else:
                logging.error("❌ Failed to send shoutout even after refreshing token.")
        except Exception as e:
            logging.error(f"❌ Failed to send shoutout: {e}")

    @commands.command(name='age')
    async def age_command(self, ctx):
        await validate_access_token(self.config)
        await ctx.send("42")

    @commands.command(name='goods')
    async def goods_command(self, ctx):
        await validate_access_token(self.config)
        await ctx.send("https://rukalun.booth.pm")
        
    @commands.command(name='weight')
    async def weight_command(self, ctx):
        await validate_access_token(self.config)
        await ctx.send("86kg")

    async def get_clips_info(self):
        try:
            clips = [clip async for clip in self.twitch.get_clips(
                broadcaster_id=self.config.TWITCH_BROADCASTER_ID,
                first=100
            )]
            
            if clips:
                selected_clip = random.choice(clips)  # ランダムに1つ選択
                return selected_clip    
            else:
                logging.info("⚠️ No clips found.")
        
        except Exception as e:
            logging.error(f"❌ Failed to fetch clips: {e}")
    
    @commands.command(name='clip')
    async def clip_command(self, ctx):
        current_time = time.time()

        # 30分（1800秒）経過していない場合は実行不可
        if current_time - self.last_clip_time < 1800:
            remaining_time = int(1800 - (current_time - self.last_clip_time))
            await ctx.send(f"⚠️ `clip` コマンドは 30分に1回のみ使用できます。あと {remaining_time // 60}分 {remaining_time % 60}秒 待ってください。")
            return

        await validate_access_token(self.config)
        clip = await self.get_clips_info()
        if clip:
            await ctx.send(clip.url)

            # `self.last_clip_time` を更新
            self.last_clip_time = current_time

            # `.env` に保存
            self.config.update_last_clip_time(current_time)
        else:
            await ctx.send("⚠️ クリップが見つかりませんでした。")


    async def event_raw_usernotice(self, channel, tags):
        logging.debug(f"Raw USERNOTICE tags: {tags}")
        if tags['msg-id'] == 'raid':
            raider_name = tags.get('msg-param-login')
            raider_id = tags.get('user-id')
            logging.info(f"Raid detected from {raider_name}. Sending shoutout.")
            await self.send_shoutout(raider_id)


async def validate_access_token(config):
    """ Twitchのアクセストークンの有効性を検証し、無効ならリフレッシュする """
    try:
        token_data = await validate_token(config.TWITCH_ACCESS_TOKEN)

        # 🔍 APIレスポンスの内容をログに記録（デバッグ用）
        logging.debug(f"📝 validate_token() のレスポンス: {token_data}")

        # トークンが無効（401 Unauthorized）なら、リフレッシュ
        if isinstance(token_data, dict) and token_data.get("status") == 401:
            logging.warning("⚠️ アクセストークンが無効です（401 Unauthorized）。リフレッシュを試みます...")
            return await refresh_access_token(config)  # トークンを即リフレッシュ

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


async def refresh_access_token(config):
    """ Twitchのアクセストークンを強制的にリフレッシュ """
    try:
        logging.info("🔄 アクセストークンをリフレッシュ中...")
        twitch = Twitch(config.TWITCH_CLIENT_ID, config.TWITCH_SECRET_TOKEN)
        auth = UserAuthenticator(
            twitch, 
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS]
        )
        token_data = await auth.authenticate()

        if not token_data:
            logging.error("❌ トークンの取得に失敗しました。手動で `.env` を修正してください。")
            return None

        access_token, refresh_token = token_data[:2]
        config.update_access_token(access_token, refresh_token)

        # Twitchの認証情報を更新
        await twitch.set_user_authentication(
            config.TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            config.TWITCH_REFRESH_TOKEN
        )

        logging.info("✅ 新しいアクセストークンを取得しました！")
        return config.TWITCH_ACCESS_TOKEN  # 更新したトークンを返す

    except Exception as e:
        logging.error(f"❌ アクセストークンの更新中にエラー発生: {e}")
        return None


async def get_valid_access_token(config):
    """ 有効なTwitchアクセストークンを取得し、必要ならリフレッシュ """
    is_valid = await validate_access_token(config)
    
    if is_valid:
        return config.TWITCH_ACCESS_TOKEN  # 有効ならそのまま返す
    else:
        logging.info("🔄 無効なトークンを検出。新しいトークンを取得します...")
        new_token = await refresh_access_token(config)

        if not new_token:
            logging.error("❌ トークンの更新に失敗しました。手動で `.env` を修正してください。")
            sys.exit(1)  # プログラムを強制終了
        return new_token


async def main():
    global bot
    
    # 事前に有効なアクセストークンを取得
    valid_token = await get_valid_access_token(config)

    if not valid_token:
        logging.error("❌ アクセストークンの取得に失敗しました。手動で `.env` を修正してください。")
        sys.exit(1)

    bot = Bot(valid_token, config)
    
    try:
        await bot.initialize()
        await bot.start()
    except TwitchAuthorizationException:
        logging.error("❌ Twitch 認証エラーが発生しました。")
    except Exception as e:
        logging.error(f"❌ メインループでエラー発生: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())  # `asyncio.run()` を使用してイベントループを統一
    except RuntimeError as e:
        logging.error(f"⚠️ イベントループエラー: {e}")