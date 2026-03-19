from dataclasses import dataclass


@dataclass
class PendingDeleteMessage:
    content: str
    channel_name: str
    delete_after_seconds: int
    queued_at: float


class PendingDeleteTracker:
    def __init__(self, stale_seconds=60.0):
        self.stale_seconds = float(stale_seconds)
        self._entries = []

    def add(self, content, channel_name, delete_after_seconds, now):
        self._entries.append(
            PendingDeleteMessage(
                content=content,
                channel_name=channel_name,
                delete_after_seconds=int(delete_after_seconds),
                queued_at=float(now),
            )
        )

    def pop_matched(self, content, channel_name, now):
        self._prune(now)
        for idx, entry in enumerate(self._entries):
            if entry.content == content and entry.channel_name == channel_name:
                return self._entries.pop(idx)
        return None

    def pop_first_for_channel(self, channel_name, now):
        self._prune(now)
        for idx, entry in enumerate(self._entries):
            if entry.channel_name == channel_name:
                return self._entries.pop(idx)
        return None

    def _prune(self, now):
        now = float(now)
        self._entries = [
            entry
            for entry in self._entries
            if (now - entry.queued_at) <= self.stale_seconds
        ]
