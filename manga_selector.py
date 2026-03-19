import html
import random
import re

import requests


DL_SITE_GIRLS_DAY_RANKING_URL = "https://www.dlsite.com/girls/ranking/day"
_WORK_NAME_PATTERN = re.compile(r'<dt class="work_name">(?P<body>.*?)</dt>', re.DOTALL)
_ANCHOR_PATTERN = re.compile(r"<a [^>]*>(?P<title>.*?)</a>", re.DOTALL)
_TAG_PATTERN = re.compile(r"<[^>]+>")


def extract_manga_titles(ranking_html):
    """DLsiteランキングHTMLから作品タイトルを抽出する。"""
    titles = []
    for work_name_block in _WORK_NAME_PATTERN.findall(ranking_html):
        anchor_match = _ANCHOR_PATTERN.search(work_name_block)
        if not anchor_match:
            continue
        title = _TAG_PATTERN.sub("", anchor_match.group("title"))
        normalized_title = html.unescape(title).strip()
        if normalized_title:
            titles.append(normalized_title)
    return titles


def select_manga_title(titles, rng=None):
    """抽出済みタイトル一覧から1件ランダムで返す。"""
    if not titles:
        raise ValueError("manga title list is empty")
    if rng is None:
        rng = random
    return rng.choice(titles)


def fetch_random_manga_title(http_get=requests.get, rng=None):
    """DLsite日間ランキングを取得し、ランダムなタイトルを返す。"""
    response = http_get(DL_SITE_GIRLS_DAY_RANKING_URL, timeout=10)
    response.raise_for_status()
    titles = extract_manga_titles(response.text)
    if not titles:
        raise ValueError("ranking page has no manga titles")
    return select_manga_title(titles, rng=rng)
