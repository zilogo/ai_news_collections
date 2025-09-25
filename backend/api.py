"""FastAPI application that exposes the aggregated AI news."""
from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import db

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="AI News Collections")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


@app.get("/api/articles")
def list_articles(limit: int = 50) -> List[dict]:
    articles = [
        {
            "title": article.title,
            "link": article.link,
            "published_at": article.published_at,
            "source": article.source,
            "original_summary": article.original_summary,
            "translated_summary": article.translated_summary,
            "created_at": article.created_at.isoformat(),
        }
        for article in db.iter_recent_articles(limit)
    ]
    return articles


@app.get("/", response_class=HTMLResponse)
def index(request: Request, limit: int = 50) -> HTMLResponse:
    articles = list(db.iter_recent_articles(limit))
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "articles": articles,
        },
    )
