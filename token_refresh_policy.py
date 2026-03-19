def should_try_fallback(status_code):
    """高度リフレッシュ失敗時にフォールバック再認可を試すか判定する。"""
    return status_code != 200
