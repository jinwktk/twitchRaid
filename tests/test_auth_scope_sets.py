from auth_scope_sets import (
    MANGA_EXTRA_REAUTH_SCOPES,
    REQUIRED_AUTH_SCOPES,
    REAUTH_AUTH_SCOPES,
)
from twitchAPI.helper import AuthScope


def test_required_scopes_do_not_force_manga_optional_scopes():
    assert AuthScope.MODERATOR_MANAGE_CHAT_MESSAGES not in REQUIRED_AUTH_SCOPES
    assert AuthScope.USER_WRITE_CHAT not in REQUIRED_AUTH_SCOPES


def test_reauth_scopes_include_manga_optional_scopes():
    assert AuthScope.MODERATOR_MANAGE_CHAT_MESSAGES in REAUTH_AUTH_SCOPES
    assert AuthScope.USER_WRITE_CHAT in REAUTH_AUTH_SCOPES


def test_reauth_scopes_keep_required_scopes_and_are_unique():
    for scope in REQUIRED_AUTH_SCOPES:
        assert scope in REAUTH_AUTH_SCOPES

    assert len(REAUTH_AUTH_SCOPES) == len(set(REAUTH_AUTH_SCOPES))


def test_manga_extra_scope_set_is_expected():
    assert MANGA_EXTRA_REAUTH_SCOPES == [
        AuthScope.USER_WRITE_CHAT,
        AuthScope.MODERATOR_MANAGE_CHAT_MESSAGES,
    ]
