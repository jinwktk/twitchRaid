import logging
import requests
from twitchio import Channel
from twitchio.ext import commands
from dotenv import load_dotenv
import os


# ログ設定：ファイルにログを残す設定
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("./bot_log.txt", encoding="utf-8"),  # ✅ UTF-8を指定
        logging.StreamHandler()  # コンソールへの出力も行う
    ]
)

# トークン情報
# https://twitchtokengenerator.com/
load_dotenv()

TWITCH_ACCESS_TOKEN = os.getenv("TWITCH_ACCESS_TOKEN")
TWITCH_REFRESH_TOKEN = os.getenv("TWITCH_REFRESH_TOKEN")
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID")
TWITCH_BROADCASTER_ID = os.getenv("TWITCH_BROADCASTER_ID")
TWITCH_MODERATOR_ID = os.getenv("TWITCH_MODERATOR_ID")

LOGIN_CHANNEL = "rukalun"
COMMAND_PREFIX = "!"

class Bot(commands.Bot):

    def __init__(self):
        super().__init__(
            token=f"oauth:{TWITCH_ACCESS_TOKEN}",
            prefix=COMMAND_PREFIX,
            initial_channels=[LOGIN_CHANNEL]
        )

    async def event_ready(self):
        logging.info("全てのチャンネルにログインしました。")
        logging.info(f'ユーザーID: {self.user_id}')
        logging.info(f'ユーザー名: {self.nick}')

    # 配信者が配信中かどうか確認
    def is_broadcaster_live(self, broadcaster_id):
        response = requests.get(
            f"https://api.twitch.tv/helix/streams?user_id={broadcaster_id}",
            headers={
                "Authorization": f"Bearer {TWITCH_ACCESS_TOKEN}",
                "Client-ID": TWITCH_CLIENT_ID
            }
        )
        data = response.json()
        return len(data['data']) > 0  # 配信がある場合はデータが存在する

    # アクセストークン更新
    @staticmethod
    def refresh_access_token():
        global TWITCH_ACCESS_TOKEN, TWITCH_REFRESH_TOKEN

        url = f"https://twitchtokengenerator.com/api/refresh/{TWITCH_REFRESH_TOKEN}"
        
        response = requests.post(url)
        data = response.json()
        
        if "token" in data:
            TWITCH_ACCESS_TOKEN = data["token"]
            TWITCH_REFRESH_TOKEN = data["refresh"]

            with open(".env", "w", encoding="utf-8") as env_file:
                env_file.write(f"TWITCH_CLIENT_ID={TWITCH_CLIENT_ID}\n")
                env_file.write(f"TWITCH_ACCESS_TOKEN={TWITCH_ACCESS_TOKEN}\n")
                env_file.write(f"TWITCH_REFRESH_TOKEN={TWITCH_REFRESH_TOKEN}\n")
                env_file.write(f"TWITCH_BROADCASTER_ID={TWITCH_BROADCASTER_ID}\n")
                env_file.write(f"TWITCH_MODERATOR_ID={TWITCH_MODERATOR_ID}\n")

            logging.info("✅ Access token refreshed successfully.")
            return TWITCH_ACCESS_TOKEN
        else:
            logging.error(f"⚠️ Failed to refresh access token: {data}")
            return None

    def get_twitch_headers(self):
        global TWITCH_ACCESS_TOKEN
        headers = {
            "Authorization": f"Bearer {TWITCH_ACCESS_TOKEN}",
            "Client-ID": TWITCH_CLIENT_ID,
            "Content-Type": "application/json"
        }

        # トークンが無効な場合は更新
        response = requests.get("https://api.twitch.tv/helix/users", headers=headers)
        if response.status_code == 401:
            logging.warning("⚠️ Access token expired. Refreshing...")
            new_token = Bot.refresh_access_token()
            if new_token:
                headers["Authorization"] = f"Bearer {new_token}"
        return headers

    # USERNOTICEイベントを検知してRaidを処理
    async def event_raw_usernotice(self, channel: Channel, tags):
        logging.debug(f"Raw USERNOTICE tags: {tags}")

        # msg-idが"raid"であるかを確認
        if tags['msg-id'] == 'raid':
            raider_name = tags.get('msg-param-login')
            raider_id = tags.get('user-id')  # レイダーのユーザーIDを取得
            logging.info(f"Raid detected from {raider_name}. Sending shoutout.")

            # TWITCH_BROADCASTER_IDが配信中かどうかを確認
            if not self.is_broadcaster_live(TWITCH_BROADCASTER_ID):
                logging.info(f"{TWITCH_BROADCASTER_ID} is not currently live. Shoutout not sent.")
                return

            try:
                # レイダーにShoutoutを送信
                response = requests.post(
                    f"https://api.twitch.tv/helix/chat/shoutouts",
                    headers=self.get_twitch_headers(),
                    json={
                        "to_broadcaster_id": raider_id,  # レイダーのID
                        "from_broadcaster_id": TWITCH_BROADCASTER_ID,  # rukalunのID
                        "moderator_id": TWITCH_MODERATOR_ID  # nyme_iaのID
                    }
                )
                if response.status_code == 200:
                    logging.info(f"Shoutout successfully sent to {raider_name}")
                elif response.status_code == 400:
                    error_message = response.json().get('message', 'Unknown error')
                    logging.error(f"Failed to send shoutout: {response.status_code} - {error_message}")
                    if "not streaming live" in error_message:
                        logging.info(f"{raider_name} is not streaming live.")
                    elif "does not have one or more viewers" in error_message:
                        logging.info(f"{raider_name} does not have any viewers.")
                else:
                    logging.error(f"Failed to send shoutout: {response.status_code} - {response.text}")
            except Exception as e:
                logging.error(f"Failed to send shoutout: {e}")



def main():
    bot = Bot()
    bot.run()

if __name__ == "__main__":
    main()