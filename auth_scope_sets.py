from twitchAPI.helper import AuthScope


REQUIRED_AUTH_SCOPES = [
    AuthScope.CHAT_EDIT,
    AuthScope.CHAT_READ,
    AuthScope.MODERATOR_MANAGE_SHOUTOUTS,
]

MANGA_EXTRA_REAUTH_SCOPES = [
    AuthScope.USER_WRITE_CHAT,
    AuthScope.MODERATOR_MANAGE_CHAT_MESSAGES,
]

# 再認可時は最初から全スコープを要求する
# AuthScope の有効メンバーのみ抽出（value が文字列のもの）
REAUTH_AUTH_SCOPES = [s for s in AuthScope if isinstance(s.value, str)]
