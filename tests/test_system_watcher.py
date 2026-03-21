"""SystemWatcher クラスのユニットテスト。

update_watcher / restart_watcher は無限ループなので、
time.sleep を副作用で中断させてループ1回分の動作を検証する。
"""

import importlib
import threading
import unittest.mock as mock

import pytest


@pytest.fixture(autouse=True)
def _isolate_main():
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
    cfg.UPDATE_CHECK_INTERVAL = 0  # テスト用にsleep除去
    cfg.RESTART_CHECK_INTERVAL = 0
    cfg.RESTART_FILE = str(tmp_path / "last_restart.txt")
    return cfg


class _StopLoop(BaseException):
    """テスト用：ループを1回で中断させる例外。except Exception をすり抜ける。"""


# ---------- update_watcher ----------


def test_update_watcher_calls_check_for_updates(_isolate_main, config):
    """update_watcher がループ内で check_for_updates を呼ぶ。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)
    call_count = 0

    def fake_check():
        nonlocal call_count
        call_count += 1
        raise _StopLoop()

    with mock.patch.object(gm, "check_for_updates", side_effect=fake_check):
        with mock.patch("time.sleep"):
            try:
                sw.update_watcher()
            except _StopLoop:
                pass

    assert call_count == 1


def test_update_watcher_recovers_from_exception(_isolate_main, config):
    """update_watcher は例外を捕捉してループを継続する。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)
    call_count = 0

    def fake_check():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("ネットワークエラー")
        raise _StopLoop()

    with mock.patch.object(gm, "check_for_updates", side_effect=fake_check):
        with mock.patch("time.sleep"):
            try:
                sw.update_watcher()
            except _StopLoop:
                pass

    assert call_count == 2  # 1回目例外→回復→2回目呼び出し


# ---------- restart_watcher ----------


def test_restart_watcher_restarts_when_should_restart_true(_isolate_main, config):
    """should_restart が True の時に restart_process が呼ばれる。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)

    with mock.patch.object(gm, "should_restart", return_value=True):
        with mock.patch.object(gm, "restart_process", side_effect=_StopLoop()):
            with mock.patch("time.sleep"):
                try:
                    sw.restart_watcher()
                except _StopLoop:
                    pass

    # restart_process が呼ばれたことを確認（_StopLoop で中断）


def test_restart_watcher_clears_pending_flag(_isolate_main, config):
    """restart_pending が True の場合、再起動後にクリアされる。"""
    gm = _isolate_main.GitManager(config)
    gm.restart_pending = True
    sw = _isolate_main.SystemWatcher(gm)

    with mock.patch.object(gm, "should_restart", return_value=True):
        with mock.patch.object(gm, "restart_process", side_effect=_StopLoop()):
            with mock.patch("time.sleep"):
                try:
                    sw.restart_watcher()
                except _StopLoop:
                    pass

    assert gm.restart_pending is False


def test_restart_watcher_does_not_restart_when_not_needed(_isolate_main, config):
    """should_restart が False の時は restart_process を呼ばない。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)
    loop_count = 0

    def fake_should_restart():
        nonlocal loop_count
        loop_count += 1
        if loop_count >= 2:
            raise _StopLoop()
        return False

    with mock.patch.object(gm, "should_restart", side_effect=fake_should_restart):
        with mock.patch.object(gm, "restart_process") as mock_restart:
            with mock.patch("time.sleep"):
                try:
                    sw.restart_watcher()
                except _StopLoop:
                    pass

    mock_restart.assert_not_called()


def test_restart_watcher_recovers_from_exception(_isolate_main, config):
    """restart_watcher は例外を捕捉してループを継続する。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)
    call_count = 0

    def fake_should_restart():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("ファイルエラー")
        raise _StopLoop()

    with mock.patch.object(gm, "should_restart", side_effect=fake_should_restart):
        with mock.patch("time.sleep"):
            try:
                sw.restart_watcher()
            except _StopLoop:
                pass

    assert call_count == 2


# ---------- スレッド起動統合テスト ----------


def test_watcher_runs_in_thread(_isolate_main, config):
    """SystemWatcher がスレッドで実行できることを確認する。"""
    gm = _isolate_main.GitManager(config)
    sw = _isolate_main.SystemWatcher(gm)
    executed = threading.Event()

    def fake_check():
        executed.set()
        raise _StopLoop()

    with mock.patch.object(gm, "check_for_updates", side_effect=fake_check):
        with mock.patch("main.time.sleep"):
            t = threading.Thread(target=sw.update_watcher, daemon=True)
            t.start()
            assert executed.wait(timeout=5)
