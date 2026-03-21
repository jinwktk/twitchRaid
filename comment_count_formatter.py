from __future__ import annotations


def format_total_comment_count(total_count: int) -> str:
    """配信開始からの累計コメント件数を整形する。"""
    return f"配信開始からの累計コメント: {total_count}件"
