from comment_speed_meter import CommentSpeedMeter


def test_counts_messages_within_window():
    meter = CommentSpeedMeter(window_seconds=60)
    meter.record(0)
    meter.record(10)
    meter.record(20)

    assert meter.count(20) == 3
    assert meter.count(60) == 3
    assert meter.count(61) == 2


def test_rate_scales_by_window():
    meter = CommentSpeedMeter(window_seconds=30)
    meter.record(0)
    meter.record(10)
    meter.record(20)

    assert meter.rate_per_minute(30) == 6


def test_rate_zero_when_empty():
    meter = CommentSpeedMeter(window_seconds=60)
    meter.record(0)

    assert meter.rate_per_minute(61) == 0
