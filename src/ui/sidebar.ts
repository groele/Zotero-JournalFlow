import type { PresetPackId } from '../types';
import { type FeedHostContext, type FeedScopeState, type FeedUIState, getString, showNotice } from './feedState';
import { hideSearchResults, initJournalSearch } from './journalSearch';
import { loadCollapsedPublishers, setButtonSvgIcon } from './sidebarIcons';
import { collapseAllPublishers, expandAllPublishers, renderJournalListTree } from './sidebarTree';

export { hideSearchResults, initJournalSearch };

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
  } catch {}
}

export function initSidebarChrome(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedScopeState,
  signal: AbortSignal,
  onSelectFeed: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  loadCollapsedPublishers(doc, state);
  const S = (id: string) => getString(ctx, id);
  const collapsePubs = doc.getElementById('collapse-publishers-btn') as HTMLButtonElement | null;
  const expandPubs = doc.getElementById('expand-publishers-btn') as HTMLButtonElement | null;
  const hideSidebar = doc.getElementById('sidebar-collapse-btn') as HTMLButtonElement | null;
  const showSidebar = doc.getElementById('sidebar-expand-btn') as HTMLButtonElement | null;

  if (collapsePubs) {
    collapsePubs.title = S('collapse-all-publishers');
    collapsePubs.setAttribute('aria-label', collapsePubs.title);
    setButtonSvgIcon(doc, collapsePubs, 'collapse-all');
    collapsePubs.addEventListener(
      'click',
      () => {
        collapseAllPublishers(state, doc);
        renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
      },
      { signal }
    );
  }
  if (expandPubs) {
    expandPubs.title = S('expand-all-publishers');
    expandPubs.setAttribute('aria-label', expandPubs.title);
    setButtonSvgIcon(doc, expandPubs, 'expand-all');
    expandPubs.addEventListener(
      'click',
      () => {
        expandAllPublishers(state, doc);
        renderSidebar(doc, ctx, state, onSelectFeed, onRetryJournal);
      },
      { signal }
    );
  }
  if (hideSidebar) {
    hideSidebar.title = S('hide-sidebar');
    hideSidebar.setAttribute('aria-label', hideSidebar.title);
    setButtonSvgIcon(doc, hideSidebar, 'panel-collapse');
    hideSidebar.addEventListener('click', () => setSidebarCollapsed(doc, true), { signal });
  }
  if (showSidebar) {
    showSidebar.title = S('show-sidebar');
    showSidebar.setAttribute('aria-label', showSidebar.title);
    setButtonSvgIcon(doc, showSidebar, 'panel-expand');
    showSidebar.addEventListener('click', () => setSidebarCollapsed(doc, false), { signal });
  }
  setSidebarCollapsed(doc, false);
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
      btn.dataset.presetId = preset.id;
      btn.textContent = S(preset.labelKey);
      btn.title = btn.textContent;
      presetList.appendChild(btn);
    }
    if (!presetList.dataset.jfBound) {
      presetList.dataset.jfBound = '1';
      presetList.addEventListener(
        'click',
        (event: Event) => {
          const target = (event.target as Element | null)?.closest?.('button.preset-btn') as HTMLButtonElement | null;
          const presetId = target?.dataset.presetId as PresetPackId | undefined;
          if (!presetId || typeof ctx.JournalFlow.applyJournalPreset !== 'function') return;
          state.journals = ctx.JournalFlow.applyJournalPreset(presetId);
          renderSidebar(doc, ctx, state, onChanged, onRetryJournal);
          onChanged();
        },
        { signal }
      );
    }
  }

  const exportBtn = doc.getElementById('export-subs-btn') as HTMLButtonElement | null;
  const importBtn = doc.getElementById('import-subs-btn') as HTMLButtonElement | null;
  const fileInput = doc.getElementById('import-subs-input') as HTMLInputElement | null;

  if (exportBtn) {
    exportBtn.textContent = S('export-subs');
    if (!exportBtn.dataset.jfBound) {
      exportBtn.dataset.jfBound = '1';
      exportBtn.addEventListener('click', async () => {
        if (exportBtn.disabled) return;
        exportBtn.disabled = true;
        try {
          if (typeof ctx.JournalFlow.exportSubscriptionsToFile === 'function') {
            const res = await ctx.JournalFlow.exportSubscriptionsToFile();
            if (res?.saved) {
              showNotice(doc, state, S('export-subs-ok').replace('{path}', res.path || 'journalflow-subscriptions.json'), 'warn');
              return;
            }
            if (res && (res.canceled || !res.unavailable)) return;
          }
          const json = ctx.JournalFlow.exportSubscriptionsJSON?.() || JSON.stringify(state.journals, null, 2);
          const BlobCtor = (doc.defaultView as any)?.Blob || globalThis.Blob;
          const URLApi = (doc.defaultView as any)?.URL || globalThis.URL;
          if (!BlobCtor || !URLApi?.createObjectURL) throw new Error('Export API unavailable');
          const url = URLApi.createObjectURL(new BlobCtor([json], { type: 'application/json' }));
          const a = doc.createElement('a');
          a.href = url;
          a.download = 'journalflow-subscriptions.json';
          doc.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URLApi.revokeObjectURL?.(url), 1000);
          showNotice(doc, state, S('export-subs-ok').replace('{path}', 'journalflow-subscriptions.json'), 'warn');
        } catch {
          showNotice(doc, state, S('export-subs-err'), 'error');
        } finally {
          exportBtn.disabled = false;
        }
      }, { signal });
    }
  }

  const applyImported = (nextJournals: FeedUIState['journals']) => {
    state.journals = nextJournals;
    renderSidebar(doc, ctx, state, onChanged, onRetryJournal);
    onChanged();
    showNotice(doc, state, S('import-subs-ok').replace('{count}', String(state.journals.length)), 'warn');
  };

  if (importBtn && fileInput) {
    importBtn.textContent = S('import-subs');
    if (!importBtn.dataset.jfBound) {
      importBtn.dataset.jfBound = '1';
      importBtn.addEventListener('click', async () => {
        if (importBtn.disabled) return;
        if (typeof ctx.JournalFlow.importSubscriptionsFromFile === 'function') {
          importBtn.disabled = true;
          try {
            const res = await ctx.JournalFlow.importSubscriptionsFromFile();
            if (res?.imported && res.journals) {
              applyImported(res.journals);
              return;
            }
            if (res && (res.canceled || !res.unavailable)) return;
          } catch {
            showNotice(doc, state, S('import-subs-err'), 'error');
            return;
          } finally {
            importBtn.disabled = false;
          }
        }
        fileInput.click();
      }, { signal });
    }

    if (!fileInput.dataset.jfBound) {
      fileInput.dataset.jfBound = '1';
      fileInput.addEventListener(
        'change',
        async () => {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file || typeof ctx.JournalFlow.importSubscriptionsJSON !== 'function') return;
          try {
            applyImported(ctx.JournalFlow.importSubscriptionsJSON(await file.text()));
          } catch {
            showNotice(doc, state, S('import-subs-err'), 'error');
          }
        },
        { signal }
      );
    }
  }
}
