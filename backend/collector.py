"""RSS collector that fetches AI news and stores translated summaries."""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from typing import Iterable, Optional
from urllib.request import urlopen
from xml.etree import ElementTree as ET

from . import db
from .llm import LLMClient, MissingAPIKeyError, MissingLLMLibraryError

LOGGER = logging.getLogger(__name__)

XML_NAMESPACES = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "atom": "http://www.w3.org/2005/Atom",
}


@dataclass(slots=True)
class FeedEntry:
    title: str
    link: str
    published: Optional[str]
    updated: Optional[str]
    summary: Optional[str]
    contents: list[str]
    source_title: Optional[str]


def _text(element: Optional[ET.Element]) -> Optional[str]:
    if element is None or element.text is None:
        return None
    return element.text.strip()


def _parse_feed(feed_url: str) -> Iterable[FeedEntry]:
    with urlopen(feed_url) as response:
        data = response.read()

    root = ET.fromstring(data)
    items = root.findall(".//item")
    entries: list[FeedEntry] = []

    for item in items:
        title = _text(item.find("title")) or "Untitled"
        link = _text(item.find("link")) or ""
        published = _text(item.find("pubDate"))
        updated = _text(item.find("updated")) or _text(
            item.find("atom:updated", XML_NAMESPACES)
        )
        summary = _text(item.find("description"))
        contents = [
            text
            for node in item.findall("content:encoded", XML_NAMESPACES)
            if (text := _text(node))
        ]
        source_title = _text(item.find("source")) or _text(
            item.find("atom:source/atom:title", XML_NAMESPACES)
        )

        entries.append(
            FeedEntry(
                title=title,
                link=link,
                published=published,
                updated=updated,
                summary=summary,
                contents=contents,
                source_title=source_title,
            )
        )

    return entries


def _build_summary_text(entry: FeedEntry) -> str:
    parts = []
    if entry.summary:
        parts.append(entry.summary)
    parts.extend(entry.contents)
    return "\n\n".join(parts)


def process_feed(
    feed_url: str,
    *,
    llm_client: Optional[LLMClient],
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> int:
    """Fetch the feed and insert new articles, returning the number stored."""
    LOGGER.info("Fetching feed %s", feed_url)
    entries = _parse_feed(feed_url)
    count = 0

    for entry in entries:
        if limit is not None and count >= limit:
            break

        link = entry.link
        title = entry.title
        if not link:
            LOGGER.debug("Skipping entry without link: %s", title)
            continue
        if db.article_exists(link):
            LOGGER.debug("Skipping existing article: %s", link)
            continue

        published = entry.published or entry.updated
        source = entry.source_title
        original_summary = entry.summary
        translated_summary = None

        if llm_client is not None:
            LOGGER.info("Translating article via LLM: %s", title)
            summary_text = _build_summary_text(entry)
            translated_summary = llm_client.translate_and_summarise(
                title=title,
                summary=summary_text or original_summary or "",
                link=link,
            )
        else:
            LOGGER.info("LLM disabled; skipping translation for %s", title)

        if dry_run:
            LOGGER.info("Dry run: would store article %s", title)
            count += 1
            continue

        db.insert_article(
            title=title,
            link=link,
            published_at=published,
            source=source,
            original_summary=original_summary,
            translated_summary=translated_summary,
        )
        count += 1

    return count


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Collect and translate AI news articles")
    parser.add_argument("feed_url", help="RSS feed URL", nargs="?", default="https://news.smol.ai/rss.xml")
    parser.add_argument("--limit", type=int, help="Limit the number of processed entries")
    parser.add_argument("--skip-llm", action="store_true", help="Skip translation and only store metadata")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and translate without writing to the database")
    parser.add_argument("--model", default="gpt-4o-mini", help="OpenAI model name")
    parser.add_argument("--temperature", type=float, default=0.2, help="Sampling temperature for the model")
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    llm_client: Optional[LLMClient]
    if args.skip_llm:
        llm_client = None
    else:
        try:
            llm_client = LLMClient(model=args.model, temperature=args.temperature)
        except (MissingAPIKeyError, MissingLLMLibraryError) as exc:  # pragma: no cover - CLI behaviour
            parser.error(str(exc))
            return 2

    inserted = process_feed(
        args.feed_url,
        llm_client=llm_client,
        limit=args.limit,
        dry_run=args.dry_run,
    )
    LOGGER.info("Processed %s new articles", inserted)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entrypoint
    raise SystemExit(main())
