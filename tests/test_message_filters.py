from message_filters import is_command_message


def test_command_message_returns_true():
    assert is_command_message("!speed", "!") is True
    assert is_command_message("  !speed", "!") is True
    assert is_command_message("!", "!") is True


def test_non_command_message_returns_false():
    assert is_command_message("hello", "!") is False
    assert is_command_message("", "!") is False
    assert is_command_message("  hello", "!") is False
