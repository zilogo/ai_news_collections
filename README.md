# AI News Collections

A lightweight Node.js service that ingests the [`news.smol.ai`](https://news.smol.ai/rss.xml) RSS feed, summarises the latest
posts with a large-language-model (LLM), and serves a modern bilingual (English ⇄ 中文) reading experience on the web.

The project is dependency-free on the server side (only Node.js built-ins) to keep installation simple inside restricted
environments. When an `OPENAI_API_KEY` is configured, each article is summarised and translated via the OpenAI Chat Completions
API. Without a key, the server falls back to heuristic summaries with an optional public translation service and clearly marks
the result in the UI.

## Features

- **RSS ingestion & caching** – fetches the `news.smol.ai` feed, normalises entries, and caches the response for five minutes.
- **LLM-powered summarisation** – sends article text to the OpenAI API (configurable model) for concise English & Simplified
  Chinese summaries with JSON-formatted responses.
- **Graceful fallback mode** – if the LLM is unavailable, the server generates lightweight heuristic summaries and attempts a
  free translation API before displaying a clearly labelled placeholder.
- **Modern UI** – responsive, glassmorphism-inspired layout with light/dark theme support, skeleton loading states, refresh
  controls, and timeline metadata.
- **Zero build tooling** – static frontend assets powered by modern browser APIs (`fetch`, `Intl`, CSS variables) served
  directly from Node.js.
 - **Offline-friendly sample data** – a bundled RSS snapshot guarantees the experience loads even when the live feed is
   unreachable.

## Getting started

### 1. Clone & configure

```bash
npm install  # optional – there are no production dependencies, but keeps the npm lockfile up to date
```

Create a `.env` file in the project root (next to `server.js`) to configure your API credentials:

```env
OPENAI_API_KEY=sk-your-openai-key
OPENAI_MODEL=gpt-4o-mini      # optional, defaults to gpt-4o-mini
PORT=4000                     # optional, defaults to 4000
RSS_URL=https://news.smol.ai/rss.xml
MAX_ARTICLES=12               # optional cap on rendered stories
CACHE_TTL_MS=300000           # optional cache lifetime in milliseconds
```

> **Note**: Without `OPENAI_API_KEY` the service still runs, but the summaries will indicate that the LLM is not enabled.

### 2. Start the server

```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000) in your browser. The frontend calls `GET /api/articles` to fetch the cached
feed and renders the bilingual summaries. Use the “Refresh feed” button to force a fresh pull (`GET /api/articles?refresh=true`).

### 3. Optional: deploy elsewhere

Because the server relies solely on Node.js built-ins, it can run wherever Node 18+ is available (Docker, serverless functions,
etc.). Set the same environment variables and expose the port.

## API

- `GET /api/articles` – returns cached summaries and metadata.
- `GET /api/articles?refresh=true` – forces the server to refetch the RSS feed and recompute summaries.
- Static assets (`/`, `/styles.css`, `/app.js`) deliver the frontend UI.

### Response shape

```json
{
  "metadata": {
    "feedTitle": "smol.ai news",
    "feedDescription": "...",
    "feedLink": "https://news.smol.ai",
    "fetchedAt": "2025-05-01T12:00:00.000Z",
    "articleCount": 10,
    "rssUrl": "https://news.smol.ai/rss.xml",
    "llmEnabled": true,
    "llmModel": "gpt-4o-mini",
    "cacheTtlMs": 300000,
    "source": "live"
  },
  "items": [
    {
      "title": "...",
      "link": "https://...",
      "isoDate": "2025-05-01T11:45:00.000Z",
      "author": "...",
      "categories": ["AI", "Community"],
      "summary": {
        "english": "...",
        "chinese": "...",
        "usedLLM": true,
        "status": "ok"
      }
    }
  ]
}
```

## Development notes

- The OpenAI call requests a JSON-formatted response for deterministic parsing. Any API errors trigger the fallback path.
- Fallback translation uses the public `api.mymemory.translated.net` endpoint with a short timeout; failures revert to a
  clearly labelled placeholder string.
- Auto-refresh is scheduled using the reported cache TTL (defaults to five minutes) and also triggers when the tab becomes
  visible again.
- The frontend relies on modern browser features (ES modules, CSS custom properties, `Intl.RelativeTimeFormat`). For legacy
  browsers you may need polyfills.

## License

MIT
