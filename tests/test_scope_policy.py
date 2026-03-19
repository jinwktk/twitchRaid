from twitchAPI.helper import AuthScope

from scope_policy import (
    active_auth_scopes_from_granted,
    missing_scope_values,
    normalize_scope_values,
)


def test_missing_scope_values_returns_missing_only():
    granted = ["chat:edit", "chat:read"]
    required = [AuthScope.CHAT_EDIT, AuthScope.USER_WRITE_CHAT]

    result = missing_scope_values(granted, required)

    assert result == ["user:write:chat"]


def test_missing_scope_values_returns_empty_when_all_present():
    granted = ["chat:edit", "chat:read", "user:write:chat"]
    required = [AuthScope.CHAT_EDIT, AuthScope.USER_WRITE_CHAT]

    result = missing_scope_values(granted, required)

    assert result == []


def test_missing_scope_values_handles_authscope_granted():
    granted = [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS]
    required = [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ, AuthScope.MODERATOR_MANAGE_SHOUTOUTS]

    result = missing_scope_values(granted, required)

    assert result == []


def test_active_auth_scopes_from_granted_uses_granted_scopes():
    granted = ["chat:edit", "chat:read", "user:write:chat"]
    default_scopes = [AuthScope.CHAT_EDIT]

    result = active_auth_scopes_from_granted(granted, default_scopes)

    assert AuthScope.CHAT_EDIT in result
    assert AuthScope.USER_WRITE_CHAT in result
    assert len(result) == 3


def test_active_auth_scopes_from_granted_falls_back_to_default():
    granted = []
    default_scopes = [AuthScope.CHAT_EDIT, AuthScope.CHAT_READ]

    result = active_auth_scopes_from_granted(granted, default_scopes)

    assert result == default_scopes


def test_active_auth_scopes_from_granted_handles_authscope_values():
    granted = [AuthScope.CHAT_EDIT, AuthScope.USER_WRITE_CHAT]
    default_scopes = [AuthScope.CHAT_READ]

    result = active_auth_scopes_from_granted(granted, default_scopes)

    assert AuthScope.CHAT_EDIT in result
    assert AuthScope.USER_WRITE_CHAT in result
    assert AuthScope.CHAT_READ not in result


def test_normalize_scope_values_sorts_and_deduplicates():
    scopes = ["chat:read", "chat:edit", "chat:read"]

    result = normalize_scope_values(scopes)

    assert result == ["chat:edit", "chat:read"]


def test_normalize_scope_values_accepts_authscope():
    scopes = [AuthScope.USER_WRITE_CHAT, AuthScope.CHAT_EDIT]

    result = normalize_scope_values(scopes)

    assert result == ["chat:edit", "user:write:chat"]
