from __future__ import annotations

from pathlib import Path
from typing import Mapping


BACKUP_SUFFIX = ".bak"
TEMP_SUFFIX = ".tmp"


def update_env_file(env_file: str, updates: Mapping[str, str]) -> None:
    """.env を安全に更新する。"""
    path = Path(env_file)
    path.parent.mkdir(parents=True, exist_ok=True)

    backup_path = path.with_suffix(path.suffix + BACKUP_SUFFIX)
    original_text = ""
    if path.exists():
        original_text = path.read_text(encoding="utf-8")
        if not original_text.strip() and backup_path.exists():
            original_text = backup_path.read_text(encoding="utf-8")

    lines = original_text.splitlines()
    updated_keys = set()
    new_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            new_lines.append(line)
            continue
        key, _value = line.split("=", 1)
        key = key.strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}")
            updated_keys.add(key)
        else:
            new_lines.append(line)

    for key, value in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={value}")

    new_text = "\n".join(new_lines)
    if new_text:
        new_text += "\n"

    if path.exists():
        backup_path.write_text(original_text, encoding="utf-8")

    temp_path = path.with_suffix(path.suffix + TEMP_SUFFIX)
    temp_path.write_text(new_text, encoding="utf-8")
    temp_path.replace(path)
