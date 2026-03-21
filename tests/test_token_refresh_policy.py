from token_refresh_policy import should_try_fallback


def test_should_try_fallback_false_when_status_200():
    assert should_try_fallback(200) is False


def test_should_try_fallback_true_when_status_400():
    assert should_try_fallback(400) is True


def test_should_try_fallback_false_when_status_500():
    assert should_try_fallback(500) is False


def test_should_try_fallback_true_when_status_401():
    assert should_try_fallback(401) is True
