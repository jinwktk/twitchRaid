from comment_count_formatter import format_total_comment_count


def test_format_total_comment_count():
    assert format_total_comment_count(0) == "配信開始からの累計コメント: 0件"
    assert format_total_comment_count(12) == "配信開始からの累計コメント: 12件"
