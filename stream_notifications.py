"""配信タイトルに基づく通知制御ユーティリティ"""

from __future__ import annotations

import logging
from typing import Callable


class StreamTitleNotifier:
    """配信開始通知の送信可否を判定・記録するクラス"""

    def __init__(self, config, login_channel: str):
        self.config = config
        self.login_channel = login_channel
        self._last_notified_title = self._normalize_title(
            getattr(self.config, "LAST_STREAM_TITLE", "")
        )
    def _normalize_title(self, title: str | None) -> str:
        return (title or "").strip()

    def build_message(self, stream_title: str) -> str:
        """Discord送信用メッセージを組み立て"""
        normalized = self._normalize_title(stream_title)
        return f"{normalized}\n🔴 配信URL: https://www.twitch.tv/{self.login_channel}"

    def should_notify(self, stream_title: str | None) -> bool:
        """直前の配信タイトルとの差分を元に送信可否を返す"""
        normalized = self._normalize_title(stream_title)
        if not normalized:
            return False
        return normalized != self._last_notified_title

    def notify_if_needed(self, stream_title: str | None, sender: Callable[[str], None]) -> bool:
        """新規タイトルの場合のみ通知を実行する"""
        normalized = self._normalize_title(stream_title)

        if not normalized:
            logging.info("⚠️ 空の配信タイトルのため通知をスキップします。")
            return False

        if not self.should_notify(normalized):
            logging.info("ℹ️ 直前の配信とタイトルが同一のためDiscord通知をスキップします。")
            return False

        sender(self.build_message(normalized))
        self._last_notified_title = normalized
        if hasattr(self.config, "update_last_stream_title"):
            self.config.update_last_stream_title(normalized)
        else:
            setattr(self.config, "LAST_STREAM_TITLE", normalized)
        return True
