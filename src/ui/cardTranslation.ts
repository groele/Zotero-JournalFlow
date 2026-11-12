import type { JournalArticle } from '../types';
import { type FeedHostContext, type FeedUIState, getString, showNotice } from './feedState';

export function articleMatchesSearch(article: JournalArticle, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [
    article.title,
    article.abstract,
    article._tx?.zh?.title,
    article._tx?.zh?.abstract,
    article._tx?.en?.title,
    article._tx?.en?.abstract,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return haystack.includes(q);
}

export function setHighlightedText(
  doc: Document,
  el: Element,
  text: string,
  query: string
): void {
  el.replaceChildren();
  if (!query) {
    el.textContent = text || '';
    return;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'ig');
  for (const part of String(text || '').split(re)) {
    if (!part) continue;
    if (part.toLowerCase() === query.toLowerCase()) {
      const mark = doc.createElement('mark');
      mark.className = 'article-match';
      mark.textContent = part;
      el.appendChild(mark);
    } else {
      el.appendChild(doc.createTextNode(part));
    }
  }
}

export function updateBulkTranslateButton(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState
): void {
  const btn = doc.getElementById('translate-all-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const articles = state.articles.filter((a) => Boolean(a?.title));
  btn.disabled = state.bulkTranslationRunning || !articles.length;
  if (state.bulkTranslationRunning) return;
  const allShown = articles.length > 0 && articles.every((a) => a._showTranslated);
  btn.textContent = getString(ctx, allShown ? 'original-all' : 'translate-all');
}

export function updateArticleText(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  titleEl: Element,
  absEl: Element | null,
  btn: HTMLButtonElement
): void {
  const target = article._translationTarget;
  const translated = article._showTranslated && target ? article._tx?.[target] : undefined;
  setHighlightedText(doc, titleEl, translated ? translated.title : article.title, state.articleQuery);
  if (absEl) {
    setHighlightedText(
      doc,
      absEl,
      translated ? translated.abstract : article.abstract,
      state.articleQuery
    );
  }
  if (article._showTranslated) {
    btn.textContent = getString(ctx, 'original');
  } else {
    const nextTarget = ctx.JournalFlow.getTranslationTarget(article.title);
    btn.textContent = getString(ctx, nextTarget === 'zh' ? 'translate-to-zh' : 'translate-to-en');
  }
  btn.disabled = state.bulkTranslationRunning;
}

export async function ensureTranslation(
  ctx: FeedHostContext,
  article: JournalArticle
): Promise<void> {
  const target = ctx.JournalFlow.getTranslationTarget(article.title);
  if (!article._tx) article._tx = {};
  if (!article._tx[target]) {
    const cached = ctx.JournalFlow.getCachedTranslation?.(article, target);
    if (cached) {
      article._tx[target] = cached;
    } else {
      const [tt, ta] = await Promise.all([
        ctx.JournalFlow.translateText(article.title, target),
        article.abstract ? ctx.JournalFlow.translateText(article.abstract, target) : Promise.resolve(''),
      ]);
      const tx = { title: tt, abstract: ta };
      article._tx[target] = tx;
      void ctx.JournalFlow.cacheTranslation?.(article, target, tx)?.catch?.(() => {});
    }
  }
  article._translationTarget = target;
}

export async function toggleTranslate(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  titleEl: Element,
  absEl: Element | null,
  btn: HTMLButtonElement
): Promise<void> {
  if (article._showTranslated) {
    article._showTranslated = false;
    updateArticleText(doc, ctx, state, article, titleEl, absEl, btn);
    updateBulkTranslateButton(doc, ctx, state);
    return;
  }
  btn.disabled = true;
  btn.textContent = getString(ctx, 'translating');
  try {
    await ensureTranslation(ctx, article);
    article._showTranslated = true;
  } catch (e) {
    ctx.Zotero?.debug?.(`[JournalFlow] translate failed: ${e}`);
    showNotice(doc, state, getString(ctx, 'translate-failed'), 'warn');
  }
  updateArticleText(doc, ctx, state, article, titleEl, absEl, btn);
  btn.disabled = false;
  updateBulkTranslateButton(doc, ctx, state);
}

export async function toggleTranslateAll(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  rerender: () => void
): Promise<void> {
  const articles = state.articles.filter((a) => Boolean(a?.title));
  if (!articles.length || state.bulkTranslationRunning) return;

  if (articles.every((a) => a._showTranslated)) {
    for (const a of articles) a._showTranslated = false;
    rerender();
    return;
  }

  const btn = doc.getElementById('translate-all-btn') as HTMLButtonElement | null;
  let done = 0;
  let failed = 0;
  let next = 0;
  const total = articles.length;
  const concurrency = Math.min(3, total);
  state.bulkTranslationRunning = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = getString(ctx, 'translating-all')
      .replace('{done}', '0')
      .replace('{total}', String(total));
  }
  rerender();

  const worker = async () => {
    while (next < total) {
      const article = articles[next++];
      try {
        await ensureTranslation(ctx, article);
        article._showTranslated = true;
      } catch (e) {
        failed++;
        ctx.Zotero?.debug?.(`[JournalFlow] bulk translate failed: ${e}`);
      }
      done++;
      if (btn) {
        btn.textContent = getString(ctx, 'translating-all')
          .replace('{done}', String(done))
          .replace('{total}', String(total));
      }
      if (done === total || done % concurrency === 0) {
        rerender();
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    state.bulkTranslationRunning = false;
    rerender();
    if (failed) {
      showNotice(
        doc,
        state,
        getString(ctx, 'translate-all-failed').replace('{count}', String(failed)),
        'warn'
      );
    }
  }
}
