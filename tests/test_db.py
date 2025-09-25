from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import db
from backend.collector import FeedEntry, _build_summary_text


def setup_temp_db(tmp_path: Path) -> None:
    db.DATA_DIR = tmp_path
    db.DB_PATH = tmp_path / "test.db"
    db.init_db()


def test_insert_and_fetch_articles(tmp_path):
    setup_temp_db(tmp_path)
    assert list(db.iter_recent_articles()) == []

    db.insert_article(
        title="Test",
        link="https://example.com",
        published_at="2024-01-01",
        source="Example",
        original_summary="Original",
        translated_summary="Translated",
    )

    articles = list(db.iter_recent_articles())
    assert len(articles) == 1
    article = articles[0]
    assert article.title == "Test"
    assert article.link == "https://example.com"
    assert article.translated_summary == "Translated"


def test_article_exists(tmp_path):
    setup_temp_db(tmp_path)
    assert not db.article_exists("https://example.com")
    db.insert_article(
        title="Test",
        link="https://example.com",
        published_at=None,
        source=None,
        original_summary=None,
        translated_summary=None,
    )
    assert db.article_exists("https://example.com")


def test_build_summary_text_prefers_all_content():
    entry = FeedEntry(
        title="Title",
        link="https://example.com",
        published=None,
        updated=None,
        summary="Short",
        contents=["Long form content"],
        source_title=None,
    )
    result = _build_summary_text(entry)
    assert "Short" in result and "Long form content" in result
