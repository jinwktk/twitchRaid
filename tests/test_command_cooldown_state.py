import pytest

from command_cooldown_state import CommandCooldownState


def test_clip_and_myclip_have_independent_cooldowns():
    state = CommandCooldownState({"clip": 0.0, "myclip": 0.0})
    state.mark_used("clip", 100.0)

    clip_remaining = state.remaining_seconds("clip", current_time=200.0, cooldown_seconds=1800)
    myclip_remaining = state.remaining_seconds("myclip", current_time=200.0, cooldown_seconds=1800)

    assert clip_remaining == 1700
    assert myclip_remaining == 0


def test_marking_myclip_does_not_change_clip_time():
    state = CommandCooldownState({"clip": 10.0, "myclip": 20.0})

    state.mark_used("myclip", 100.0)

    assert state.last_used("clip") == 10.0
    assert state.last_used("myclip") == 100.0


def test_unknown_command_raises_value_error():
    state = CommandCooldownState({"clip": 0.0, "myclip": 0.0})

    with pytest.raises(ValueError):
        state.last_used("unknown")
