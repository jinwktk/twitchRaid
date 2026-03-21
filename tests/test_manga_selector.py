import pytest

from manga_selector import (
    DL_SITE_GIRLS_DAY_RANKING_URL,
    extract_manga_titles,
    fetch_random_manga_title,
    select_manga_title,
)


SAMPLE_HTML = """
<dl class=\"work_1col\">
  <dt class=\"work_name\">
    <a href=\"https://www.dlsite.com/girls/work/=/product_id/RJ0001.html\">作品A</a>
  </dt>
</dl>
<dl class=\"work_1col\">
  <dt class=\"work_name\">
    <span class=\"period_date\">期間限定</span>
    <a href=\"https://www.dlsite.com/girls/work/=/product_id/RJ0002.html\">作品B&amp;特典</a>
  </dt>
</dl>
"""


class StubRandom:
    def choice(self, items):
        return items[1]


class StubResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


def test_extract_manga_titles_from_ranking_html():
    assert extract_manga_titles(SAMPLE_HTML) == ["作品A", "作品B&特典"]


def test_select_manga_title_uses_rng_choice():
    titles = ["作品A", "作品B"]

    result = select_manga_title(titles, rng=StubRandom())

    assert result == "作品B"


def test_fetch_random_manga_title_fetches_ranking_page():
    called = {}

    def fake_get(url, timeout):
        called["url"] = url
        called["timeout"] = timeout
        return StubResponse(SAMPLE_HTML)

    result = fetch_random_manga_title(http_get=fake_get, rng=StubRandom())

    assert result == "作品B&特典"
    assert called["url"] == DL_SITE_GIRLS_DAY_RANKING_URL
    assert called["timeout"] == 10


def test_fetch_random_manga_title_raises_when_title_missing():
    with pytest.raises(ValueError):
        fetch_random_manga_title(http_get=lambda *_args, **_kwargs: StubResponse("<html></html>"))
