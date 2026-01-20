from __future__ import annotations

from typing import Tuple

from dotenv import dotenv_values, set_key


def load_comment_state(env_file: str) -> Tuple[int, float]:
    """.env からコメント件数と配信開始時刻を読み込む。"""
    values = dotenv_values(env_file)
    raw_count = values.get("COMMENT_TOTAL_COUNT", "0")
    raw_started_at = values.get("STREAM_STARTED_AT", "0")
    try:
        total_count = int(raw_count) if raw_count not in (None, "") else 0
    except (TypeError, ValueError):
        total_count = 0
    try:
        stream_started_at = float(raw_started_at) if raw_started_at not in (None, "") else 0.0
    except (TypeError, ValueError):
        stream_started_at = 0.0
    return total_count, stream_started_at


def save_comment_state(env_file: str, total_count: int, stream_started_at: float) -> None:
    """.env にコメント件数と配信開始時刻を書き込む。"""
    set_key(env_file, "COMMENT_TOTAL_COUNT", str(total_count))
    set_key(env_file, "STREAM_STARTED_AT", str(stream_started_at))
