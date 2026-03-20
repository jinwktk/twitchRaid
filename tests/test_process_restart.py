import pytest

from process_restart import restart_command, restart_process_in_place


class ExecCalled(BaseException):
    pass


class ExitCalled(BaseException):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def test_restart_command_prepends_executable():
    assert restart_command("/usr/bin/python3", ["main.py", "--debug"]) == [
        "/usr/bin/python3",
        "main.py",
        "--debug",
    ]


def test_restart_process_prefers_execv():
    recorded = {}

    def fake_execv(executable, argv):
        recorded["executable"] = executable
        recorded["argv"] = argv
        raise ExecCalled()

    def fake_popen(*args, **kwargs):
        raise AssertionError("execv 成功経路では subprocess を呼ばない")

    with pytest.raises(ExecCalled):
        restart_process_in_place(
            executable="/usr/bin/python3",
            argv=["main.py"],
            cwd="/tmp/app",
            execv=fake_execv,
            popen=fake_popen,
        )

    assert recorded == {
        "executable": "/usr/bin/python3",
        "argv": ["/usr/bin/python3", "main.py"],
    }


def test_restart_process_falls_back_to_same_console_spawn_when_execv_fails():
    recorded = {}

    def fake_execv(executable, argv):
        raise RuntimeError("execv failed")

    def fake_popen(args, **kwargs):
        recorded["args"] = args
        recorded["kwargs"] = kwargs

    def fake_exit(code):
        raise ExitCalled(code)

    with pytest.raises(ExitCalled) as exc_info:
        restart_process_in_place(
            executable="python",
            argv=["main.py"],
            cwd="/tmp/app",
            execv=fake_execv,
            popen=fake_popen,
            exit_fn=fake_exit,
            sleep_fn=lambda *_: None,
        )

    assert exc_info.value.code == 0
    assert recorded == {
        "args": ["python", "main.py"],
        "kwargs": {"cwd": "/tmp/app"},
    }


def test_restart_process_exits_with_error_when_all_restart_paths_fail():
    def fake_execv(executable, argv):
        raise RuntimeError("execv failed")

    def fake_popen(args, **kwargs):
        raise RuntimeError("spawn failed")

    def fake_exit(code):
        raise ExitCalled(code)

    with pytest.raises(ExitCalled) as exc_info:
        restart_process_in_place(
            executable="python",
            argv=["main.py"],
            cwd="/tmp/app",
            execv=fake_execv,
            popen=fake_popen,
            exit_fn=fake_exit,
            sleep_fn=lambda *_: None,
        )

    assert exc_info.value.code == 1
