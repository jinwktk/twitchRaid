from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple


def load_last_restart(path: str) -> Optional[float]:
    """最終再起動時刻を読み込む。"""
    file_path = Path(path)
    if not file_path.exists():
        return None
    try:
        raw = file_path.read_text(encoding="utf-8").strip()
        if not raw:
            return None
        return float(raw)
    except (OSError, ValueError):
        return None


def save_last_restart(path: str, timestamp: float) -> None:
    """最終再起動時刻を書き込む。"""
    file_path = Path(path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(str(timestamp), encoding="utf-8")


def evaluate_restart(now: float, last: Optional[float], interval: float) -> Tuple[bool, float]:
    """再起動可否と次の保存値を返す。"""
    if last is None:
        return False, now
    if now - last > interval:
        return True, now
    return False, last
