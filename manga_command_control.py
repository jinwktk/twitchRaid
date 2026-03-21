def parse_enabled_flag(raw_value):
    """環境変数の文字列を有効/無効フラグへ変換する。"""
    normalized = str(raw_value or "").strip().lower()
    return normalized in {"1", "true", "on", "yes"}


def to_env_flag(enabled):
    """有効/無効フラグを環境変数保存形式へ変換する。"""
    return "1" if enabled else "0"


def is_manga_admin(user_name, admin_users, is_mod=False, is_broadcaster=False):
    """mangaの管理コマンド実行可否を判定する。"""
    if is_mod or is_broadcaster:
        return True

    normalized_name = str(user_name or "").strip().lower()
    normalized_admins = {user.strip().lower() for user in admin_users if user.strip()}
    return normalized_name in normalized_admins
