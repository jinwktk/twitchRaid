from types import SimpleNamespace

import pytest

from clip_selector import select_clip


class FakeTwitch:
    def __init__(self, clips):
        self._clips = clips

    async def get_clips(self, **kwargs):
        for clip in self._clips:
            yield clip


def make_clip(url: str, creator_id: str, creator_name: str):
    return SimpleNamespace(url=url, creator_id=creator_id, creator_name=creator_name)


@pytest.mark.asyncio
async def test_select_clip_without_filter_returns_random_clip(monkeypatch):
    clips = [
        make_clip("https://clips.twitch.tv/a", "1", "alice"),
        make_clip("https://clips.twitch.tv/b", "2", "bob"),
    ]
    twitch = FakeTwitch(clips)
    monkeypatch.setattr("clip_selector.random.choice", lambda items: items[1])

    selected = await select_clip(twitch=twitch, broadcaster_id="123")

    assert selected.url == "https://clips.twitch.tv/b"


@pytest.mark.asyncio
async def test_select_clip_filters_by_creator_id(monkeypatch):
    clips = [
        make_clip("https://clips.twitch.tv/a", "1", "alice"),
        make_clip("https://clips.twitch.tv/b", "2", "bob"),
    ]
    twitch = FakeTwitch(clips)
    monkeypatch.setattr("clip_selector.random.choice", lambda items: items[0])

    selected = await select_clip(
        twitch=twitch,
        broadcaster_id="123",
        creator_id="2",
        creator_name="ignored",
    )

    assert selected.url == "https://clips.twitch.tv/b"


@pytest.mark.asyncio
async def test_select_clip_filters_by_creator_name_when_id_unavailable(monkeypatch):
    clips = [
        make_clip("https://clips.twitch.tv/a", "1", "alice"),
        make_clip("https://clips.twitch.tv/b", "2", "bob"),
    ]
    twitch = FakeTwitch(clips)
    monkeypatch.setattr("clip_selector.random.choice", lambda items: items[0])

    selected = await select_clip(
        twitch=twitch,
        broadcaster_id="123",
        creator_id=None,
        creator_name="BoB",
    )

    assert selected.url == "https://clips.twitch.tv/b"


@pytest.mark.asyncio
async def test_select_clip_returns_none_when_no_creator_match():
    clips = [
        make_clip("https://clips.twitch.tv/a", "1", "alice"),
    ]
    twitch = FakeTwitch(clips)

    selected = await select_clip(
        twitch=twitch,
        broadcaster_id="123",
        creator_id="99",
        creator_name="nobody",
    )

    assert selected is None
