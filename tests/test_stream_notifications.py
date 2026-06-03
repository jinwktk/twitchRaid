from unittest.mock import Mock

from stream_notifications import StreamTitleNotifier


class DummyConfig:
    def __init__(self, last_title=""):
        self.last_env_title = last_title
        self.LAST_STREAM_TITLE = last_title
        self.updated_titles = []

    def update_last_stream_title(self, title):
        self.LAST_STREAM_TITLE = title
        self.last_env_title = title
        self.updated_titles.append(title)

    def get_last_stream_title(self):
        return self.last_env_title


def test_notify_when_title_is_new():
    config = DummyConfig()
    notifier = StreamTitleNotifier(config=config, login_channel="rukalun")
    sender = Mock()

    result = notifier.notify_if_needed("新しいタイトル", sender)

    assert result is True
    sender.assert_called_once_with("新しいタイトル")
    assert config.LAST_STREAM_TITLE == "新しいタイトル"
    assert config.updated_titles == ["新しいタイトル"]


def test_skip_when_title_matches_last_state():
    config = DummyConfig(last_title="同じタイトル")
    notifier = StreamTitleNotifier(config=config, login_channel="rukalun")
    sender = Mock()

    result = notifier.notify_if_needed("同じタイトル", sender)

    assert result is False
    sender.assert_not_called()
    assert config.updated_titles == []


def test_skip_second_notification_for_same_title():
    config = DummyConfig()
    notifier = StreamTitleNotifier(config=config, login_channel="rukalun")
    sender = Mock()

    first_result = notifier.notify_if_needed("ルカるん配信", sender)
    second_result = notifier.notify_if_needed("ルカるん配信", sender)

    assert first_result is True
    assert second_result is False
    sender.assert_called_once()
    assert config.updated_titles == ["ルカるん配信"]


def test_notifier_reads_latest_env_value_each_time():
    config = DummyConfig(last_title="古いタイトル")
    notifier = StreamTitleNotifier(config=config, login_channel="rukalun")
    sender = Mock()

    config.last_env_title = "最新タイトル"

    result = notifier.notify_if_needed("最新タイトル", sender)

    assert result is False
    sender.assert_not_called()
