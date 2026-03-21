from comment_state_store import load_comment_state, save_comment_state


def test_load_default_when_missing_keys(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("")

    total_count, stream_started_at = load_comment_state(str(env_file))

    assert total_count == 0
    assert stream_started_at == 0.0


def test_save_and_load_roundtrip(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("OTHER=1\n")

    save_comment_state(str(env_file), total_count=12, stream_started_at=123.4)
    total_count, stream_started_at = load_comment_state(str(env_file))

    assert total_count == 12
    assert stream_started_at == 123.4
