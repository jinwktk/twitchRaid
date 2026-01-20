import pytest
from unittest.mock import AsyncMock

from clip_recast_notifier import ClipRecastNotifier


@pytest.mark.asyncio
async def test_notifier_waits_until_cooldown_expires():
    notifier = ClipRecastNotifier(cooldown_seconds=10, ready_message="ready")
    sender = AsyncMock()

    notifier.arm(started_at=0, send_coroutine=sender)

    result = await notifier.notify_if_ready(current_time=5)

    assert result is False
    sender.assert_not_awaited()


@pytest.mark.asyncio
async def test_notifier_announces_once_when_ready():
    notifier = ClipRecastNotifier(cooldown_seconds=10, ready_message="ready")
    sender = AsyncMock()

    notifier.arm(started_at=0, send_coroutine=sender)

    first_result = await notifier.notify_if_ready(current_time=10)
    second_result = await notifier.notify_if_ready(current_time=15)

    assert first_result is True
    assert second_result is False
    sender.assert_awaited_once_with("ready")


@pytest.mark.asyncio
async def test_rearm_resets_notification_cycle():
    notifier = ClipRecastNotifier(cooldown_seconds=10, ready_message="ready")
    first_sender = AsyncMock()
    second_sender = AsyncMock()

    notifier.arm(started_at=0, send_coroutine=first_sender)
    await notifier.notify_if_ready(current_time=11)

    notifier.arm(started_at=100, send_coroutine=second_sender)
    not_ready = await notifier.notify_if_ready(current_time=105)
    ready = await notifier.notify_if_ready(current_time=111)

    assert not_ready is False
    assert ready is True
    first_sender.assert_awaited_once_with("ready")
    second_sender.assert_awaited_once_with("ready")
