"""Database utilities for storing aggregated AI news articles."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Generator, Iterable, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "articles.db"


def init_db() -> None:
    """Ensure the SQLite database and articles table exist."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                link TEXT NOT NULL UNIQUE,
                published_at TEXT,
                source TEXT,
                original_summary TEXT,
                translated_summary TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


@contextmanager
def get_connection() -> Generator[sqlite3.Connection, None, None]:
    """Context manager that yields a SQLite connection with row factory."""
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@dataclass(slots=True)
class Article:
    """Data container representing a stored news article."""

    title: str
    link: str
    published_at: Optional[str]
    source: Optional[str]
    original_summary: Optional[str]
    translated_summary: Optional[str]
    created_at: datetime

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Article":
        return cls(
            title=row["title"],
            link=row["link"],
            published_at=row["published_at"],
            source=row["source"],
            original_summary=row["original_summary"],
            translated_summary=row["translated_summary"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


def article_exists(link: str) -> bool:
    """Return True if an article with the given link is already stored."""
    with get_connection() as conn:
        cur = conn.execute("SELECT 1 FROM articles WHERE link = ? LIMIT 1", (link,))
        return cur.fetchone() is not None


def insert_article(
    *,
    title: str,
    link: str,
    published_at: Optional[str],
    source: Optional[str],
    original_summary: Optional[str],
    translated_summary: Optional[str],
) -> None:
    """Persist a new article record to the database."""
    with get_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO articles (
                title,
                link,
                published_at,
                source,
                original_summary,
                translated_summary,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title,
                link,
                published_at,
                source,
                original_summary,
                translated_summary,
                datetime.utcnow().isoformat(timespec="seconds"),
            ),
        )
        conn.commit()


def iter_recent_articles(limit: Optional[int] = None) -> Iterable[Article]:
    """Yield stored articles ordered by creation date descending."""
    query = "SELECT * FROM articles ORDER BY created_at DESC"
    params: tuple[object, ...] = ()
    if limit is not None:
        query += " LIMIT ?"
        params = (limit,)

    with get_connection() as conn:
        for row in conn.execute(query, params):
            yield Article.from_row(row)
