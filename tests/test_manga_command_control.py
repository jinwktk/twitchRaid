from manga_command_control import is_manga_admin, parse_enabled_flag, to_env_flag


def test_parse_enabled_flag():
    assert parse_enabled_flag("1") is True
    assert parse_enabled_flag("ON") is True
    assert parse_enabled_flag("true") is True
    assert parse_enabled_flag("0") is False
    assert parse_enabled_flag("") is False


def test_to_env_flag():
    assert to_env_flag(True) == "1"
    assert to_env_flag(False) == "0"


def test_is_manga_admin_accepts_moderator_or_broadcaster():
    assert is_manga_admin("viewer", ["rukalun"], is_mod=True, is_broadcaster=False) is True
    assert is_manga_admin("viewer", ["rukalun"], is_mod=False, is_broadcaster=True) is True


def test_is_manga_admin_accepts_listed_admin_user_case_insensitive():
    assert is_manga_admin("Rukalun", ["rukalun"], is_mod=False, is_broadcaster=False) is True


def test_is_manga_admin_rejects_non_admin_user():
    assert is_manga_admin("viewer", ["rukalun"], is_mod=False, is_broadcaster=False) is False
