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

# ログ設定
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("./bot_log.txt", encoding="utf-8"),
        logging.StreamHandler()
    ]
)

# Twitch API関連の設定
env_values = dotenv_values(".env")
LOGIN_CHANNEL = "rukalun"
COMMAND_PREFIX = "!"
TWITCH_CLIENT_ID = env_values.get("TWITCH_CLIENT_ID", "")
TWITCH_ACCESS_TOKEN = env_values.get("TWITCH_ACCESS_TOKEN", "")
TWITCH_REFRESH_TOKEN = env_values.get("TWITCH_REFRESH_TOKEN", "")
TWITCH_SECRET_TOKEN = env_values.get("TWITCH_SECRET_TOKEN", "")
TWITCH_BROADCASTER_ID = env_values.get("TWITCH_BROADCASTER_ID", "")
TWITCH_MODERATOR_ID = env_values.get("TWITCH_MODERATOR_ID", "")
DISCORD_WEBHOOK_URL = env_values.get("DISCORD_WEBHOOK_URL", "")
LAST_CLIP_TIME = float(env_values.get("LAST_CLIP_TIME", 0.0))

# --- 1日おき自動再起動＆自動アップデート ---
RESTART_INTERVAL = 60 * 60 * 24  # 1日（秒）
RESTART_FILE = "last_restart.txt"

def should_restart():
    now = time.time()
    try:
        with open(RESTART_FILE, "r") as f:
            last = float(f.read())
    except:
        last = 0
    if now - last > RESTART_INTERVAL:
        with open(RESTART_FILE, "w") as f:
            f.write(str(now))
        return True
    return False

def auto_update():
    result = subprocess.run(["git", "pull"], capture_output=True, text=True)
    print(result.stdout)
    if "Already up to date" not in result.stdout:
        print("更新があったので再起動します")
        os.execv(sys.executable, [sys.executable] + sys.argv)

def auto_update_watcher():
    while True:
        time.sleep(300)  # 5分ごと
        subprocess.run(["git", "fetch"])
        print("更新確認中...")
        # mainブランチ前提。develop等の場合は適宜変更
        result = subprocess.run(["git", "rev-list", "HEAD...origin/main", "--count"], capture_output=True, text=True)
        if result.stdout.strip() != "0":
            print("リモートに更新があるのでpullして再起動します")
            subprocess.run(["git", "pull"])
            os.execv(sys.executable, [sys.executable] + sys.argv)

def restart_watcher():
    while True:
        time.sleep(60)  # 1分ごとにチェック
        if should_restart():
            print("1日経過したので再起動します")
            os.execv(sys.executable, [sys.executable] + sys.argv)

# 起動時に1回pull
auto_update()
# 監視スレッド起動
threading.Thread(target=auto_update_watcher, daemon=True).start()
threading.Thread(target=restart_watcher, daemon=True).start()

# Twitch Bot クラスの定義
class Bot(commands.Bot):
    def __init__(self, token):
        try:
            super().__init__(
                token=f"oauth:{token}",  # 修正：ここで事前に取得したトークンを渡す
                prefix=COMMAND_PREFIX,
                initial_channels=[LOGIN_CHANNEL]
            )
            self.twitch = Twitch(TWITCH_CLIENT_ID, TWITCH_SECRET_TOKEN)
            self.stream_live = True
        except TwitchAuthorizationException:
            logging.error("❌ 無効なリフレッシュトークン。新しい認証を開始します。")
            asyncio.create_task(refresh_access_token())  # `refresh_access_token` を非同期で呼び出し

    async def initialize(self):
        """ 非同期初期化メソッド """
        if not TWITCH_ACCESS_TOKEN or not TWITCH_REFRESH_TOKEN:
            logging.warning("⚠️ アクセストークンが見つかりません。新しいトークンを取得します。")
            await refresh_access_token()
        await self.twitch.set_user_authentication(
            TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            TWITCH_REFRESH_TOKEN
        )

    # 配信のステータスを監視する非同期関数
    async def monitor_stream_status(self):
        while True:
            try:
                streams = [stream async for stream in self.twitch.get_streams(user_login=LOGIN_CHANNEL)]
                if streams:
                    if not self.stream_live:
                        stream_title = streams[0].title
                        logging.info(f"🎥 配信が開始されました！タイトル: {stream_title}")
                        self.stream_live = True
                        self.send_discord_notification(
                            f"{stream_title}\n🔴 配信URL: https://www.twitch.tv/{LOGIN_CHANNEL}"
                        )
                else:
                    if self.stream_live:
                        logging.info("📢 配信が終了しました！")
                        self.stream_live = False
            except Exception as e:
                logging.error(f"⚠️ 配信状態チェックエラー: {e}")
            await asyncio.sleep(60)  # 60秒ごとにチェック

    def send_discord_notification(self, message):
        """ Discord Webhook で通知を送る """
        if not DISCORD_WEBHOOK_URL:
            logging.warning("⚠️ DISCORD_WEBHOOK_URL が設定されていません。")
            return

        try:
            webhook = DiscordWebhook(url=DISCORD_WEBHOOK_URL, content=message)
            response = webhook.execute()
            logging.info(f"✅ Discord に通知を送信しました: {response}")
        except Exception as e:
            logging.error(f"❌ Discord Webhook の送信に失敗しました: {e}")

    async def get_stream_info(self):
        """ 現在の配信情報（タイトル・カテゴリなど）を取得 """
        try:
            async for info in self.twitch.get_channel_information(broadcaster_id=TWITCH_BROADCASTER_ID):
                return info
        except Exception as e:
            logging.error(f"❌ Failed to fetch stream info: {e}")
        return None


    # Botが起動した時に実行されるイベント
    async def event_ready(self):
        await validate_access_token()
        logging.info("✅ 全てのチャンネルにログインしました。")
        logging.info(f'ユーザーID: {self.user_id}')
        logging.info(f'ユーザー名: {self.nick}')

        asyncio.create_task(self.monitor_stream_status())
        self.last_clip_time = LAST_CLIP_TIME

    async def validate_access_token():
        """ Twitchのアクセストークンの有効性を検証する """
        global TWITCH_ACCESS_TOKEN

        try:
            token_data = await validate_token(TWITCH_ACCESS_TOKEN)

            if token_data:
                logging.info(f"✅ アクセストークンは有効: {token_data['user_name']} (Client ID: {token_data['client_id']})")
                return True  # トークンは有効

            logging.warning("⚠️ アクセストークンが無効です。リフレッシュを試みます...")
            return False  # トークンが無効
        except Exception as e:
            logging.error(f"❌ Twitchトークンの検証中にエラー: {e}")
            return None  # 不明なエラー

    async def send_shoutout(self, to_broadcaster_id, retry=False):
        try:
            await self.twitch.send_a_shoutout(
                from_broadcaster_id=TWITCH_BROADCASTER_ID,
                to_broadcaster_id=to_broadcaster_id,
                moderator_id=TWITCH_MODERATOR_ID
            )
            logging.info(f"✅ Shoutout successfully sent to broadcaster {to_broadcaster_id}")
        except TwitchAuthorizationException:
            if not retry:
                logging.warning("⚠️ Authorization error detected, refreshing token and retrying...")
                await refresh_access_token()
                await self.send_shoutout(to_broadcaster_id, retry=True)
            else:
                logging.error("❌ Failed to send shoutout even after refreshing token.")
        except Exception as e:
            logging.error(f"❌ Failed to send shoutout: {e}")

    @commands.command(name='age')
    async def age_command(self, ctx):
        await validate_access_token()
        await ctx.send("42")

    @commands.command(name='goods')
    async def goods_command(self, ctx):
        await validate_access_token()
        await ctx.send("https://rukalun.booth.pm")
        
    @commands.command(name='weight')
    async def weight_command(self, ctx):
        await validate_access_token()
        await ctx.send("86kg")

    async def get_clips_info(self):
        try:
            clips = [clip async for clip in self.twitch.get_clips(
                broadcaster_id=TWITCH_BROADCASTER_ID,
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

        await validate_access_token()
        clip = await self.get_clips_info()
        if clip:
            await ctx.send(clip.url)

            # `self.last_clip_time` を更新
            self.last_clip_time = current_time

            # `.env` に保存
            self.update_last_clip_time(current_time)
        else:
            await ctx.send("⚠️ クリップが見つかりませんでした。")

    def update_last_clip_time(self, timestamp):
        """ 最新の `LAST_CLIP_TIME` を .env に保存 """
        os.environ["LAST_CLIP_TIME"] = str(timestamp)

        # `.env` を更新
        with open(".env", "r", encoding="utf-8") as env_file:
            lines = env_file.readlines()

        with open(".env", "w", encoding="utf-8") as env_file:
            updated = False
            for line in lines:
                if line.startswith("LAST_CLIP_TIME="):
                    env_file.write(f"LAST_CLIP_TIME={timestamp}\n")
                    updated = True
                else:
                    env_file.write(line)
            if not updated:
                env_file.write(f"LAST_CLIP_TIME={timestamp}\n")

    async def event_raw_usernotice(self, channel, tags):
        logging.debug(f"Raw USERNOTICE tags: {tags}")
        if tags['msg-id'] == 'raid':
            raider_name = tags.get('msg-param-login')
            raider_id = tags.get('user-id')
            logging.info(f"Raid detected from {raider_name}. Sending shoutout.")
            await self.send_shoutout(raider_id)


async def validate_access_token():
    """ Twitchのアクセストークンの有効性を検証し、無効ならリフレッシュする """
    global TWITCH_ACCESS_TOKEN

    try:
        token_data = await validate_token(TWITCH_ACCESS_TOKEN)

        # 🔍 APIレスポンスの内容をログに記録（デバッグ用）
        logging.debug(f"📝 validate_token() のレスポンス: {token_data}")

        # トークンが無効（401 Unauthorized）なら、リフレッシュ
        if isinstance(token_data, dict) and token_data.get("status") == 401:
            logging.warning("⚠️ アクセストークンが無効です（401 Unauthorized）。リフレッシュを試みます...")
            return await refresh_access_token()  # トークンを即リフレッシュ

        # `user_name` の代わりに `login` を使用する
        user_name = token_data.get('login')
        client_id = token_data.get('client_id')

        if user_name:
            logging.info(f"✅ アクセストークンは有効: {user_name} (Client ID: {client_id})")
            return TWITCH_ACCESS_TOKEN  # 有効なトークンを返す

        logging.warning("⚠️ 'login' キーがレスポンスに存在しません。トークンが無効の可能性があります。")
        return None  # トークンが無効
    except Exception as e:
        logging.error(f"❌ Twitchトークンの検証中にエラー: {e}")
        return None  # 不明なエラー


async def refresh_access_token():
    """ Twitchのアクセストークンを強制的にリフレッシュ """
    global TWITCH_ACCESS_TOKEN, TWITCH_REFRESH_TOKEN

    try:
        logging.info("🔄 アクセストークンをリフレッシュ中...")
        twitch = Twitch(TWITCH_CLIENT_ID, TWITCH_SECRET_TOKEN)
        auth = UserAuthenticator(
            twitch, 
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS]
        )
        token_data = await auth.authenticate()

        if not token_data:
            logging.error("❌ トークンの取得に失敗しました。手動で `.env` を修正してください。")
            return None

        TWITCH_ACCESS_TOKEN, TWITCH_REFRESH_TOKEN = token_data[:2]

        # Twitchの認証情報を更新
        await twitch.set_user_authentication(
            TWITCH_ACCESS_TOKEN,
            [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS],
            TWITCH_REFRESH_TOKEN
        )

        # `.env` を更新
        os.environ["TWITCH_ACCESS_TOKEN"] = TWITCH_ACCESS_TOKEN
        os.environ["TWITCH_REFRESH_TOKEN"] = TWITCH_REFRESH_TOKEN
        set_key(".env", "TWITCH_ACCESS_TOKEN", TWITCH_ACCESS_TOKEN)
        set_key(".env", "TWITCH_REFRESH_TOKEN", TWITCH_REFRESH_TOKEN)

        logging.info("✅ 新しいアクセストークンを取得しました！")
        return TWITCH_ACCESS_TOKEN  # 更新したトークンを返す

    except Exception as e:
        logging.error(f"❌ アクセストークンの更新中にエラー発生: {e}")
        return None


async def get_valid_access_token():
    """ 有効なTwitchアクセストークンを取得し、必要ならリフレッシュ """
    global TWITCH_ACCESS_TOKEN

    is_valid = await validate_access_token()
    
    if is_valid is True:
        return TWITCH_ACCESS_TOKEN  # 有効ならそのまま返す
    elif is_valid is False:
        logging.info("🔄 無効なトークンを検出。新しいトークンを取得します...")
        new_token = await refresh_access_token()

        if not new_token:
            logging.error("❌ トークンの更新に失敗しました。手動で `.env` を修正してください。")
            exit(1)  # プログラムを強制終了
        return new_token
    else:
        logging.error("❌ 予期しないエラーが発生しました。")
        exit(1)


async def main():
    global bot
    
    # 事前に有効なアクセストークンを取得
    valid_token = await validate_access_token()

    if not valid_token:
        logging.error("❌ アクセストークンの取得に失敗しました。手動で `.env` を修正してください。")
        sys.exit(1)  # ← 修正（import sys を追加）

    bot = Bot(valid_token)
    
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