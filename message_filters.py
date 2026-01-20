from __future__ import annotations


def is_command_message(content: str, prefix: str) -> bool:
    """コマンドとして判定できるメッセージかを返す。"""
    if not content or not prefix:
        return False
    stripped = content.lstrip()
    if not stripped:
        return False
    return stripped.startswith(prefix)
