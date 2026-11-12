import type { ArticleFilterMode, JournalArticle } from '../types';
import {
  type CardActionRefs,
  articleSelectionKey,
  buildCardActions,
  renderAbstractBlock,
  updateBatchBar,
} from './cardActions';
import { articleMatchesSearch, updateBulkTranslateButton } from './cardTranslation';
import { type FeedHostContext, type FeedUIState, getString, populateCollectionSelector } from './feedState';
import { type CardElement, loadFiguresForCard, resetFigureObserver } from './figureStrip';
import { openLightbox } from './lightbox';

export interface CardDomBinding {
  article: JournalArticle;
  refs: CardActionRefs;
  translateBtn: HTMLButtonElement;
  retryBtn: HTMLButtonElement | null;
}

const cardBindings = new WeakMap<FeedUIState, Map<JournalArticle, CardDomBinding>>();

export function getCardBindings(state: FeedUIState): Map<JournalArticle, CardDomBinding> | undefined {
  return cardBindings.get(state);
}

function articleMatchesFilter(article: JournalArticle, mode: ArticleFilterMode): boolean {
  switch (mode) {
    case 'oa':
      return Boolean(article.isOpenAccess);
    case 'abstract':
      return Boolean(article.abstract);
    case 'figures':
      return Boolean(article.figures?.length);
    case 'unread':
      return !article._read;
    case 'starred':
      return Boolean(article._starred);
    default:
      return true;
  }
}

function buildCard(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  bindings: Map<JournalArticle, CardDomBinding>
): CardElement {
  const card = doc.createElement('div') as CardElement;
  const selKey = articleSelectionKey(article);
  const selected = state.selectedKeys.has(selKey);
  card.className = ['card', article._read ? 'is-read' : '', selected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ');
  const body = doc.createElement('div');
  body.className = 'card-body';
  card.appendChild(body);

  const S = (id: string) => getString(ctx, id);
  const headerRow = doc.createElement('div');
  headerRow.className = 'card-header-row';

  const check = doc.createElement('input');
  check.type = 'checkbox';
  check.className = 'card-select';
  check.title = S('select-article');
  check.checked = selected;
  check.addEventListener('change', () => {
    if (check.checked) state.selectedKeys.add(selKey);
    else state.selectedKeys.delete(selKey);
    card.classList.toggle('is-selected', check.checked);
    updateBatchBar(doc, ctx, state);
  });
  headerRow.appendChild(check);

  const titleEl = doc.createElement('h3');
  titleEl.className = 'card-title';
  titleEl.addEventListener('click', () => {
    article._read = true;
    card.classList.add('is-read');
    void ctx.JournalFlow.setArticleRead?.(article, true)?.catch?.(() => {});
    ctx.JournalFlow.openURL(article.url);
  });
  headerRow.appendChild(titleEl);
  body.appendChild(headerRow);

  if (article.authors) {
    const authors = doc.createElement('div');
    authors.className = 'card-meta card-authors';
    authors.textContent = article.authors;
    authors.title = article.authors;
    body.appendChild(authors);
  }

  const metaEl = doc.createElement('div');
  metaEl.className = 'card-meta';
  const journalSpan = doc.createElement('span');
  journalSpan.className = 'journal';
  journalSpan.textContent = article.journal;
  metaEl.appendChild(journalSpan);
  const rest = [article.date, article.volume ? `Vol. ${article.volume}` : '', article.issue ? `No. ${article.issue}` : '']
    .filter(Boolean)
    .join(' · ');
  if (rest) metaEl.appendChild(doc.createTextNode(` · ${rest}`));
  if (article.isOpenAccess) {
    const badge = doc.createElement('span');
    badge.className = 'badge-oa';
    badge.textContent = S('oa');
    metaEl.appendChild(badge);
  }
  body.appendChild(metaEl);

  const abstractWrap = doc.createElement('div');
  body.appendChild(abstractWrap);

  if (ctx.JournalFlow.getPref('loadFigures') && (article.pmcid || article.url || article.doi || article.fullTextLinks?.length)) {
    const figures = doc.createElement('div');
    figures.className = 'figures';
    figures.hidden = true;
    body.appendChild(figures);
    card._article = article;
    card._figuresEl = figures;
    state.figureObserver?.observe(card);
  }

  const refs: CardActionRefs = {
    card,
    body,
    titleEl,
    metaEl,
    abstractWrap,
    abstractEl: null,
    rerender: () => renderArticles(doc, ctx, state),
  };
  const { translateBtn, retryBtn } = buildCardActions(doc, ctx, state, article, refs);
  refs.abstractEl = renderAbstractBlock(doc, ctx, state, article, abstractWrap, titleEl, translateBtn);
  bindings.set(article, { article, refs, translateBtn, retryBtn });
  return card;
}

export function renderSkeletonCards(doc: Document, container: HTMLElement, count = 4): void {
  container.replaceChildren();
  const safeCount = Math.max(1, Math.min(8, count));
  for (let i = 0; i < safeCount; i++) {
    const card = doc.createElement('div');
    card.className = 'card card-skeleton';
    card.setAttribute('aria-hidden', 'true');

    const title = doc.createElement('div');
    title.className = 'skel-line skel-title';
    const meta = doc.createElement('div');
    meta.className = 'skel-line skel-meta';
    const abs1 = doc.createElement('div');
    abs1.className = 'skel-line skel-abstract';
    const abs2 = doc.createElement('div');
    abs2.className = 'skel-line skel-abstract short';
    const actions = doc.createElement('div');
    actions.className = 'skel-actions';
    for (let b = 0; b < 3; b++) {
      const btn = doc.createElement('div');
      btn.className = 'skel-btn';
      actions.appendChild(btn);
    }

    card.append(title, meta, abs1, abs2, actions);
    container.appendChild(card);
  }
}

export function refreshFilterPills(doc: Document, state: FeedUIState): void {
  for (const btn of Array.from(doc.querySelectorAll('#filter-pills button[data-filter]'))) {
    const el = btn as HTMLElement;
    const active = el.dataset.filter === state.filterMode;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

export function renderArticles(doc: Document, ctx: FeedHostContext, state: FeedUIState): void {
  const cards = doc.getElementById('cards');
  const countEl = doc.getElementById('article-search-count');
  if (!cards) return;
  cards.classList.remove('is-soft-refreshing');
  cards.replaceChildren();
  if (state.primeTimer !== null) {
    clearTimeout(state.primeTimer);
    state.primeTimer = null;
  }

  const filtered = state.articles.filter(
    (a) => articleMatchesFilter(a, state.filterMode) && articleMatchesSearch(a, state.articleQuery)
  );
  if (countEl) {
    const showCount = Boolean(state.articleQuery || state.filterMode !== 'all');
    countEl.textContent = showCount ? `${filtered.length} / ${state.articles.length}` : `${state.articles.length}`;
  }
  refreshFilterPills(doc, state);
  updateBulkTranslateButton(doc, ctx, state);
  updateBatchBar(doc, ctx, state);
  populateCollectionSelector(doc, ctx, state);

  if (!state.articles.length) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = getString(ctx, 'no-articles');
    cards.appendChild(empty);
    return;
  }
  if (!filtered.length) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = getString(ctx, 'no-matches');
    cards.appendChild(empty);
    return;
  }

  resetFigureObserver(doc, ctx, state, (figs, idx) => openLightbox(doc, state, figs, idx));
  const bindings = new Map<JournalArticle, CardDomBinding>();
  cardBindings.set(state, bindings);

  const visibleSlice = filtered.slice(0, state.visibleLimit);
  const figCards: CardElement[] = [];
  for (const article of visibleSlice) {
    const card = buildCard(doc, ctx, state, article, bindings);
    cards.appendChild(card);
    if (card._figuresEl) figCards.push(card);
  }

  if (filtered.length > visibleSlice.length) {
    const wrap = doc.createElement('div');
    wrap.className = 'load-more-wrap';
    const moreBtn = doc.createElement('button');
    moreBtn.type = 'button';
    moreBtn.textContent = getString(ctx, 'load-more').replace(
      '{remaining}',
      String(filtered.length - visibleSlice.length)
    );
    moreBtn.addEventListener('click', () => {
      state.visibleLimit += 40;
      renderArticles(doc, ctx, state);
    });
    wrap.appendChild(moreBtn);
    cards.appendChild(wrap);
  }

  const win = doc.defaultView || globalThis;
  const openLightboxFor = (figs: import('../types').ArticleFigure[], idx: number) =>
    openLightbox(doc, state, figs, idx);
  let cursor = 0;
  const pumpFigures = (batchSize: number, delayMs: number) => {
    state.primeTimer = win.setTimeout(() => {
      state.primeTimer = null;
      let launched = 0;
      while (cursor < figCards.length && launched < batchSize) {
        const card = figCards[cursor++];
        if (!card.isConnected || card._figuresRequested) continue;
        launched++;
        void loadFiguresForCard(doc, ctx, card, openLightboxFor);
      }
      if (cursor < figCards.length) {
        pumpFigures(4, 180);
      }
    }, delayMs) as unknown as number;
  };
  if (figCards.length) {
    pumpFigures(12, 60);
  }
}
