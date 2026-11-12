import { articleStateKey } from '../services/readingState';
import type { JournalArticle } from '../types';
import { ensureTranslation, toggleTranslate, updateArticleText } from './cardTranslation';
import { copyPlainText, formatArticleBibTeX } from './citation';
import { type FeedHostContext, type FeedUIState, getString, populateCollectionSelector, showNotice } from './feedState';
import type { CardElement } from './figureStrip';

export interface CardActionRefs {
  card: CardElement;
  body: HTMLDivElement;
  titleEl: HTMLHeadingElement;
  metaEl: HTMLDivElement;
  abstractWrap: HTMLDivElement;
  abstractEl: HTMLParagraphElement | null;
  rerender: () => void;
}

export function articleSelectionKey(article: JournalArticle): string {
  return articleStateKey(article.doi, article.title) || article.url || article.title;
}

export function updateBatchBar(doc: Document, ctx: FeedHostContext, state: FeedUIState): void {
  const bar = doc.getElementById('batch-import-bar');
  const btn = doc.getElementById('batch-import-btn') as HTMLButtonElement | null;
  const selectAllBtn = doc.getElementById('select-all-btn') as HTMLButtonElement | null;
  if (!bar || !btn) return;
  const count = state.selectedKeys.size;
  bar.hidden = !state.articles.length;
  bar.classList.toggle('has-selection', count > 0);
  btn.disabled = count === 0;
  btn.textContent = getString(ctx, 'batch-add').replace('{count}', String(count));
  if (selectAllBtn) {
    selectAllBtn.textContent = getString(ctx, count > 0 ? 'clear-selection' : 'select-all-visible');
  }
}

export async function runBatchImport(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  rerender: () => void
): Promise<void> {
  const btn = doc.getElementById('batch-import-btn') as HTMLButtonElement | null;
  const targets = state.articles.filter((a) => state.selectedKeys.has(articleSelectionKey(a)));
  if (!targets.length) return;
  if (btn) btn.disabled = true;

  let done = 0;
  for (const article of targets) {
    try {
      await importSingleArticle(ctx, state, article);
      done++;
      state.selectedKeys.delete(articleSelectionKey(article));
    } catch (e) {
      ctx.Zotero?.debug?.(`[JournalFlow] batch import failed: ${e}`);
    }
  }
  rerender();
  populateCollectionSelector(doc, ctx, state, true);
  updateBatchBar(doc, ctx, state);
  showNotice(
    doc,
    state,
    getString(ctx, 'batch-done').replace('{done}', String(done)).replace('{total}', String(targets.length)),
    done === targets.length ? 'warn' : 'error'
  );
}

export async function importSingleArticle(
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle
): Promise<void> {
  if (typeof ctx.JournalFlow.importArticleToZotero === 'function') {
    const res = await ctx.JournalFlow.importArticleToZotero(article, {
      collectionID: state.targetCollectionID,
    });
    if (res?.itemID) article._libraryItemID = res.itemID;
  } else {
    await ctx.JournalFlow.addToZoteroByDOI(article.doi);
    article._libraryItemID = -1;
  }
}

export function renderAbstractBlock(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  abstractWrap: HTMLDivElement,
  titleEl: HTMLHeadingElement,
  translateBtn: HTMLButtonElement
): HTMLParagraphElement | null {
  abstractWrap.replaceChildren();
  if (!article.abstract) {
    updateArticleText(doc, ctx, state, article, titleEl, null, translateBtn);
    return null;
  }
  const abstractEl = doc.createElement('p');
  abstractEl.className = 'card-abstract clamped';
  abstractWrap.appendChild(abstractEl);

  const S = (id: string) => getString(ctx, id);
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'abstract-toggle';
  toggle.textContent = S('show-more');
  toggle.addEventListener('click', () => {
    const clamped = abstractEl.classList.toggle('clamped');
    toggle.textContent = S(clamped ? 'show-more' : 'show-less');
  });
  abstractWrap.appendChild(toggle);

  if (article.abstractSource) {
    const src = doc.createElement('span');
    src.className = 'badge-src';
    src.textContent = S('abstract-from').replace('{source}', article.abstractSource);
    abstractWrap.appendChild(src);
  }

  updateArticleText(doc, ctx, state, article, titleEl, abstractEl, translateBtn);
  return abstractEl;
}

export function buildCardActions(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  refs: CardActionRefs
): { translateBtn: HTMLButtonElement; retryBtn: HTMLButtonElement | null } {
  const S = (id: string) => getString(ctx, id);
  const actions = doc.createElement('div');
  actions.className = 'card-actions';

  const markRead = (value: boolean) => {
    article._read = value;
    refs.card.classList.toggle('is-read', value);
    readBtn.textContent = S(value ? 'read' : 'mark-read');
    void ctx.JournalFlow.setArticleRead?.(article, value)?.catch?.(() => {});
  };

  const addBtn = doc.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'primary';
  const syncAddLabel = () => {
    if (article._libraryItemID && article._libraryItemID > 0) {
      addBtn.textContent = S('in-zotero');
      addBtn.title = S('locate');
      addBtn.classList.add('in-library');
    } else if (article._libraryItemID === -1) {
      addBtn.textContent = S('added');
      addBtn.disabled = true;
    } else {
      addBtn.textContent = S('add');
    }
  };
  syncAddLabel();

  addBtn.addEventListener('click', async () => {
    if (article._libraryItemID && article._libraryItemID > 0) {
      ctx.JournalFlow.selectLibraryItem?.(article._libraryItemID);
      return;
    }
    addBtn.disabled = true;
    try {
      await importSingleArticle(ctx, state, article);
      populateCollectionSelector(doc, ctx, state, true);
      addBtn.disabled = false;
      syncAddLabel();
      if (!article._libraryItemID || article._libraryItemID < 0) {
        addBtn.textContent = S('added');
        addBtn.disabled = true;
      }
    } catch (e) {
      ctx.Zotero?.debug?.(`[JournalFlow] add failed: ${e}`);
      addBtn.disabled = false;
      showNotice(doc, state, S('add-failed'), 'error');
    }
  });
  actions.appendChild(addBtn);

  const openBtn = doc.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = S('open-page');
  openBtn.addEventListener('click', () => {
    markRead(true);
    ctx.JournalFlow.openURL(article.url);
  });
  actions.appendChild(openBtn);

  const translateBtn = doc.createElement('button');
  translateBtn.type = 'button';
  updateArticleText(doc, ctx, state, article, refs.titleEl, refs.abstractEl, translateBtn);
  translateBtn.addEventListener('click', () => {
    void toggleTranslate(doc, ctx, state, article, refs.titleEl, refs.abstractEl, translateBtn);
  });
  actions.appendChild(translateBtn);

  let retryBtn: HTMLButtonElement | null = null;
  if (!article.abstract && (article.doi || article.url) && typeof ctx.JournalFlow.enrichSingleArticle === 'function') {
    retryBtn = doc.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = S('retry-abstract');
    retryBtn.addEventListener('click', async () => {
      retryBtn!.disabled = true;
      retryBtn!.textContent = S('fetching-abstract');
      try {
        const ok = await ctx.JournalFlow.enrichSingleArticle(article);
        if (ok && article.abstract) {
          refs.abstractEl = renderAbstractBlock(doc, ctx, state, article, refs.abstractWrap, refs.titleEl, translateBtn);
          if (article._showTranslated) {
            await ensureTranslation(ctx, article);
            updateArticleText(doc, ctx, state, article, refs.titleEl, refs.abstractEl, translateBtn);
          }
          retryBtn!.remove();
          return;
        }
        showNotice(doc, state, S('retry-abstract-none'), 'warn');
      } finally {
        if (retryBtn?.isConnected) {
          retryBtn.disabled = false;
          retryBtn.textContent = S('retry-abstract');
        }
      }
    });
    actions.appendChild(retryBtn);
  }

  const bibBtn = doc.createElement('button');
  bibBtn.type = 'button';
  bibBtn.textContent = S('copy-bibtex');
  bibBtn.addEventListener('click', async () => {
    const copied = await copyPlainText(formatArticleBibTeX(article), doc);
    if (copied) {
      bibBtn.textContent = S('copied-bibtex');
      (doc.defaultView || globalThis).setTimeout(() => {
        bibBtn.textContent = S('copy-bibtex');
      }, 1500);
    }
  });
  actions.appendChild(bibBtn);

  const starBtn = doc.createElement('button');
  starBtn.type = 'button';
  starBtn.className = article._starred ? 'star-btn starred' : 'star-btn';
  starBtn.textContent = S(article._starred ? 'starred' : 'star');
  starBtn.addEventListener('click', async () => {
    const next = typeof ctx.JournalFlow.toggleArticleStarred === 'function'
      ? await ctx.JournalFlow.toggleArticleStarred(article)
      : !article._starred;
    article._starred = next;
    starBtn.classList.toggle('starred', next);
    starBtn.textContent = S(next ? 'starred' : 'star');
    if (state.filterMode === 'starred' && !next) refs.rerender();
  });
  actions.appendChild(starBtn);

  const readBtn = doc.createElement('button');
  readBtn.type = 'button';
  readBtn.textContent = S(article._read ? 'read' : 'mark-read');
  readBtn.addEventListener('click', () => {
    const next = !article._read;
    markRead(next);
    if (state.filterMode === 'unread' && next) refs.rerender();
  });
  actions.appendChild(readBtn);

  refs.body.appendChild(actions);
  return { translateBtn, retryBtn };
}
