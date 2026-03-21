import pytest

from chat_message_response import get_sent_message_id


class StubDropReason:
    def __init__(self, message):
        self.message = message


class StubSendResult:
    def __init__(self, is_sent, message_id="", drop_reason=None):
        self.is_sent = is_sent
        self.message_id = message_id
        self.drop_reason = drop_reason


def test_get_sent_message_id_returns_message_id_when_sent():
    result = StubSendResult(is_sent=True, message_id="abc123")

    assert get_sent_message_id(result) == "abc123"


def test_get_sent_message_id_raises_when_not_sent():
    result = StubSendResult(
        is_sent=False,
        drop_reason=StubDropReason("blocked by automod"),
    )

    with pytest.raises(ValueError, match="blocked by automod"):
        get_sent_message_id(result)


def test_get_sent_message_id_raises_when_message_id_is_empty():
    result = StubSendResult(is_sent=True, message_id="")

    with pytest.raises(ValueError, match="message id is empty"):
        get_sent_message_id(result)
