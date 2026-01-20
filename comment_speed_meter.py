from __future__ import annotations

from collections import deque
from typing import Deque


class CommentSpeedMeter:
    """コメントの風速(コメント/分)を計測するユーティリティ。"""

    def __init__(self, window_seconds: int = 60) -> None:
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.window_seconds = window_seconds
        self._timestamps: Deque[float] = deque()
        self._stream_started_at: float | None = None
        self._total_count = 0

    def start_stream(self, started_at: float) -> None:
        """配信開始時刻を設定し、計測状態をリセットする。"""
        self._stream_started_at = started_at
        self._timestamps.clear()
        self._total_count = 0

    def reset_stream(self) -> None:
        """配信終了時に計測状態をリセットする。"""
        self._stream_started_at = None
        self._timestamps.clear()
        self._total_count = 0

    def ensure_stream_started(self, started_at: float) -> None:
        """配信開始時刻が未設定の場合のみ設定する。"""
        if self._stream_started_at is None:
            self.start_stream(started_at)

    def _prune(self, current_time: float) -> None:
        cutoff = current_time - self.window_seconds
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()

    def record(self, timestamp: float) -> None:
        """コメントの受信時刻を記録する。"""
        if self._stream_started_at is None:
            self._stream_started_at = timestamp
        self._prune(timestamp)
        self._timestamps.append(timestamp)
        self._total_count += 1

    def count(self, current_time: float) -> int:
        """計測窓内のコメント数を返す。"""
        self._prune(current_time)
        return len(self._timestamps)

    def rate_per_minute(self, current_time: float) -> int:
        """コメント/分を返す。"""
        count = self.count(current_time)
        if count == 0:
            return 0
        return int(count * 60 / self.window_seconds)

    def total_count(self) -> int:
        """配信開始からのコメント総数を返す。"""
        return self._total_count

    def total_rate_per_minute(self, current_time: float) -> int:
        """配信開始からの平均コメント/分を返す。"""
        if self._stream_started_at is None:
            return 0
        elapsed = current_time - self._stream_started_at
        if elapsed <= 0:
            return 0
        return int(self._total_count * 60 / elapsed)
