const state = {
  loading: true,
  isRefreshing: false,
  items: [],
  error: null,
  metadata: null,
};

const appRoot = document.getElementById('app');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
let refreshTimer = null;

syncTheme(prefersDark.matches);
prefersDark.addEventListener('change', (event) => syncTheme(event.matches));

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="refresh"]');
  if (button) {
    event.preventDefault();
    loadArticles({ refresh: true });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadArticles({ refresh: true, silent: true });
  }
});

render();
loadArticles();

function syncTheme(isDark) {
  document.body.classList.toggle('dark', Boolean(isDark));
}

async function loadArticles(options = {}) {
  const { refresh = false, silent = false } = options;
  clearTimeout(refreshTimer);

  if (!silent) {
    state.loading = !state.items.length;
    state.isRefreshing = state.items.length > 0;
    state.error = null;
    render();
  } else {
    state.isRefreshing = true;
    render();
  }

  try {
    const endpoint = refresh ? '/api/articles?refresh=true' : '/api/articles';
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    const payload = await response.json();
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.metadata = payload.metadata || null;
    state.error = null;
    state.loading = false;
    state.isRefreshing = false;
    scheduleAutoRefresh();
  } catch (error) {
    console.error('Failed to load articles', error);
    state.error = error;
    state.loading = false;
    state.isRefreshing = false;
  } finally {
    render();
  }
}

function scheduleAutoRefresh() {
  const ttl = state.metadata?.cacheTtlMs || 5 * 60 * 1000;
  const delay = Math.max(60 * 1000, Math.min(ttl, 5 * 60 * 1000));
  refreshTimer = setTimeout(() => {
    loadArticles({ refresh: true, silent: true });
  }, delay);
}

function render() {
  if (!appRoot) return;

  if (state.loading && !state.items.length) {
    appRoot.innerHTML = renderSkeleton();
    return;
  }

  if (state.error && !state.items.length) {
    appRoot.innerHTML = renderError(state.error);
    return;
  }

  const header = renderHeader();
  const refreshBar = renderRefreshBar();
  const content = state.items.length ? renderArticles(state.items) : renderEmpty();

  appRoot.innerHTML = `${header}${refreshBar}${content}`;
}

function renderHeader() {
  const metadata = state.metadata;
  const feedTitle = metadata?.feedTitle || 'AI News Collections';
  const feedDescription =
    metadata?.feedDescription || 'Streamlined bilingual insights distilled from the smol.ai community feed.';
  const feedLink = metadata?.feedLink;
  const llmActive = metadata?.llmEnabled;
  const llmModel = metadata?.llmModel || (llmActive ? 'Configured model' : 'Heuristic mode');
  const fetchedAt = metadata?.fetchedAt ? new Date(metadata.fetchedAt) : null;
  const dataSource = metadata?.source === 'sample' ? 'Sample dataset' : 'Live feed';

  const articleCount = metadata?.articleCount ?? state.items.length;

  return `
    <header class="app-header" role="banner">
      <div>
        <h1>AI News Collections</h1>
        <p>${htmlEscape(feedDescription)}</p>
        <div class="header-meta">
          <span class="meta-pill">${llmActive ? 'LLM summaries active' : 'Heuristic summaries (configure API key)'}</span>
          ${feedLink ? `<a class="meta-link" href="${htmlEscape(feedLink)}" target="_blank" rel="noopener">Visit source feed</a>` : ''}
        </div>
      </div>
      <div class="meta-grid" aria-label="Feed statistics">
        <div class="meta-card">
          <strong>Feed</strong>
          <span>${htmlEscape(feedTitle)}</span>
        </div>
        <div class="meta-card">
          <strong>Articles</strong>
          <span>${articleCount}</span>
        </div>
        <div class="meta-card">
          <strong>Summariser</strong>
          <span>${htmlEscape(llmModel)}</span>
        </div>
        <div class="meta-card">
          <strong>Data source</strong>
          <span>${dataSource}</span>
        </div>
        <div class="meta-card">
          <strong>Updated</strong>
          <span>${fetchedAt ? formatRelativeTime(fetchedAt) : '—'}</span>
        </div>
      </div>
    </header>
  `;
}

function renderRefreshBar() {
  const fetchedAt = state.metadata?.fetchedAt ? new Date(state.metadata.fetchedAt) : null;
  const nextRefresh = state.metadata?.cacheTtlMs ? state.metadata.cacheTtlMs / 1000 : 300;
  const nextRefreshText = Math.round(nextRefresh / 60);
  const statusText = state.isRefreshing ? 'Refreshing…' : 'Refresh feed';
  const sourceLabel = state.metadata?.source === 'sample' ? 'offline sample data' : 'live feed';
  const subText = fetchedAt
    ? `Last updated ${formatRelativeTime(fetchedAt)} (${formatDate(fetchedAt)}) • ${sourceLabel}`
    : 'Awaiting first sync';

  return `
    <section class="refresh-bar" aria-live="polite">
      <div>
        <strong>${subText}</strong>
        <div>Auto-refresh every ~${nextRefreshText} min.</div>
      </div>
      <button type="button" data-action="refresh" ${state.isRefreshing ? 'disabled' : ''}>
        ${statusText}
      </button>
    </section>
  `;
}

function renderArticles(items) {
  return `
    <section class="articles-grid" aria-live="polite">
      ${items.map(renderArticleCard).join('')}
    </section>
  `;
}

function renderArticleCard(item) {
  const published = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : null;
  const summary = item.summary || {};
  const statusClass = summary.status === 'ok' ? '' : summary.status === 'fallback' ? 'fallback' : summary.status === 'empty' ? 'error' : '';
  const statusLabel = summary.status === 'ok' ? 'LLM summary' : summary.status === 'fallback' ? 'Fallback summary' : 'Unavailable';
  const categories = Array.isArray(item.categories) ? item.categories : [];

  return `
    <article class="article-card" aria-labelledby="article-${hashString(item.link)}">
      <div class="article-header">
        <h2 id="article-${hashString(item.link)}">${htmlEscape(item.title || 'Untitled')}</h2>
        <div class="article-actions">
          <span class="status-pill ${statusClass}">${statusLabel}</span>
          <a href="${htmlEscape(item.link)}" target="_blank" rel="noopener">Open original ↗</a>
        </div>
      </div>
      <div class="metadata-row">
        ${published ? `<span>🕒 ${formatDate(published)} (${formatRelativeTime(published)})</span>` : ''}
        ${item.author ? `<span>✍️ ${htmlEscape(item.author)}</span>` : ''}
        ${categories.map((category) => `<span class="tag-chip">#${htmlEscape(category)}</span>`).join('')}
      </div>
      <div class="summary-columns">
        <div class="summary-block">
          <h3>English</h3>
          <p class="summary-text">${formatSummary(summary.english || 'No summary available.')}</p>
        </div>
        <div class="summary-block">
          <h3>中文</h3>
          <p class="summary-text">${formatSummary(summary.chinese || '暂无摘要，等待大模型生成。')}</p>
        </div>
      </div>
    </article>
  `;
}

function renderSkeleton() {
  return `
    <div class="loading-grid">
      ${Array.from({ length: 4 })
        .map(() => '<div class="skeleton-card" aria-hidden="true"></div>')
        .join('')}
    </div>
  `;
}

function renderError(error) {
  const message = error?.message || 'Unknown error';
  return `
    <section class="error-state" role="alert">
      <h2>Unable to load the feed</h2>
      <p>${htmlEscape(message)}</p>
      <button type="button" class="retry" data-action="refresh">Try again</button>
    </section>
  `;
}

function renderEmpty() {
  return `
    <section class="empty-state">
      <h2>No articles yet</h2>
      <p>The feed did not return any items. Please try again shortly.</p>
      <button type="button" data-action="refresh">Refresh now</button>
    </section>
  `;
}

function formatSummary(text) {
  return htmlEscape(text).replace(/\n/g, '<br />');
}

function htmlEscape(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  try {
    return new Intl.DateTimeFormat('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch (error) {
    return date?.toISOString?.() || 'Unknown date';
  }
}

function formatRelativeTime(date) {
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }
  return rtf.format(diffDays, 'day');
}

function hashString(value) {
  if (!value) return Math.random().toString(36).slice(2, 7);
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
