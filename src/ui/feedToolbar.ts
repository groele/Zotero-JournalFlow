import { articleMatchesFilterMode } from '../services/filtering';
import type { ArticleFilterMode, ArticleSortMode, JournalArticle } from '../types';
import { type FeedHostContext, type FeedUIState, getString, showNotice } from './feedState';
import { articleMatchesSearch } from './cardTranslation';
import { publisherDisplayName } from './sidebarTree';

export { articleMatchesFilterMode };

const SORT_STORAGE_KEY = 'journalflow.sortMode';
const VALID_SORT_MODES = new Set<ArticleSortMode>(['newest', 'unread', 'figures', 'journal', 'title']);

export interface ArticleFilterCounts {
  all: number;
  oa: number;
  abstract: number;
  figures: number;
  unread: number;
  starred: number;
}

export function sortArticles(articles: JournalArticle[], mode: ArticleSortMode): JournalArticle[] {
  if (mode === 'newest') return articles;
  const copy = [...articles];
  const byDateDesc = (a: JournalArticle, b: JournalArticle) => (b.date || '').localeCompare(a.date || '');
  switch (mode) {
    case 'unread':
      return copy.sort((a, b) => Number(Boolean(a._read)) - Number(Boolean(b._read)) || byDateDesc(a, b));
    case 'figures':
      return copy.sort((a, b) => (b.figures?.length ? 1 : 0) - (a.figures?.length ? 1 : 0) || byDateDesc(a, b));
    case 'journal':
      return copy.sort((a, b) => (a.journal || '').localeCompare(b.journal || '') || byDateDesc(a, b));
    case 'title':
      return copy.sort((a, b) => (a.title || '').localeCompare(b.title || '') || byDateDesc(a, b));
    default:
      return copy;
  }
}

export function computeFilterCounts(articles: JournalArticle[]): ArticleFilterCounts {
  const counts: ArticleFilterCounts = { all: articles.length, oa: 0, abstract: 0, figures: 0, unread: 0, starred: 0 };
  for (const a of articles) {
    if (a.isOpenAccess) counts.oa++;
    if (a.abstract) counts.abstract++;
    if (a.figures?.length) counts.figures++;
    if (!a._read) counts.unread++;
    if (a._starred) counts.starred++;
  }
  return counts;
}

function resolveScopeTitle(ctx: FeedHostContext, state: FeedUIState): string {
  const S = (id: string) => getString(ctx, id);
  const scope = state.activeScope;
  if (scope?.type === 'issn' && scope.id) {
    const journal = state.journals.find((j) => j.issn === scope.id);
    if (journal) return `${journal.title} · ${journal.issn}`;
    return scope.id;
  }
  if (scope?.type === 'publisher' && scope.id) {
    const label = publisherDisplayName(ctx, scope.id);
    const tpl = S('scope-publisher-title');
    return tpl !== 'scope-publisher-title' && tpl.includes('{name}')
      ? tpl.replace('{name}', label)
      : label;
  }
  const allTitle = S('scope-all-title');
  return allTitle !== 'scope-all-title' ? allTitle : S('all-journals');
}

export function updateFeedToolbar(doc: Document, ctx: FeedHostContext, state: FeedUIState): void {
  const S = (id: string) => getString(ctx, id);
  const titleEl = doc.getElementById('scope-banner-title');
  if (titleEl) {
    titleEl.textContent = resolveScopeTitle(ctx, state);
  }

  const counts = computeFilterCounts(state.articles);
  const metricsEl = doc.getElementById('scope-banner-metrics');
  if (metricsEl) {
    const tpl = S('scope-metrics');
    if (tpl !== 'scope-metrics' && tpl.includes('{total}')) {
      metricsEl.textContent = tpl
        .replace('{total}', String(counts.all))
        .replace('{unread}', String(counts.unread))
        .replace('{oa}', String(counts.oa))
        .replace('{starred}', String(counts.starred));
    } else {
      metricsEl.textContent = `${counts.all} · ${counts.unread} unread · ${counts.oa} OA · ${counts.starred} ★`;
    }
  }

  for (const btn of Array.from(doc.querySelectorAll('#filter-pills button[data-filter]'))) {
    const el = btn as HTMLElement;
    const countSpan = el.querySelector('.filter-count') as HTMLElement | null;
    if (!countSpan) continue;
    const mode = (el.dataset.filter || 'all') as ArticleFilterMode;
    const n = counts[mode] ?? 0;
    countSpan.hidden = state.articles.length === 0;
    countSpan.textContent = String(n);
  }

  const markBtn = doc.getElementById('mark-scope-read-btn') as HTMLButtonElement | null;
  if (markBtn) {
    markBtn.disabled = counts.unread === 0;
  }

  const resetBtn = doc.getElementById('reset-filters-btn') as HTMLButtonElement | null;
  if (resetBtn) {
    const dirty = Boolean(state.articleQuery || state.filterMode !== 'all' || state.sortMode !== 'newest');
    resetBtn.hidden = !dirty;
  }

  const clearSearchBtn = doc.getElementById('article-search-clear') as HTMLButtonElement | null;
  const searchInput = doc.getElementById('article-search-input') as HTMLInputElement | null;
  if (clearSearchBtn && searchInput) {
    clearSearchBtn.hidden = !searchInput.value;
  }

  const sortSelect = doc.getElementById('article-sort-select') as HTMLSelectElement | null;
  if (sortSelect && sortSelect.value !== state.sortMode) {
    sortSelect.value = state.sortMode;
  }
}

export function applyToolbarStaticLabels(doc: Document, ctx: FeedHostContext): void {
  const S = (id: string) => getString(ctx, id);
  const setText = (id: string, text: string) => {
    const el = doc.getElementById(id);
    if (el) el.textContent = text;
  };
  setText('sort-opt-newest', S('sort-newest'));
  setText('sort-opt-unread', S('sort-unread'));
  setText('sort-opt-figures', S('sort-figures'));
  setText('sort-opt-journal', S('sort-journal'));
  setText('sort-opt-title', S('sort-title'));
  setText('mark-scope-read-btn', S('mark-scope-read'));
  setText('reset-filters-btn', S('reset-filters'));
  setText('lightbox-copy-url-btn', S('lightbox-copy'));

  const sortSelect = doc.getElementById('article-sort-select') as HTMLSelectElement | null;
  if (sortSelect) sortSelect.setAttribute('aria-label', S('sort-label'));
  const clearBtn = doc.getElementById('article-search-clear') as HTMLButtonElement | null;
  if (clearBtn) {
    clearBtn.title = S('clear-search');
    clearBtn.setAttribute('aria-label', S('clear-search'));
  }
  const scrollBtn = doc.getElementById('scroll-top-btn') as HTMLButtonElement | null;
  if (scrollBtn) {
    scrollBtn.title = S('scroll-top');
    scrollBtn.setAttribute('aria-label', S('scroll-top'));
  }
  const openImgBtn = doc.getElementById('lightbox-open-btn') as HTMLButtonElement | null;
  if (openImgBtn) openImgBtn.title = S('lightbox-open');
}

export function initFeedToolbar(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  signal: AbortSignal,
  rerender: () => void
): void {
  const S = (id: string) => getString(ctx, id);
  try {
    const savedSort = doc.defaultView?.sessionStorage?.getItem(SORT_STORAGE_KEY) as ArticleSortMode | null;
    if (savedSort && VALID_SORT_MODES.has(savedSort)) {
      state.sortMode = savedSort;
    }
  } catch {}
  const saveSortMode = (mode: ArticleSortMode) => {
    try {
      doc.defaultView?.sessionStorage?.setItem(SORT_STORAGE_KEY, mode);
    } catch {}
  };
  const sortSelect = doc.getElementById('article-sort-select') as HTMLSelectElement | null;
  if (sortSelect && sortSelect.value !== state.sortMode) {
    sortSelect.value = state.sortMode;
  }
  sortSelect?.addEventListener(
    'change',
    () => {
      state.sortMode = (sortSelect.value || 'newest') as ArticleSortMode;
      saveSortMode(state.sortMode);
      state.visibleLimit = 40;
      rerender();
    },
    { signal }
  );

  const searchInput = doc.getElementById('article-search-input') as HTMLInputElement | null;
  const clearBtn = doc.getElementById('article-search-clear') as HTMLButtonElement | null;
  clearBtn?.addEventListener(
    'click',
    () => {
      if (searchInput) searchInput.value = '';
      state.articleQuery = '';
      state.visibleLimit = 40;
      rerender();
      searchInput?.focus();
    },
    { signal }
  );

  doc.getElementById('reset-filters-btn')?.addEventListener(
    'click',
    () => {
      if (searchInput) searchInput.value = '';
      state.articleQuery = '';
      state.filterMode = 'all';
      state.sortMode = 'newest';
      saveSortMode('newest');
      state.visibleLimit = 40;
      rerender();
    },
    { signal }
  );

  doc.getElementById('mark-scope-read-btn')?.addEventListener(
    'click',
    async () => {
      const targets = state.articles.filter(
        (a) =>
          !a._read &&
          articleMatchesFilterMode(a, state.filterMode) &&
          articleMatchesSearch(a, state.articleQuery)
      );
      if (!targets.length) return;
      for (const a of targets) {
        a._read = true;
      }
      if (typeof ctx.JournalFlow.setArticlesRead === 'function') {
        await Promise.resolve(ctx.JournalFlow.setArticlesRead(targets, true)).catch(() => {});
      } else {
        await Promise.all(
          targets.map((a) => Promise.resolve(ctx.JournalFlow.setArticleRead?.(a, true)).catch(() => {}))
        );
      }
      rerender();
      const tpl = S('marked-scope-read');
      const msg = tpl !== 'marked-scope-read' ? tpl.replace('{count}', String(targets.length)) : `${targets.length}`;
      showNotice(doc, state, msg, 'warn');
    },
    { signal }
  );

  const content = doc.getElementById('content');
  const scrollBtn = doc.getElementById('scroll-top-btn') as HTMLButtonElement | null;
  if (scrollBtn) {
    const win = doc.defaultView || globalThis;
    const syncScrollBtn = () => {
      const top = Math.max(content?.scrollTop || 0, win.scrollY || doc.documentElement?.scrollTop || 0);
      scrollBtn.hidden = top < 360;
    };
    content?.addEventListener('scroll', syncScrollBtn, { passive: true, signal });
    win.addEventListener('scroll', syncScrollBtn, { passive: true, signal });
    scrollBtn.addEventListener(
      'click',
      () => {
        content?.scrollTo?.({ top: 0, behavior: 'smooth' });
        win.scrollTo?.({ top: 0, behavior: 'smooth' });
      },
      { signal }
    );
  }
}
