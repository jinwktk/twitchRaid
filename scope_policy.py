from twitchAPI.helper import AuthScope


def missing_scope_values(granted_scopes, required_scopes):
    """付与済みスコープから不足スコープ値の一覧を返す。"""
    granted = {str(scope) for scope in (granted_scopes or [])}
    missing = []
    for scope in required_scopes:
        value = getattr(scope, "value", str(scope))
        if value not in granted:
            missing.append(value)
    return missing


def active_auth_scopes_from_granted(granted_scopes, default_scopes):
    """付与済みスコープをAuthScopeに変換し、空ならデフォルトを返す。"""
    granted_values = {str(scope) for scope in (granted_scopes or [])}
    resolved = [scope for scope in AuthScope if scope.value in granted_values]
    if resolved:
        return resolved
    return list(default_scopes)


def normalize_scope_values(scopes):
    """スコープ配列を表示用の重複なしソート済み文字列配列へ変換する。"""
    values = []
    for scope in scopes or []:
        values.append(getattr(scope, "value", str(scope)))
    return sorted(set(values))
