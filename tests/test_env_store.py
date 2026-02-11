from env_store import update_env_file


def test_update_env_file_preserves_lines_and_appends(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("A=1\n# comment\nB=2\n")

    update_env_file(str(env_file), {"B": "3", "C": "4"})

    assert env_file.read_text() == "A=1\n# comment\nB=3\nC=4\n"


def test_update_env_file_restores_backup_when_empty(tmp_path):
    env_file = tmp_path / ".env"
    backup_file = tmp_path / ".env.bak"
    backup_file.write_text("A=1\n")
    env_file.write_text("")

    update_env_file(str(env_file), {"B": "2"})

    text = env_file.read_text()
    assert "A=1" in text
    assert "B=2" in text
