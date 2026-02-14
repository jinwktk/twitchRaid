from restart_state_store import evaluate_restart, load_last_restart, save_last_restart


def test_load_missing_returns_none(tmp_path):
    env_file = tmp_path / "last_restart.txt"

    assert load_last_restart(str(env_file)) is None


def test_load_invalid_returns_none(tmp_path):
    env_file = tmp_path / "last_restart.txt"
    env_file.write_text("not-a-number")

    assert load_last_restart(str(env_file)) is None


def test_save_and_load_roundtrip(tmp_path):
    env_file = tmp_path / "last_restart.txt"

    save_last_restart(str(env_file), 123.5)

    assert load_last_restart(str(env_file)) == 123.5


def test_evaluate_restart_initializes_on_missing():
    should_restart, next_stamp = evaluate_restart(now=10.0, last=None, interval=100.0)

    assert should_restart is False
    assert next_stamp == 10.0


def test_evaluate_restart_allows_after_interval():
    should_restart, next_stamp = evaluate_restart(now=200.0, last=0.0, interval=100.0)

    assert should_restart is True
    assert next_stamp == 200.0


def test_evaluate_restart_blocks_before_interval():
    should_restart, next_stamp = evaluate_restart(now=50.0, last=0.0, interval=100.0)

    assert should_restart is False
    assert next_stamp == 0.0
