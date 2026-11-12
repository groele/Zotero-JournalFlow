import { normalizeDOI } from '../services/openalex';
import { canonicalizePublisher } from '../services/publisherNormalize';
import type { JournalArticle, JournalSubscription } from '../types';
import { createSemaphore } from '../utils/concurrency';
import { renderAbstractBlock, updateBatchBar } from './cardActions';
import { updateBulkTranslateButton } from './cardTranslation';
import { getCardBindings, renderArticles, renderSkeletonCards } from './cardsRender';
import { type FeedHostContext, type FeedUIState, clearNotice, getString } from './feedState';

export interface LoadFeedOptions {
  force?: boolean;
  soft?: boolean;
  onJournalStatus?: () => void;
}

function resolveFeedTargets(state: FeedUIState): JournalSubscription[] {
  const scope = state.activeScope;
  if (scope?.type === 'issn' && scope.id) {
    return state.journals.filter((j) => j.issn === scope.id);
  }
  if (scope?.type === 'publisher' && scope.id) {
    const key = canonicalizePublisher(scope.id);
    return state.journals.filter((j) => canonicalizePublisher(j.publisher) === key);
  }
  if (scope?.type === 'all') return state.journals;
  return state.activeISSN ? state.journals.filter((j) => j.issn === state.activeISSN) : state.journals;
}

function loadingProgressText(ctx: FeedHostContext, done: number, total: number, soft: boolean): string {
  const key = soft ? 'soft-refreshing' : 'loading-progress';
  const tpl = getString(ctx, key);
  if (tpl !== key && tpl.includes('{')) {
    return tpl.replace('{done}', String(done)).replace('{total}', String(total));
  }
  return `${getString(ctx, 'loading')} (${done}/${total})`;
}

async function annotateLibraryDOIs(
  ctx: FeedHostContext,
  articles: JournalArticle[]
): Promise<void> {
  if (typeof ctx.JournalFlow.getExistingLibraryDOIs !== 'function' || !articles.length) return;
  try {
    const existing = await ctx.JournalFlow.getExistingLibraryDOIs(articles.map((a) => a.doi));
    for (const a of articles) {
      const key = normalizeDOI(a.doi);
      if (key && existing[key]) a._libraryItemID = existing[key];
    }
  } catch {}
}

function patchAbstractCard(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  article: JournalArticle,
  removeRetry?: boolean
): void {
  const binding = getCardBindings(state)?.get(article);
  if (!binding) return;
  binding.refs.abstractEl = renderAbstractBlock(
    doc,
    ctx,
    state,
    article,
    binding.refs.abstractWrap,
    binding.refs.titleEl,
    binding.translateBtn
  );
  if (removeRetry) binding.retryBtn?.remove();
}

function patchMetadataCard(doc: Document, ctx: FeedHostContext, state: FeedUIState, article: JournalArticle): void {
  const binding = getCardBindings(state)?.get(article);
  if (!binding) return;
  if (article.figures !== null && article.figures.length === 0 && (article.pmcid || article.fullTextLinks?.length)) {
    article.figures = null;
  }
  if (article.isOpenAccess && !binding.refs.metaEl.querySelector('.badge-oa')) {
    const badge = doc.createElement('span');
    badge.className = 'badge-oa';
    badge.textContent = getString(ctx, 'oa');
    binding.refs.metaEl.appendChild(badge);
  }
  if (article.abstract && !binding.refs.abstractEl) patchAbstractCard(doc, ctx, state, article);
}

function runBackgroundEnrichment(doc: Document, ctx: FeedHostContext, state: FeedUIState, gen: number): void {
  const kickAbstracts = () => {
    if (typeof ctx.JournalFlow.enrichFeedAbstracts !== 'function') return;
    if (!state.articles.some((a) => !a.abstract)) return;
    void ctx.JournalFlow.enrichFeedAbstracts(state.articles, (recovered) => {
      if (gen !== state.loadGeneration) return;
      patchAbstractCard(doc, ctx, state, recovered, true);
    }).catch(() => {});
  };
  if (typeof ctx.JournalFlow.enrichFeedMetadata !== 'function') {
    kickAbstracts();
    return;
  }
  void ctx.JournalFlow
    .enrichFeedMetadata(state.articles, (updated) => {
      if (gen !== state.loadGeneration) return;
      patchMetadataCard(doc, ctx, state, updated);
    })
    .then(() => {
      if (gen === state.loadGeneration) renderArticles(doc, ctx, state);
      kickAbstracts();
    })
    .catch(() => kickAbstracts());
}

export async function loadFeed(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  forceOrOpts: boolean | LoadFeedOptions = false
): Promise<void> {
  const opts: LoadFeedOptions =
    typeof forceOrOpts === 'boolean' ? { force: forceOrOpts } : forceOrOpts;
  const force = Boolean(opts.force);
  const onJournalStatus = opts.onJournalStatus;
  const cards = doc.getElementById('cards');
  const status = doc.getElementById('status');
  if (!cards || !status) return;

  const gen = ++state.loadGeneration;
  state.visibleLimit = 40;
  clearNotice(doc, state);

  if (!state.journals.length) {
    cards.classList.remove('is-soft-refreshing');
    cards.replaceChildren();
    state.articles = [];
    state.isRefreshing = false;
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = getString(ctx, 'no-journals');
    cards.appendChild(empty);
    updateBulkTranslateButton(doc, ctx, state);
    updateBatchBar(doc, ctx, state);
    return;
  }

  const targets = resolveFeedTargets(state);
  if (!targets.length) {
    cards.classList.remove('is-soft-refreshing');
    cards.replaceChildren();
    state.articles = [];
    state.isRefreshing = false;
    renderArticles(doc, ctx, state);
    return;
  }

  const useSoftRefresh = Boolean(opts.soft && state.articles.length > 0);
  state.isRefreshing = true;
  for (const journal of targets) {
    state.journalStatus[journal.issn] = { state: 'loading', updatedAt: Date.now() };
  }
  onJournalStatus?.();

  if (useSoftRefresh) {
    cards.classList.add('is-soft-refreshing');
  } else {
    cards.classList.remove('is-soft-refreshing');
    state.articles = [];
    renderSkeletonCards(doc, cards, Math.min(4, Math.max(2, targets.length)));
  }

  let failures = 0;
  let done = 0;
  const total = targets.length;
  let sawResult = false;
  let lastRender = 0;
  let renderTimer: number | null = null;
  const gate = createSemaphore(4);
  const win = doc.defaultView || globalThis;
  const stagedArticles: JournalArticle[] = [];

  const syncInto = (list: JournalArticle[]): JournalArticle[] => {
    list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return ctx.JournalFlow.dedupeArticles(list);
  };

  const flushRender = (immediate: boolean): void => {
    if (useSoftRefresh || gen !== state.loadGeneration) return;
    const now = Date.now();
    const paint = () => {
      renderTimer = null;
      lastRender = Date.now();
      state.articles = syncInto(state.articles);
      renderArticles(doc, ctx, state);
    };
    if (immediate || now - lastRender >= 120 || done >= total) {
      if (renderTimer !== null) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      paint();
    } else if (renderTimer === null) {
      renderTimer = win.setTimeout(paint, Math.max(0, 120 - (now - lastRender))) as unknown as number;
    }
  };

  const setProgressStatus = (): void => {
    status.hidden = false;
    status.classList.remove('error');
    status.textContent = loadingProgressText(ctx, done, total, useSoftRefresh);
  };
  setProgressStatus();

  await Promise.all(
    targets.map((journal) =>
      gate.run(async () => {
        try {
          const batch = await ctx.JournalFlow.getFeed(journal.issn, { force });
          if (gen !== state.loadGeneration) return;
          state.journalCounts[journal.issn] = batch.length;
          state.journalStatus[journal.issn] = {
            state: 'ok',
            count: batch.length,
            updatedAt: Date.now(),
          };
          if (useSoftRefresh) {
            stagedArticles.push(...batch);
          } else {
            if (!sawResult) {
              sawResult = true;
              cards.replaceChildren();
              state.articles = [];
              state.articles.push(...batch);
              flushRender(true);
            } else {
              state.articles.push(...batch);
              flushRender(false);
            }
          }
        } catch (reason) {
          failures++;
          if (gen === state.loadGeneration) {
            state.journalStatus[journal.issn] = {
              state: 'error',
              error: String((reason as Error)?.message || reason || ''),
              updatedAt: Date.now(),
            };
          }
          ctx.Zotero?.debug?.(`[JournalFlow] feed failed (${journal.issn}): ${reason}`);
        } finally {
          done++;
          if (gen === state.loadGeneration) {
            setProgressStatus();
            onJournalStatus?.();
            if (!useSoftRefresh && (sawResult || done >= total)) {
              flushRender(done >= total);
            }
          }
        }
      })
    )
  );

  if (renderTimer !== null) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }

  if (gen !== state.loadGeneration) {
    cards.classList.remove('is-soft-refreshing');
    return;
  }

  state.isRefreshing = false;
  cards.classList.remove('is-soft-refreshing');

  if (useSoftRefresh) {
    if (stagedArticles.length > 0 || failures < total) {
      state.articles = syncInto(stagedArticles);
    }
  } else {
    state.articles = syncInto(state.articles);
  }

  await annotateLibraryDOIs(ctx, state.articles);
  if (gen !== state.loadGeneration) return;

  if (failures) {
    status.hidden = false;
    status.classList.add('error');
    status.textContent = getString(ctx, 'loading-failed');
  } else {
    status.hidden = true;
  }

  onJournalStatus?.();
  renderArticles(doc, ctx, state);
  runBackgroundEnrichment(doc, ctx, state, gen);
}

export async function retryJournalFeed(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  issn: string,
  onJournalStatus?: () => void
): Promise<void> {
  const journal = state.journals.find((j) => j.issn === issn);
  if (!journal) return;
  const gen = state.loadGeneration;
  state.journalStatus[issn] = { state: 'loading', updatedAt: Date.now() };
  onJournalStatus?.();

  try {
    const batch = await ctx.JournalFlow.getFeed(issn, { force: true });
    if (gen !== state.loadGeneration) return;
    state.journalCounts[issn] = batch.length;
    state.journalStatus[issn] = { state: 'ok', count: batch.length, updatedAt: Date.now() };
    const inActiveScope = resolveFeedTargets(state).some((t) => t.issn === issn);
    if (inActiveScope) {
      await annotateLibraryDOIs(ctx, batch);
      if (gen !== state.loadGeneration) return;
      const merged = [...state.articles.filter((a) => a.issn !== issn), ...batch];
      merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      state.articles = ctx.JournalFlow.dedupeArticles(merged);
      renderArticles(doc, ctx, state);
    }
  } catch (reason) {
    if (gen === state.loadGeneration) {
      state.journalStatus[issn] = {
        state: 'error',
        error: String((reason as Error)?.message || reason || ''),
        updatedAt: Date.now(),
      };
    }
    ctx.Zotero?.debug?.(`[JournalFlow] retry failed (${issn}): ${reason}`);
  } finally {
    onJournalStatus?.();
  }
}
