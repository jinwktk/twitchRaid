import random
from typing import Optional


async def select_clip(twitch, broadcaster_id: str, creator_id: Optional[str] = None, creator_name: Optional[str] = None):
    """配信者のクリップから1件を選択。必要なら作成者で絞り込む。"""
    clips = [
        clip
        async for clip in twitch.get_clips(
            broadcaster_id=broadcaster_id,
            first=100,
        )
    ]

    if creator_id is not None or creator_name:
        clips = [
            clip
            for clip in clips
            if _is_creator_match(
                clip,
                creator_id=creator_id,
                creator_name=creator_name,
            )
        ]

    if not clips:
        return None

    return random.choice(clips)


def _is_creator_match(clip, creator_id: Optional[str], creator_name: Optional[str]) -> bool:
    clip_creator_id = getattr(clip, "creator_id", None)
    if creator_id is not None and clip_creator_id is not None:
        return str(clip_creator_id) == str(creator_id)

    clip_creator_name = getattr(clip, "creator_name", None)
    if creator_name and clip_creator_name:
        return str(clip_creator_name).strip().lower() == str(creator_name).strip().lower()

    return False
