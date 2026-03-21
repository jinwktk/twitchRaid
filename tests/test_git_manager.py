"""GitManager クラスのユニットテスト。"""

import importlib
import unittest.mock as mock
from types import SimpleNamespace

import pytest


@pytest.fixture(autouse=True)
def _isolate_main():
    """main.py のモジュールレベル副作用を回避する。"""
    with mock.patch("subprocess.run"), mock.patch("threading.Thread"):
        import main
        importlib.reload(main)
        yield main


@pytest.fixture()
def config(tmp_path, _isolate_main):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "TWITCH_CLIENT_ID=x\nTWITCH_ACCESS_TOKEN=x\nTWITCH_REFRESH_TOKEN=x\n"
        "TWITCH_SECRET_TOKEN=x\nTWITCH_BROADCASTER_ID=1\nTWITCH_MODERATOR_ID=2\n",
        encoding="utf-8",
    )
    cfg = _isolate_main.Config(env_file=str(env_file))
    cfg.RESTART_FILE = str(tmp_path / "last_restart.txt")
    return cfg


@pytest.fixture()
def git_manager(_isolate_main, config):
    return _isolate_main.GitManager(config)


# ---------- should_restart ----------


def test_should_restart_false_when_no_restart_file(git_manager):
    """再起動ファイルが無い場合は初期化のみで再起動しない（False）。"""
    result = git_manager.should_restart()
    assert result is False


def test_should_restart_false_within_interval(git_manager):
    """再起動記録後、インターバル内のため False を返す。"""
    git_manager.should_restart()  # 初期化
    result = git_manager.should_restart()
    assert result is False


def test_should_restart_true_after_interval(git_manager, config):
    """インターバル経過後は True を返す。"""
    from restart_state_store import save_last_restart
    import time
    past = time.time() - config.RESTART_INTERVAL - 1
    save_last_restart(config.RESTART_FILE, past)
    result = git_manager.should_restart()
    assert result is True


# ---------- restart_with_cooldown ----------


def test_restart_with_cooldown_calls_restart_when_allowed(git_manager, config):
    """should_restart が True の時に restart_process が呼ばれる。"""
    from restart_state_store import save_last_restart
    import time
    # インターバル経過状態を作る
    past = time.time() - config.RESTART_INTERVAL - 1
    save_last_restart(config.RESTART_FILE, past)

    with mock.patch.object(git_manager, "restart_process") as mock_restart:
        result = git_manager.restart_with_cooldown("テスト理由")
    assert result is True
    mock_restart.assert_called_once()
    assert git_manager.restart_pending is False


def test_restart_with_cooldown_sets_pending_when_blocked(git_manager):
    """クールダウン中は restart_pending を True にする。"""
    git_manager.should_restart()  # 初期化

    result = git_manager.restart_with_cooldown("ブロック中")
    assert result is False
    assert git_manager.restart_pending is True


# ---------- pull_and_restart_if_updated ----------


def test_pull_and_restart_if_updated_does_nothing_when_up_to_date(git_manager):
    """git pull で 'Already up to date' なら再起動しない。"""
    fake_result = SimpleNamespace(stdout="Already up to date.\n", returncode=0)
    with mock.patch("subprocess.run", return_value=fake_result):
        with mock.patch.object(git_manager, "restart_with_cooldown") as mock_rw:
            git_manager.pull_and_restart_if_updated()
    mock_rw.assert_not_called()


def test_pull_and_restart_if_updated_restarts_when_changed(git_manager):
    """git pull で更新があれば再起動する。"""
    fake_result = SimpleNamespace(stdout="Updating abc123..def456\n", returncode=0)
    with mock.patch("subprocess.run", return_value=fake_result):
        with mock.patch.object(git_manager, "restart_with_cooldown") as mock_rw:
            git_manager.pull_and_restart_if_updated()
    mock_rw.assert_called_once()


# ---------- check_for_updates ----------


def test_check_for_updates_returns_false_when_fetch_fails(git_manager):
    """git fetch が失敗した場合 False を返す。"""
    fake_fetch = SimpleNamespace(stdout="", stderr="error", returncode=1)
    with mock.patch("subprocess.run", return_value=fake_fetch):
        result = git_manager.check_for_updates()
    assert result is False


def test_check_for_updates_returns_false_when_no_updates(git_manager):
    """更新が0件の場合 False を返す。"""
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:  # git fetch
            return SimpleNamespace(stdout="", stderr="", returncode=0)
        else:  # git rev-list
            return SimpleNamespace(stdout="0\n", stderr="", returncode=0)

    with mock.patch("subprocess.run", side_effect=side_effect):
        result = git_manager.check_for_updates()
    assert result is False


def test_check_for_updates_pulls_and_restarts_when_updates_exist(git_manager):
    """更新がある場合、pull して再起動する。"""
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:  # git fetch
            return SimpleNamespace(stdout="", stderr="", returncode=0)
        elif call_count == 2:  # git rev-list
            return SimpleNamespace(stdout="3\n", stderr="", returncode=0)
        else:  # git pull
            return SimpleNamespace(stdout="Updated\n", stderr="", returncode=0)

    with mock.patch("subprocess.run", side_effect=side_effect):
        with mock.patch.object(git_manager, "restart_with_cooldown") as mock_rw:
            result = git_manager.check_for_updates()
    assert result is True
    mock_rw.assert_called_once()


def test_check_for_updates_returns_false_when_pull_fails(git_manager):
    """pull が失敗した場合 False を返す。"""
    call_count = 0

    def side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return SimpleNamespace(stdout="", stderr="", returncode=0)
        elif call_count == 2:
            return SimpleNamespace(stdout="2\n", stderr="", returncode=0)
        else:
            return SimpleNamespace(stdout="", stderr="merge conflict", returncode=1)

    with mock.patch("subprocess.run", side_effect=side_effect):
        result = git_manager.check_for_updates()
    assert result is False


def test_check_for_updates_returns_false_on_exception(git_manager):
    """例外発生時は False を返す。"""
    with mock.patch("subprocess.run", side_effect=OSError("network error")):
        result = git_manager.check_for_updates()
    assert result is False
