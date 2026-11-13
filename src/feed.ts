import { canonicalizePublisher } from './services/publisherNormalize';
import type { ArticleFilterMode, FeedScope, UILanguageMode, WorkbenchLaunchState } from './types';
import { runBatchImport, updateBatchBar } from './ui/cardActions';
import {
  loadFeed,
  renderArticles,
  retryJournalFeed,
  toggleSelectAllVisible,
  toggleTranslateAll,
  updateBulkTranslateButton,
} from './ui/cards';
import {
  type FeedHostContext,
  type FeedUIState,
  createInitialFeedState,
  getString,
  resolveFeedContext,
  setScope,
  showNotice,
} from './ui/feedState';
import { applyToolbarStaticLabels, initFeedToolbar } from './ui/feedToolbar';
import { initKeyboardNav, renderKeyboardHelpModal } from './ui/keyboardNav';
import { initLightbox } from './ui/lightbox';
import {
  initFollowedFilter,
  initJournalSearch,
  initSidebarChrome,
  renderSidebar,
  renderSidebarPresetsAndIO,
} from './ui/sidebar';

function applyStaticLabels(doc: Document, ctx: FeedHostContext, state: FeedUIState): void {
  const S = (id: string) => getString(ctx, id);
  doc.documentElement.lang = ctx.JournalFlow.getUILang();

  const setText = (id: string, text: string) => {
    const el = doc.getElementById(id);
    if (el) el.textContent = text;
  };
  const setFilterLabel = (id: string, text: string) => {
    const el = doc.getElementById(id);
    if (!el) return;
    const label = el.querySelector('.filter-label');
    if (label) label.textContent = text;
    else el.textContent = text;
  };
  setText('lang-label', S('lang-label'));
  setText('refresh-btn', S('refresh'));
  setText('h-followed', S('followed'));
  setText('h-add', S('add-journal'));
  setText('h-presets', S('presets-title'));
  setText('h-subs-io', S('subs-actions'));
  setText('lang-option-auto', S('lang-auto'));
  setText('lang-option-en', S('lang-en'));
  setText('lang-option-zh', S('lang-zh'));
  setFilterLabel('filter-all-btn', S('filter-all'));
  setFilterLabel('filter-oa-btn', S('filter-oa'));
  setFilterLabel('filter-abstract-btn', S('filter-abstract'));
  setFilterLabel('filter-figures-btn', S('filter-figures'));
  setFilterLabel('filter-unread-btn', S('filter-unread'));
  setFilterLabel('filter-starred-btn', S('filter-starred'));
  setText('collection-root-opt', S('collection-root'));
  applyToolbarStaticLabels(doc, ctx);
  renderKeyboardHelpModal(doc, ctx);

  doc.documentElement.dataset.windowMode =
    typeof ctx.JournalFlow.getWindowMode === 'function'
      ? ctx.JournalFlow.getWindowMode()
      : String(ctx.JournalFlow.getPref?.('windowMode') || ctx.windowMode || 'tab') === 'window'
        ? 'window'
        : 'tab';

  const searchInput = doc.getElementById('journal-search-input') as HTMLInputElement | null;
  if (searchInput) searchInput.placeholder = S('search-ph');
  const followedFilterInput = doc.getElementById('followed-filter-input') as HTMLInputElement | null;
  if (followedFilterInput) followedFilterInput.placeholder = S('followed-filter-ph');
  const articleSearchInput = doc.getElementById('article-search-input') as HTMLInputElement | null;
  if (articleSearchInput) articleSearchInput.placeholder = S('article-search-ph');
  const refreshBtn = doc.getElementById('refresh-btn') as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.title = S('refresh-tooltip');

  const mode = ctx.JournalFlow.getUILanguageMode();
  for (const btn of Array.from(doc.querySelectorAll('#lang-toggle button'))) {
    const el = btn as HTMLElement;
    const active = el.dataset.lang === mode;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  updateBulkTranslateButton(doc, ctx, state);
  updateBatchBar(doc, ctx, state);
}

function normalizeLaunchScope(
  scope: FeedScope,
  journals: FeedUIState['journals']
): FeedScope | null {
  if (scope.type === 'all') {
    return { type: 'all', id: null };
  }
  if (scope.type === 'issn') {
    const issn = scope.id?.trim() || '';
    if (issn && journals.some((j) => j.issn === issn)) {
      return { type: 'issn', id: issn };
    }
    return null;
  }
  if (scope.type === 'publisher') {
    const id = scope.id?.trim() || '';
    if (
      id &&
      journals.some((j) => canonicalizePublisher(j.publisher) === id)
    ) {
      return { type: 'publisher', id };
    }
    return null;
  }
  return null;
}

function applyLaunchState(
  doc: Document,
  state: FeedUIState,
  launchState?: WorkbenchLaunchState
): boolean {
  if (!launchState) return false;
  let changed = false;
  if (launchState.activeScope) {
    const normalized = normalizeLaunchScope(launchState.activeScope, state.journals);
    if (normalized) {
      const same =
        state.activeScope.type === normalized.type && state.activeScope.id === normalized.id;
      if (!same) {
        setScope(state, normalized);
        changed = true;
      }
    }
  } else if (launchState.activeISSN !== undefined) {
    const valid =
      launchState.activeISSN === null ||
      state.journals.some((j) => j.issn === launchState.activeISSN);
    const nextIssn = valid ? launchState.activeISSN : null;
    if (nextIssn === null) {
      if (state.activeScope.type !== 'all') {
        setScope(state, { type: 'all', id: null });
        changed = true;
      } else if (state.activeISSN !== null) {
        state.activeISSN = null;
        changed = true;
      }
    } else if (state.activeScope.type !== 'issn' || state.activeScope.id !== nextIssn) {
      setScope(state, { type: 'issn', id: nextIssn });
      changed = true;
    }
  }
  if (launchState.articleQuery !== undefined) {
    const q = String(launchState.articleQuery || '').trim();
    const articleSearch = doc.getElementById('article-search-input') as HTMLInputElement | null;
    if (articleSearch) articleSearch.value = q;
    if (state.articleQuery !== q) {
      state.articleQuery = q;
      changed = true;
    }
  }
  return changed;
}

function initWorkbench(): void {
  const doc = globalThis.document;
  if (!doc) return;
  const ctx = resolveFeedContext(globalThis);
  if (!ctx) {
    const status = doc.getElementById('status');
    if (status) {
      status.hidden = false;
      status.classList.add('error');
      status.textContent = 'Zotero JournalFlow service is unavailable.';
    }
    return;
  }

  const state = createInitialFeedState();
  const controller = new AbortController();
  const { signal } = controller;

  const cleanup = () => {
    controller.abort();
    if (state.figureObserver) {
      state.figureObserver.disconnect();
      state.figureObserver = null;
    }
    if (state.primeTimer !== null) clearTimeout(state.primeTimer);
    if (state.noticeTimer !== null) clearTimeout(state.noticeTimer);
  };
  globalThis.addEventListener('pagehide', cleanup, { once: true });
  globalThis.addEventListener('unload', cleanup, { once: true });

  state.journals = ctx.JournalFlow.getJournals();
  applyLaunchState(doc, state, ctx.initialState);
  applyStaticLabels(doc, ctx, state);

  const syncSidebarAndRefreshState = () => {
    const refreshBtn = doc.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.classList.toggle('is-refreshing', state.isRefreshing);
    renderSidebar(doc, ctx, state, reloadFeed, retrySingleJournal);
  };

  const reloadFeed = () => {
    void loadFeed(doc, ctx, state, {
      force: false,
      soft: false,
      onJournalStatus: syncSidebarAndRefreshState,
    }).catch((e) => {
      showNotice(doc, state, String(e?.message || e), 'error');
    });
  };

  const retrySingleJournal = (issn: string) => {
    void retryJournalFeed(doc, ctx, state, issn, syncSidebarAndRefreshState).catch((e) => {
      showNotice(doc, state, String(e?.message || e), 'error');
    });
  };

  globalThis.addEventListener(
    'message',
    (event: MessageEvent) => {
      if (event?.data?.type === 'JOURNALFLOW_STATE') {
        const nextLaunch = event.data.state as WorkbenchLaunchState | undefined;
        state.journals = ctx.JournalFlow.getJournals();
        if (applyLaunchState(doc, state, nextLaunch)) {
          syncSidebarAndRefreshState();
          reloadFeed();
        }
      }
    },
    { signal }
  );

  for (const btn of Array.from(doc.querySelectorAll('#lang-toggle button'))) {
    const el = btn as HTMLElement;
    el.addEventListener(
      'click',
      () => {
        const nextMode = (el.dataset.lang || 'auto') as UILanguageMode;
        ctx.JournalFlow.setUILanguage(nextMode);
        applyStaticLabels(doc, ctx, state);
        syncSidebarAndRefreshState();
        renderSidebarPresetsAndIO(doc, ctx, state, signal, reloadFeed, retrySingleJournal);
        renderArticles(doc, ctx, state);
      },
      { signal }
    );
  }

  for (const pill of Array.from(doc.querySelectorAll('#filter-pills button[data-filter]'))) {
    const el = pill as HTMLElement;
    el.addEventListener(
      'click',
      () => {
        state.filterMode = (el.dataset.filter || 'all') as ArticleFilterMode;
        state.visibleLimit = 40;
        renderArticles(doc, ctx, state);
      },
      { signal }
    );
  }

  const colSelect = doc.getElementById('collection-select') as HTMLSelectElement | null;
  colSelect?.addEventListener(
    'change',
    () => {
      state.targetCollectionID = colSelect.value ? Number(colSelect.value) : null;
    },
    { signal }
  );
  doc.getElementById('select-all-btn')?.addEventListener(
    'click',
    () => toggleSelectAllVisible(doc, ctx, state),
    { signal }
  );
  doc.getElementById('batch-import-btn')?.addEventListener(
    'click',
    () => void runBatchImport(doc, ctx, state, () => renderArticles(doc, ctx, state)),
    { signal }
  );

  doc.getElementById('refresh-btn')?.addEventListener(
    'click',
    () => {
      void loadFeed(doc, ctx, state, {
        force: true,
        soft: state.articles.length > 0,
        onJournalStatus: syncSidebarAndRefreshState,
      }).catch((e) => {
        showNotice(doc, state, String(e?.message || e), 'error');
      });
    },
    { signal }
  );

  doc.getElementById('translate-all-btn')?.addEventListener(
    'click',
    () => {
      void toggleTranslateAll(doc, ctx, state);
    },
    { signal }
  );

  const articleSearch = doc.getElementById('article-search-input') as HTMLInputElement | null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  signal.addEventListener('abort', () => {
    if (searchTimer) clearTimeout(searchTimer);
  });
  articleSearch?.addEventListener(
    'input',
    () => {
      if (searchTimer) clearTimeout(searchTimer);
      const applySearch = () => {
        state.articleQuery = articleSearch.value.trim();
        state.visibleLimit = 40;
        renderArticles(doc, ctx, state);
      };
      const clearBtn = doc.getElementById('article-search-clear') as HTMLButtonElement | null;
      if (clearBtn) clearBtn.hidden = !articleSearch.value;
      if (state.articles.length > 200) {
        searchTimer = setTimeout(applySearch, 120);
      } else {
        applySearch();
      }
    },
    { signal }
  );

  initJournalSearch(doc, ctx, state, signal, reloadFeed, retrySingleJournal);
  initFollowedFilter(doc, ctx, state, signal, reloadFeed, retrySingleJournal);
  initSidebarChrome(doc, ctx, state, signal, reloadFeed, retrySingleJournal);
  initFeedToolbar(doc, ctx, state, signal, () => renderArticles(doc, ctx, state));
  initKeyboardNav(doc, ctx, state, signal);
  initLightbox(doc, state, signal, ctx);
  syncSidebarAndRefreshState();
  renderSidebarPresetsAndIO(doc, ctx, state, signal, reloadFeed, retrySingleJournal);
  reloadFeed();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkbench, { once: true });
  } else {
    initWorkbench();
  }
}
