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

    def _prune(self, current_time: float) -> None:
        cutoff = current_time - self.window_seconds
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()

    def record(self, timestamp: float) -> None:
        """コメントの受信時刻を記録する。"""
        self._prune(timestamp)
        self._timestamps.append(timestamp)

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
