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


def _merge_scopes(primary, secondary):
    merged = list(primary)
    for scope in secondary:
        if scope not in merged:
            merged.append(scope)
    return merged


REAUTH_AUTH_SCOPES = _merge_scopes(REQUIRED_AUTH_SCOPES, MANGA_EXTRA_REAUTH_SCOPES)
