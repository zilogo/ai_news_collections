const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

loadDotEnv();

const PORT = parseInt(process.env.PORT || '4000', 10);
const RSS_URL = process.env.RSS_URL || 'https://news.smol.ai/rss.xml';
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || '12', 10);
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || String(5 * 60 * 1000), 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

let serverCache = {
  payload: null,
  fetchedAt: 0,
};
let inflightPromise = null;

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    if (requestUrl.pathname.startsWith('/api/articles')) {
      await handleArticlesApi(req, res, requestUrl);
      return;
    }

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    await serveStaticFile(requestUrl.pathname, res);
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith('#')) {
      return;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      return;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
}

async function handleArticlesApi(req, res, requestUrl) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const forceRefresh = requestUrl.searchParams.get('refresh') === 'true';
    const payload = await getArticlesPayload(forceRefresh);

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to process /api/articles:', error);
    res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ error: 'Failed to fetch or summarise feed', details: error.message }));
  }
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function serveStaticFile(urlPath, res) {
  const resolvedPath = resolvePublicPath(urlPath);
  try {
    const stat = await fsp.stat(resolvedPath);
    if (stat.isDirectory()) {
      const indexPath = path.join(resolvedPath, 'index.html');
      await streamFile(indexPath, 'text/html', res);
      return;
    }
    const mimeType = getMimeType(resolvedPath);
    await streamFile(resolvedPath, mimeType, res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(fallback)) {
        await streamFile(fallback, 'text/html', res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    throw error;
  }
}

function resolvePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const sanitized = path.normalize(decoded).replace(/^\.\.(\/|\\)/, '');
  const relativePath = sanitized === '/' ? 'index.html' : sanitized.slice(1);
  return path.join(PUBLIC_DIR, relativePath || 'index.html');
}

async function streamFile(filePath, mimeType, res) {
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=300',
  });
  const readStream = fs.createReadStream(filePath);
  readStream.on('error', (error) => {
    console.error('Stream error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
    }
    res.end('Internal server error');
  });
  readStream.pipe(res);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

async function getArticlesPayload(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && serverCache.payload && now - serverCache.fetchedAt < CACHE_TTL_MS) {
    return serverCache.payload;
  }

  if (!inflightPromise) {
    inflightPromise = fetchAndSummariseArticles()
      .then((payload) => {
        serverCache = { payload, fetchedAt: Date.now() };
        return payload;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }

  return inflightPromise;
}

async function fetchAndSummariseArticles() {
  const { xml, source } = await downloadFeedXml(RSS_URL);
  const parsed = parseRssFeed(xml);
  const limitedItems = parsed.items.slice(0, MAX_ARTICLES);
  const summaries = [];

  for (const item of limitedItems) {
    // eslint-disable-next-line no-await-in-loop
    const summary = await generateSummary(item);
    summaries.push({ ...item, summary });
  }

  const payload = {
    metadata: {
      feedTitle: parsed.meta.title,
      feedDescription: parsed.meta.description,
      feedLink: parsed.meta.link,
      fetchedAt: new Date().toISOString(),
      articleCount: summaries.length,
      rssUrl: RSS_URL,
      llmEnabled: summaries.some((item) => item.summary.usedLLM),
      llmModel: summaries.find((item) => item.summary.model)?.summary?.model || process.env.OPENAI_MODEL || null,
      cacheTtlMs: CACHE_TTL_MS,
      source,
    },
    items: summaries,
  };

  return payload;
}

async function downloadFeedXml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-News-Collections/1.0 (+https://github.com/ai-news-collections)',
        Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
      const fallback = await loadSampleFeed();
      if (fallback) {
        console.warn('Using bundled sample feed due to HTTP error:', error.message);
        return { xml: fallback, source: 'sample' };
      }
      throw error;
    }
    const xml = await response.text();
    return { xml, source: 'live' };
  } catch (error) {
    const fallback = await loadSampleFeed();
    if (fallback) {
      console.warn('Using bundled sample feed due to fetch failure:', error.message);
      return { xml: fallback, source: 'sample' };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSampleFeed() {
  const samplePath = path.join(__dirname, 'sample-feed.xml');
  try {
    const xml = await fsp.readFile(samplePath, 'utf-8');
    return xml;
  } catch (error) {
    return null;
  }
}

function parseRssFeed(xml) {
  const channelMatch = xml.match(/<channel>([\s\S]*?)<\/channel>/i);
  const channel = channelMatch ? channelMatch[1] : '';
  const meta = {
    title: cleanTagValue(extractFirst(channel, 'title')) || 'News Feed',
    description: cleanTagValue(extractFirst(channel, 'description')),
    link: cleanTagValue(extractFirst(channel, 'link')),
  };

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const rawItem = match[1];
    const title = cleanTagValue(extractFirst(rawItem, 'title'));
    const link = cleanTagValue(extractFirst(rawItem, 'link'));
    const description = cleanTagValue(extractFirst(rawItem, 'description'));
    const content = cleanTagValue(extractFirst(rawItem, 'content:encoded')) || description;
    const pubDate = cleanTagValue(extractFirst(rawItem, 'pubDate'));
    const author = cleanTagValue(extractFirst(rawItem, 'dc:creator')) || cleanTagValue(extractFirst(rawItem, 'author'));
    const categories = extractAll(rawItem, 'category').map(cleanTagValue).filter(Boolean);

    items.push({
      title,
      link,
      description,
      content,
      pubDate,
      isoDate: parseDate(pubDate),
      author,
      categories,
      plainText: stripHtml(content || description),
    });
  }

  return { meta, items };
}

function extractFirst(fragment, tagName) {
  if (!fragment) return '';
  const regex = new RegExp(`<${tagName}(?:\s[^>]*)?>([\\s\\S]*?)<\/${tagName}>`, 'i');
  const match = fragment.match(regex);
  return match ? match[1] : '';
}

function extractAll(fragment, tagName) {
  if (!fragment) return [];
  const regex = new RegExp(`<${tagName}(?:\s[^>]*)?>([\\s\\S]*?)<\/${tagName}>`, 'gi');
  const results = [];
  let match;
  while ((match = regex.exec(fragment)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function cleanTagValue(value) {
  if (!value) return '';
  return decodeEntities(stripCdata(value).trim());
}

function stripCdata(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

async function generateSummary(item) {
  const baseText = item.plainText || item.description || item.title;
  if (!baseText) {
    return {
      english: 'No content available to summarise.',
      chinese: '暂无可用于生成摘要的内容。',
      usedLLM: false,
      model: null,
      status: 'empty',
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return fallbackSummary(item);
  }

  try {
    const llmResult = await callOpenAiSummary(item);
    return {
      english: llmResult.english,
      chinese: llmResult.chinese,
      usedLLM: true,
      model: llmResult.model,
      status: 'ok',
    };
  } catch (error) {
    console.warn('Falling back to heuristic summary:', error);
    const fallback = await fallbackSummary(item, error);
    return { ...fallback, status: 'fallback', error: error.message };
  }
}

async function callOpenAiSummary(item) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const requestBody = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a news summarisation assistant. Produce concise, neutral summaries in both English and Simplified Chinese. Always respond with JSON containing "english" and "chinese" fields.',
      },
      {
        role: 'user',
        content: `Summarise the following news article into one short paragraph (max 3 sentences) in English and Simplified Chinese.\n\nTitle: ${item.title}\nLink: ${item.link}\nPublished: ${item.isoDate || item.pubDate || 'Unknown'}\n\nContent: ${item.plainText}`,
      },
    ],
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorPayload = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorPayload}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Missing response content from OpenAI');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse OpenAI response JSON: ${error.message}`);
  }

  if (!parsed.english || !parsed.chinese) {
    throw new Error('OpenAI response missing expected fields');
  }

  return {
    english: parsed.english.trim(),
    chinese: parsed.chinese.trim(),
    model,
  };
}

async function fallbackSummary(item, error) {
  const baseText = item.plainText || item.description || item.title;
  const english = summariseHeuristically(baseText);
  const chinese = await simpleChineseFallback(english);
  return {
    english,
    chinese,
    usedLLM: false,
    model: null,
    error: error ? error.message : undefined,
  };
}

function summariseHeuristically(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 220) {
    return cleaned;
  }
  const sentences = cleaned.split(/(?<=[.!?。！？])\s+/);
  const summary = [];
  for (const sentence of sentences) {
    summary.push(sentence);
    if (summary.join(' ').length >= 220) {
      break;
    }
  }
  if (summary.length === 0) {
    return cleaned.slice(0, 220) + '…';
  }
  return summary.join(' ');
}

async function simpleChineseFallback(englishSummary) {
  try {
    const translation = await attemptPublicTranslation(englishSummary);
    if (translation && /[\u4e00-\u9fff]/.test(translation)) {
      return translation.trim();
    }
  } catch (error) {
    console.warn('Public translation fallback failed:', error.message);
  }

  return `（未启用大模型，以下为自动生成的提示）${englishSummary}`;
}

async function attemptPublicTranslation(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload?.responseData?.translatedText || null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { server };
