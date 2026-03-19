from message_delete_tracker import PendingDeleteTracker


def test_add_and_pop_matched_message():
    tracker = PendingDeleteTracker(stale_seconds=60)
    tracker.add(content="hello", channel_name="rukalun", delete_after_seconds=10, now=100.0)

    matched = tracker.pop_matched(content="hello", channel_name="rukalun", now=101.0)

    assert matched is not None
    assert matched.delete_after_seconds == 10


def test_pop_returns_none_when_channel_differs():
    tracker = PendingDeleteTracker(stale_seconds=60)
    tracker.add(content="hello", channel_name="rukalun", delete_after_seconds=10, now=100.0)

    matched = tracker.pop_matched(content="hello", channel_name="another", now=101.0)

    assert matched is None


def test_stale_entry_is_not_matched():
    tracker = PendingDeleteTracker(stale_seconds=10)
    tracker.add(content="hello", channel_name="rukalun", delete_after_seconds=10, now=100.0)

    matched = tracker.pop_matched(content="hello", channel_name="rukalun", now=111.0)

    assert matched is None


def test_duplicate_content_is_popped_in_fifo_order():
    tracker = PendingDeleteTracker(stale_seconds=60)
    tracker.add(content="same", channel_name="rukalun", delete_after_seconds=10, now=100.0)
    tracker.add(content="same", channel_name="rukalun", delete_after_seconds=20, now=101.0)

    first = tracker.pop_matched(content="same", channel_name="rukalun", now=102.0)
    second = tracker.pop_matched(content="same", channel_name="rukalun", now=102.1)

    assert first is not None
    assert second is not None
    assert first.delete_after_seconds == 10
    assert second.delete_after_seconds == 20
