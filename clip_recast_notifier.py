from __future__ import annotations

from typing import Awaitable, Callable, Optional


class ClipRecastNotifier:
    """Clipコマンドのリキャスト完了を通知するための状態管理クラス。"""

    def __init__(self, cooldown_seconds: int = 1800, ready_message: str = "Clipコマンドのリキャストが戻りました！"):
        self.cooldown_seconds = cooldown_seconds
        self.ready_message = ready_message
        self._cooldown_started_at: Optional[float] = None
        self._send_coroutine: Optional[Callable[[str], Awaitable[None]]] = None
        self._notified = False

    def arm(self, started_at: float, send_coroutine: Callable[[str], Awaitable[None]]) -> None:
        """クールダウン開始時刻と送信先を登録する。"""
        self._cooldown_started_at = started_at
        self._send_coroutine = send_coroutine
        self._notified = False

    def disarm(self) -> None:
        """通知設定を解除する。"""
        self._cooldown_started_at = None
        self._send_coroutine = None
        self._notified = False

    async def notify_if_ready(self, current_time: float) -> bool:
        """クールダウンが明けていれば通知を送信し、送信したら True を返す。"""
        if (
            self._cooldown_started_at is None
            or self._send_coroutine is None
            or self._notified
        ):
            return False

        if current_time - self._cooldown_started_at < self.cooldown_seconds:
            return False

        await self._send_coroutine(self.ready_message)
        self._notified = True
        return True

    def has_pending_notification(self) -> bool:
        """通知待ちかどうかを返す。"""
        return (
            self._cooldown_started_at is not None
            and self._send_coroutine is not None
            and not self._notified
        )

    def remaining_seconds(self, current_time: float) -> int:
        """クールダウン残り秒数を返す（ゼロ未満にはならない）。"""
        if self._cooldown_started_at is None:
            return 0
        remaining = int(self.cooldown_seconds - (current_time - self._cooldown_started_at))
        return remaining if remaining > 0 else 0
