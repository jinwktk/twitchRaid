class CommandCooldownState:
    """コマンド別の最終実行時刻を管理する。"""

    def __init__(self, initial_times):
        self._last_used_at = dict(initial_times)

    def _require_command(self, command_name: str):
        if command_name not in self._last_used_at:
            raise ValueError(f"unknown command: {command_name}")

    def last_used(self, command_name: str) -> float:
        self._require_command(command_name)
        return self._last_used_at[command_name]

    def mark_used(self, command_name: str, timestamp: float):
        self._require_command(command_name)
        self._last_used_at[command_name] = timestamp

    def remaining_seconds(self, command_name: str, current_time: float, cooldown_seconds: int) -> int:
        self._require_command(command_name)
        last_used_at = self._last_used_at[command_name]
        if not last_used_at:
            return 0

        elapsed = current_time - last_used_at
        if elapsed >= cooldown_seconds:
            return 0

        return int(cooldown_seconds - elapsed)
