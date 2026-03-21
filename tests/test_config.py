"""Config クラスのユニットテスト。

main.py のモジュールレベル実行を回避するため、インポート前に依存をモックする。
"""

import os
import threading
from pathlib import Path

import pytest


@pytest.fixture()
def env_file(tmp_path):
    """テスト用 .env ファイルを作成する。"""
    p = tmp_path / ".env"
    p.write_text(
        "TWITCH_CLIENT_ID=test_client\n"
        "TWITCH_ACCESS_TOKEN=test_access\n"
        "TWITCH_REFRESH_TOKEN=test_refresh\n"
        "TWITCH_SECRET_TOKEN=test_secret\n"
        "TWITCH_BROADCASTER_ID=12345\n"
        "TWITCH_MODERATOR_ID=67890\n"
        "DISCORD_WEBHOOK_URL=https://discord.test/webhook\n"
        "LAST_CLIP_TIME=100.0\n"
        "LAST_MYCLIP_TIME=200.0\n"
        "LAST_STREAM_TITLE=Test Title\n"
        "CLIP_SPECIAL_USERS=alice,bob\n"
        "MANGA_COMMAND_ENABLED=1\n"
        "MANGA_ADMIN_USERS=admin1,admin2\n",
        encoding="utf-8",
    )
    return str(p)


@pytest.fixture()
def make_config(env_file):
    """main.py のモジュールレベル副作用を避けて Config だけインポートする。"""
    import importlib
    import unittest.mock as mock

    # main.py をインポートするとモジュールレベルでボットが起動するので
    # subprocess, threading, git_manager 周りをモック化
    with (
        mock.patch("subprocess.run"),
        mock.patch("threading.Thread"),
    ):
        import main

        importlib.reload(main)

    def _factory(path=env_file):
        return main.Config(env_file=path)

    return _factory


# ---------- .env 読み込みテスト ----------


def test_config_loads_twitch_settings(make_config):
    cfg = make_config()
    assert cfg.TWITCH_CLIENT_ID == "test_client"
    assert cfg.TWITCH_ACCESS_TOKEN == "test_access"
    assert cfg.TWITCH_REFRESH_TOKEN == "test_refresh"
    assert cfg.TWITCH_SECRET_TOKEN == "test_secret"
    assert cfg.TWITCH_BROADCASTER_ID == "12345"
    assert cfg.TWITCH_MODERATOR_ID == "67890"


def test_config_loads_discord_settings(make_config):
    cfg = make_config()
    assert cfg.DISCORD_WEBHOOK_URL == "https://discord.test/webhook"


def test_config_loads_system_settings(make_config):
    cfg = make_config()
    assert cfg.LAST_CLIP_TIME == 100.0
    assert cfg.LAST_MYCLIP_TIME == 200.0
    assert cfg.LAST_STREAM_TITLE == "Test Title"


def test_config_loads_special_users_lowercase(make_config):
    cfg = make_config()
    assert cfg.CLIP_SPECIAL_USERS == ["alice", "bob"]


def test_config_loads_manga_settings(make_config):
    cfg = make_config()
    assert cfg.MANGA_COMMAND_ENABLED is True
    assert cfg.MANGA_ADMIN_USERS == ["admin1", "admin2"]


def test_config_defaults_when_env_missing(make_config, tmp_path):
    empty_env = tmp_path / "empty.env"
    empty_env.write_text("", encoding="utf-8")
    cfg = make_config(str(empty_env))
    assert cfg.TWITCH_CLIENT_ID == ""
    assert cfg.LAST_CLIP_TIME == 0.0
    assert cfg.MANGA_COMMAND_ENABLED is False


# ---------- update メソッドテスト ----------


def test_update_access_token(make_config, env_file):
    cfg = make_config()
    cfg.update_access_token("new_access", "new_refresh")

    assert cfg.TWITCH_ACCESS_TOKEN == "new_access"
    assert cfg.TWITCH_REFRESH_TOKEN == "new_refresh"
    assert os.environ["TWITCH_ACCESS_TOKEN"] == "new_access"
    assert os.environ["TWITCH_REFRESH_TOKEN"] == "new_refresh"

    # .env ファイルにも反映されている
    content = Path(env_file).read_text(encoding="utf-8")
    assert "new_access" in content
    assert "new_refresh" in content


def test_update_access_token_clears_scope_state(make_config):
    cfg = make_config()
    cfg.mark_scope_reauth_attempted("old_token")
    cfg.mark_scope_echoed("old_token")

    cfg.update_access_token("new_access", "new_refresh")

    assert cfg.has_scope_reauth_attempted("old_token") is False
    assert cfg.has_scope_echoed("old_token") is False


def test_update_last_clip_time(make_config, env_file):
    cfg = make_config()
    cfg.update_last_clip_time(999.0)

    assert cfg.LAST_CLIP_TIME == 999.0
    assert os.environ["LAST_CLIP_TIME"] == "999.0"

    content = Path(env_file).read_text(encoding="utf-8")
    assert "999.0" in content


def test_update_last_myclip_time(make_config, env_file):
    cfg = make_config()
    cfg.update_last_myclip_time(888.0)

    assert cfg.LAST_MYCLIP_TIME == 888.0
    assert os.environ["LAST_MYCLIP_TIME"] == "888.0"


def test_update_last_stream_title_strips(make_config):
    cfg = make_config()
    cfg.update_last_stream_title("  New Title  ")

    assert cfg.LAST_STREAM_TITLE == "New Title"


def test_update_manga_command_enabled(make_config):
    cfg = make_config()
    cfg.update_manga_command_enabled(False)
    assert cfg.MANGA_COMMAND_ENABLED is False

    cfg.update_manga_command_enabled(True)
    assert cfg.MANGA_COMMAND_ENABLED is True


def test_get_last_stream_title_reads_env(make_config, env_file):
    cfg = make_config()
    # .env の値を直接変更
    content = Path(env_file).read_text(encoding="utf-8")
    content = content.replace("Test Title", "Updated Title")
    Path(env_file).write_text(content, encoding="utf-8")

    result = cfg.get_last_stream_title()
    assert result == "Updated Title"
    assert cfg.LAST_STREAM_TITLE == "Updated Title"


# ---------- スコープ状態テスト ----------


def test_scope_reauth_attempted_tracking(make_config):
    cfg = make_config()
    assert cfg.has_scope_reauth_attempted("tok1") is False
    cfg.mark_scope_reauth_attempted("tok1")
    assert cfg.has_scope_reauth_attempted("tok1") is True


def test_scope_echoed_tracking(make_config):
    cfg = make_config()
    assert cfg.has_scope_echoed("tok1") is False
    cfg.mark_scope_echoed("tok1")
    assert cfg.has_scope_echoed("tok1") is True


def test_set_active_auth_scopes(make_config):
    cfg = make_config()
    cfg.set_active_auth_scopes(["scope_a", "scope_b"])
    assert cfg.ACTIVE_AUTH_SCOPES == ["scope_a", "scope_b"]


# ---------- スレッドセーフティテスト ----------


def test_concurrent_token_updates_do_not_corrupt(make_config):
    cfg = make_config()
    errors = []

    def updater(token_id):
        try:
            for _ in range(50):
                cfg.update_access_token(f"access_{token_id}", f"refresh_{token_id}")
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=updater, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    # 最終状態のトークンは4スレッドのどれかの値になっている
    assert cfg.TWITCH_ACCESS_TOKEN.startswith("access_")
    assert cfg.TWITCH_REFRESH_TOKEN.startswith("refresh_")
