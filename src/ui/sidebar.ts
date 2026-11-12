import type { JournalSubscription, PresetPackId } from '../types';
import { type FeedHostContext, type FeedScopeState, type FeedUIState, getString, setScope, showNotice } from './feedState';
import {
  collapseAllPublishers,
  expandAllPublishers,
  renderJournalListTree,
} from './sidebarTree';

const PRESETS: ReadonlyArray<{ id: PresetPackId; labelKey: string }> = [
  { id: 'top', labelKey: 'preset-top' },
  { id: 'aps', labelKey: 'preset-aps' },
  { id: 'acs', labelKey: 'preset-acs' },
  { id: 'wiley', labelKey: 'preset-wiley' },
  { id: 'springer', labelKey: 'preset-springer' },
  { id: 'rsc', labelKey: 'preset-rsc' },
  { id: 'elsevier', labelKey: 'preset-elsevier' },
  { id: 'ieee', labelKey: 'preset-ieee' },
];

export function renderSidebar(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedScopeState,
  onSelectFeed: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
}

function setSidebarCollapsed(doc: Document, collapsed: boolean): void {
  const layout = doc.getElementById('layout');
  const expandBtn = doc.getElementById('sidebar-expand-btn') as HTMLButtonElement | null;
  layout?.classList.toggle('is-sidebar-collapsed', collapsed);
  if (expandBtn) expandBtn.hidden = !collapsed;
  try {
    doc.defaultView?.sessionStorage?.setItem('journalflow.sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    // sessionStorage may be unavailable in some chrome contexts
  }
}

export function initSidebarChrome(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedScopeState,
  signal: AbortSignal,
  onSelectFeed: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  const S = (id: string) => getString(ctx, id);
  const collapsePubs = doc.getElementById('collapse-publishers-btn') as HTMLButtonElement | null;
  const expandPubs = doc.getElementById('expand-publishers-btn') as HTMLButtonElement | null;
  const hideSidebar = doc.getElementById('sidebar-collapse-btn') as HTMLButtonElement | null;
  const showSidebar = doc.getElementById('sidebar-expand-btn') as HTMLButtonElement | null;

  if (collapsePubs) {
    collapsePubs.title = S('collapse-all-publishers');
    collapsePubs.setAttribute('aria-label', collapsePubs.title);
    collapsePubs.textContent = '▾';
    collapsePubs.addEventListener(
      'click',
      () => {
        collapseAllPublishers(state);
        renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
      },
      { signal }
    );
  }
  if (expandPubs) {
    expandPubs.title = S('expand-all-publishers');
    expandPubs.setAttribute('aria-label', expandPubs.title);
    expandPubs.textContent = '▸';
    expandPubs.addEventListener(
      'click',
      () => {
        expandAllPublishers(state);
        renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
      },
      { signal }
    );
  }
  if (hideSidebar) {
    hideSidebar.title = S('hide-sidebar');
    hideSidebar.setAttribute('aria-label', hideSidebar.title);
    hideSidebar.addEventListener('click', () => setSidebarCollapsed(doc, true), { signal });
  }
  if (showSidebar) {
    showSidebar.title = S('show-sidebar');
    showSidebar.setAttribute('aria-label', showSidebar.title);
    showSidebar.addEventListener('click', () => setSidebarCollapsed(doc, false), { signal });
  }

  let restored = false;
  try {
    restored = doc.defaultView?.sessionStorage?.getItem('journalflow.sidebarCollapsed') === '1';
  } catch {
    restored = false;
  }
  setSidebarCollapsed(doc, restored);
}

export function initFollowedFilter(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedScopeState,
  signal: AbortSignal,
  onSelectFeed: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  const input = doc.getElementById('followed-filter-input') as HTMLInputElement | null;
  if (!input) return;
  input.value = state.followedFilterQuery || '';

  input.addEventListener(
    'input',
    () => {
      state.followedFilterQuery = input.value.trim();
      renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
    },
    { signal }
  );

  input.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && input.value) {
        input.value = '';
        state.followedFilterQuery = '';
        renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
      }
    },
    { signal }
  );
}

export function renderSidebarPresetsAndIO(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  signal: AbortSignal,
  onChanged: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  const S = (id: string) => getString(ctx, id);
  const presetList = doc.getElementById('journal-presets');
  if (presetList) {
    presetList.replaceChildren();
    for (const preset of PRESETS) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.textContent = S(preset.labelKey);
      btn.title = btn.textContent;
      btn.addEventListener(
        'click',
        () => {
          if (typeof ctx.JournalFlow.applyJournalPreset !== 'function') return;
          state.journals = ctx.JournalFlow.applyJournalPreset(preset.id);
          renderSidebar(doc, ctx, state, onChanged, onRetryJournal);
          onChanged();
        },
        { signal }
      );
      presetList.appendChild(btn);
    }
  }

  const exportBtn = doc.getElementById('export-subs-btn') as HTMLButtonElement | null;
  const importBtn = doc.getElementById('import-subs-btn') as HTMLButtonElement | null;
  const fileInput = doc.getElementById('import-subs-input') as HTMLInputElement | null;

  if (exportBtn) {
    exportBtn.textContent = S('export-subs');
    exportBtn.addEventListener(
      'click',
      () => {
        const json = ctx.JournalFlow.exportSubscriptionsJSON?.() || JSON.stringify(state.journals, null, 2);
        const BlobCtor = (doc.defaultView as any)?.Blob || globalThis.Blob;
        const URLApi = (doc.defaultView as any)?.URL || globalThis.URL;
        if (!BlobCtor || !URLApi?.createObjectURL) return;
        const blob = new BlobCtor([json], { type: 'application/json' });
        const url = URLApi.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = 'journalflow-subscriptions.json';
        doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URLApi.revokeObjectURL?.(url), 1000);
      },
      { signal }
    );
  }

  if (importBtn && fileInput) {
    importBtn.textContent = S('import-subs');
    importBtn.addEventListener('click', () => fileInput.click(), { signal });
    fileInput.addEventListener(
      'change',
      async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file || typeof ctx.JournalFlow.importSubscriptionsJSON !== 'function') return;
        try {
          const text = await file.text();
          state.journals = ctx.JournalFlow.importSubscriptionsJSON(text);
          renderSidebar(doc, ctx, state, onChanged, onRetryJournal);
          onChanged();
          showNotice(
            doc,
            state,
            S('import-subs-ok').replace('{count}', String(state.journals.length)),
            'warn'
          );
        } catch {
          showNotice(doc, state, S('import-subs-err'), 'error');
        }
      },
      { signal }
    );
  }
}

export function hideSearchResults(doc: Document): void {
  const results = doc.getElementById('journal-search-results');
  if (!results) return;
  results.hidden = true;
  results.replaceChildren();
}

export function initJournalSearch(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  signal: AbortSignal,
  onFollow: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  const input = doc.getElementById('journal-search-input') as HTMLInputElement | null;
  if (!input) return;

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  signal.addEventListener(
    'abort',
    () => {
      if (searchTimer) clearTimeout(searchTimer);
    },
    { once: true }
  );

  input.addEventListener(
    'input',
    () => {
      if (searchTimer) clearTimeout(searchTimer);
      const query = input.value.trim();
      if (!query) {
        hideSearchResults(doc);
        return;
      }
      searchTimer = setTimeout(() => {
        void runJournalSearch(doc, ctx, state, query, signal, onFollow, onRetryJournal);
      }, 400);
    },
    { signal }
  );

  input.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideSearchResults(doc);
        input.blur();
      }
    },
    { signal }
  );

  const addJournalBox = doc.getElementById('add-journal');
  doc.addEventListener(
    'click',
    (event: MouseEvent) => {
      if (addJournalBox && !addJournalBox.contains(event.target as Node)) {
        hideSearchResults(doc);
      }
    },
    { signal }
  );
}

async function runJournalSearch(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  query: string,
  signal: AbortSignal,
  onFollow: () => void,
  onRetryJournal?: (issn: string) => void
): Promise<void> {
  if (signal.aborted) return;
  const results = doc.getElementById('journal-search-results');
  const input = doc.getElementById('journal-search-input') as HTMLInputElement | null;
  if (!results) return;

  const S = (id: string) => getString(ctx, id);
  results.hidden = false;
  results.replaceChildren();
  const loadingLi = doc.createElement('li');
  loadingLi.textContent = S('searching');
  results.appendChild(loadingLi);

  let found: JournalSubscription[] = [];
  try {
    if (/^\d{4}-?\d{3}[\dXx]$/.test(query)) {
      const issn = (query.length === 8 ? `${query.slice(0, 4)}-${query.slice(4)}` : query).toUpperCase();
      found = [await ctx.JournalFlow.getJournalByISSN(issn)];
    } else {
      found = await ctx.JournalFlow.searchJournals(query);
    }
  } catch (e) {
    ctx.Zotero?.debug?.(`[JournalFlow] journal search failed: ${e}`);
  }

  if (signal.aborted) return;
  results.replaceChildren();
  if (!found.length) {
    const empty = doc.createElement('li');
    empty.textContent = S('no-results');
    results.appendChild(empty);
    return;
  }

  for (const journal of found) {
    const item = doc.createElement('li');
    const name = doc.createElement('span');
    name.textContent = journal.title;
    item.appendChild(name);

    const publisher = doc.createElement('span');
    publisher.className = 'publisher';
    publisher.textContent = `${journal.publisher || ''} · ${journal.issn}`;
    item.appendChild(publisher);

    item.addEventListener('click', () => {
      state.journals = ctx.JournalFlow.followJournal(journal);
      if (input) input.value = '';
      hideSearchResults(doc);
      setScope(state, { type: 'issn', id: journal.issn });
      renderSidebar(doc, ctx, state, onFollow, onRetryJournal);
      onFollow();
    });
    results.appendChild(item);
  }
}
