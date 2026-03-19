def missing_scope_values(granted_scopes, required_scopes):
    """付与済みスコープから不足スコープ値の一覧を返す。"""
    granted = {str(scope) for scope in (granted_scopes or [])}
    missing = []
    for scope in required_scopes:
        value = getattr(scope, "value", str(scope))
        if value not in granted:
            missing.append(value)
    return missing
