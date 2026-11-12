import type { JournalSubscription } from '../types';
import { type FeedHostContext, type FeedUIState, getString, setScope } from './feedState';
import { renderJournalListTree } from './sidebarTree';

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
      renderJournalListTree(doc, ctx, state, onFollow, onRetryJournal);
      onFollow();
    });
    results.appendChild(item);
  }
}
