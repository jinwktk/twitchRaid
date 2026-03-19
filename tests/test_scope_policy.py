from twitchAPI.helper import AuthScope

from scope_policy import missing_scope_values


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
