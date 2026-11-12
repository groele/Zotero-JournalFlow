import { groupJournalsByPublisher } from '../services/publisherNormalize';
import type { JournalFeedStatus, JournalSubscription } from '../types';
import { type FeedHostContext, type FeedScopeState, getString, setScope } from './feedState';
import { createSidebarSvg, saveCollapsedPublishers } from './sidebarIcons';

export function publisherDisplayName(ctx: FeedHostContext, canonical: string): string {
  if (canonical === 'Other') {
    return getString(ctx, 'publisher-other');
  }
  return canonical;
}

function publisherGroupCount(
  journals: JournalSubscription[],
  journalCounts: Record<string, number>
): number {
  const loaded = journals.reduce((sum, j) => sum + (journalCounts[j.issn] ?? 0), 0);
  return loaded > 0 ? loaded : journals.length;
}

function appendCountBadge(doc: Document, parent: HTMLElement, count: number): void {
  const cnt = doc.createElement('span');
  cnt.className = 'jcount';
  cnt.textContent = count > 0 ? String(count) : '–';
  parent.appendChild(cnt);
}

function appendStatusSlot(doc: Document, parent: HTMLElement): void {
  const spacer = doc.createElement('span');
  spacer.className = 'tree-status-slot';
  spacer.setAttribute('aria-hidden', 'true');
  parent.appendChild(spacer);
}

function appendActionSlot(doc: Document, parent: HTMLElement): void {
  const spacer = doc.createElement('span');
  spacer.className = 'tree-action-slot';
  spacer.setAttribute('aria-hidden', 'true');
  parent.appendChild(spacer);
}

function createChevronSvg(doc: Document): Element {
  return createSidebarSvg(doc, 'chevron-down', 'chevron-icon');
}

function formatStatusTime(timestamp?: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function appendJournalStatus(
  doc: Document,
  parent: HTMLElement,
  journal: JournalSubscription,
  status: JournalFeedStatus | undefined,
  S: (id: string) => string,
  onRetryJournal?: (issn: string) => void
): void {
  if (!status || status.state === 'idle') {
    appendStatusSlot(doc, parent);
    return;
  }
  if (status.state === 'error') {
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.className = 'jstatus-retry';
    retry.dataset.status = 'error';
    retry.textContent = '!';
    const errTip = S('journal-status-error').replace('{journal}', journal.title);
    retry.title = status.error ? `${errTip}\n${status.error}` : errTip;
    retry.setAttribute('aria-label', S('journal-retry').replace('{journal}', journal.title));
    retry.addEventListener('click', (event) => {
      event.stopPropagation();
      onRetryJournal?.(journal.issn);
    });
    parent.appendChild(retry);
    return;
  }
  const dot = doc.createElement('span');
  dot.className = `jstatus jstatus-${status.state}`;
  dot.dataset.status = status.state;
  dot.setAttribute('aria-hidden', 'true');
  if (status.state === 'loading') {
    dot.title = S('journal-status-loading').replace('{journal}', journal.title);
  } else {
    dot.title = S('journal-status-ok')
      .replace('{time}', formatStatusTime(status.updatedAt) || '—')
      .replace('{count}', String(status.count ?? 0));
  }
  parent.appendChild(dot);
}

function matchesFollowedQuery(journal: JournalSubscription, query: string): boolean {
  if (!query) return true;
  const hay = `${journal.title} ${journal.publisher || ''} ${journal.issn}`.toLowerCase();
  return hay.includes(query);
}

const justExpandedByState = new WeakMap<FeedScopeState, string>();

function togglePublisherCollapsed(
  state: FeedScopeState,
  canonical: string,
  collapse: boolean,
  doc?: Document
): void {
  const next = new Set(state.collapsedPublishers);
  if (collapse) {
    next.add(canonical);
    justExpandedByState.delete(state);
  } else {
    next.delete(canonical);
    justExpandedByState.set(state, canonical);
  }
  state.collapsedPublishers = next;
  if (doc) saveCollapsedPublishers(doc, state);
}

export function collapseAllPublishers(state: FeedScopeState, doc?: Document): void {
  justExpandedByState.delete(state);
  state.collapsedPublishers = new Set(
    groupJournalsByPublisher(state.journals).map((group) => group.publisher)
  );
  if (doc) saveCollapsedPublishers(doc, state);
}

export function expandAllPublishers(state: FeedScopeState, doc?: Document): void {
  justExpandedByState.delete(state);
  state.collapsedPublishers = new Set();
  if (doc) saveCollapsedPublishers(doc, state);
}

export function renderJournalListTree(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedScopeState,
  onSelectFeed: () => void,
  onRetryJournal?: (issn: string) => void
): void {
  const list = doc.getElementById('journal-list');
  if (!list) return;
  list.replaceChildren();

  const S = (id: string) => getString(ctx, id);
  const scope = state.activeScope;
  const filterQuery = (state.followedFilterQuery || '').trim().toLowerCase();
  const countBadge = doc.getElementById('followed-count-badge');
  if (countBadge) countBadge.textContent = String(state.journals.length);

  const allItem = doc.createElement('li');
  allItem.className = 'all-journals-node';
  allItem.classList.toggle('active', scope.type === 'all');
  const allWrap = doc.createElement('span');
  allWrap.className = 'name-wrap';
  allWrap.appendChild(createSidebarSvg(doc, 'all-journals', 'all-journals-icon'));
  const allName = doc.createElement('span');
  allName.className = 'name';
  allName.textContent = S('all-journals');
  allWrap.appendChild(allName);
  allItem.appendChild(allWrap);
  appendStatusSlot(doc, allItem);
  const loadedTotal = Object.values(state.journalCounts).reduce((sum, n) => sum + n, 0);
  appendCountBadge(doc, allItem, loadedTotal > 0 ? loadedTotal : state.journals.length);
  appendActionSlot(doc, allItem);
  allItem.addEventListener('click', () => {
    setScope(state, { type: 'all', id: null });
    renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
    onSelectFeed();
  });
  list.appendChild(allItem);

  const visibleJournals = filterQuery
    ? state.journals.filter((j) => matchesFollowedQuery(j, filterQuery))
    : state.journals;

  if (filterQuery && state.journals.length && !visibleJournals.length) {
    const empty = doc.createElement('li');
    empty.className = 'journal-empty-filter';
    empty.textContent = S('no-followed-matches');
    list.appendChild(empty);
    return;
  }

  const groups = groupJournalsByPublisher(visibleJournals);
  const justExpanded = justExpandedByState.get(state);
  if (justExpanded !== undefined) justExpandedByState.delete(state);
  for (const group of groups) {
    const canonical = group.publisher;
    const collapsed = !filterQuery && state.collapsedPublishers.has(canonical);
    const hasLoading = group.journals.some((j) => state.journalStatus?.[j.issn]?.state === 'loading');
    const hasError = group.journals.some((j) => state.journalStatus?.[j.issn]?.state === 'error');
    const isPubActive = scope.type === 'publisher' && scope.id === canonical;
    const hasActiveChild = scope.type === 'issn' && group.journals.some((j) => j.issn === scope.id);

    const groupItem = doc.createElement('li');
    groupItem.className = 'publisher-group';
    groupItem.dataset.publisher = canonical;
    groupItem.classList.toggle('is-collapsed', collapsed);
    groupItem.classList.toggle('is-expanded', !collapsed);
    groupItem.classList.toggle('is-active-group', isPubActive || hasActiveChild);

    const cardList = doc.createElement('ul');
    cardList.className = 'publisher-card';

    const pubLi = doc.createElement('li');
    pubLi.className = 'publisher-node';
    pubLi.classList.toggle('is-collapsed', collapsed);
    pubLi.classList.toggle('is-expanded', !collapsed);
    pubLi.classList.toggle('active', isPubActive);
    pubLi.classList.toggle('is-loading', hasLoading);
    pubLi.classList.toggle('has-error', hasError);

    const pubName = doc.createElement('span');
    pubName.className = 'name';
    pubName.textContent = publisherDisplayName(ctx, canonical);
    pubName.title = `${pubName.textContent} (${group.journals.length})`;
    pubLi.appendChild(pubName);
    appendStatusSlot(doc, pubLi);
    appendCountBadge(doc, pubLi, publisherGroupCount(group.journals, state.journalCounts));

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'publisher-toggle';
    toggle.title = collapsed ? S('expand-publisher') : S('collapse-publisher');
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.appendChild(createChevronSvg(doc));
    const applyAccordion = (nextCollapsed: boolean) => {
      togglePublisherCollapsed(state, canonical, nextCollapsed, doc);
      if (!nextCollapsed) {
        setScope(state, { type: 'publisher', id: canonical });
        renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
        onSelectFeed();
        return;
      }
      renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
    };
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      applyAccordion(!collapsed);
    });
    pubLi.appendChild(toggle);

    // Zotero item-pane behavior: whole header toggles accordion
    pubLi.addEventListener('click', () => {
      applyAccordion(!collapsed);
    });
    cardList.appendChild(pubLi);

    const lastIdx = group.journals.length - 1;
    group.journals.forEach((journal, idx) => {
      const li = doc.createElement('li');
      li.className = 'journal-node';
      if (idx === lastIdx) li.classList.add('is-group-end');
      if (!collapsed && justExpanded === canonical) li.classList.add('is-just-expanded');
      li.hidden = collapsed;
      li.classList.toggle('is-folded', collapsed);
      const jStatus = state.journalStatus?.[journal.issn];
      if (jStatus?.state) {
        li.dataset.fetchState = jStatus.state;
        li.classList.toggle('is-loading', jStatus.state === 'loading');
        li.classList.toggle('has-error', jStatus.state === 'error');
      }
      li.classList.toggle('active', scope.type === 'issn' && scope.id === journal.issn);

      const name = doc.createElement('span');
      name.className = 'name';
      name.textContent = journal.title;
      name.title = journal.publisher
        ? `${journal.title} · ${journal.publisher} (${journal.issn})`
        : `${journal.title} (${journal.issn})`;
      li.appendChild(name);

      appendJournalStatus(doc, li, journal, jStatus, S, onRetryJournal);
      appendCountBadge(doc, li, typeof state.journalCounts[journal.issn] === 'number'
        ? state.journalCounts[journal.issn]
        : 0);

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', journal.title);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        state.journals = ctx.JournalFlow.unfollowJournal(journal.issn);
        if (state.journalStatus) delete state.journalStatus[journal.issn];
        if (scope.type === 'issn' && scope.id === journal.issn) {
          setScope(state, { type: 'all', id: null });
        }
        renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
        onSelectFeed();
      });
      li.appendChild(remove);

      li.addEventListener('click', () => {
        setScope(state, { type: 'issn', id: journal.issn });
        renderJournalListTree(doc, ctx, state, onSelectFeed, onRetryJournal);
        onSelectFeed();
      });
      cardList.appendChild(li);
    });

    groupItem.appendChild(cardList);
    list.appendChild(groupItem);
  }
}
