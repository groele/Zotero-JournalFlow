import { runWithConcurrency } from '../utils/concurrency';
import { parseEuropePMCFigures, parsePublisherVisuals } from '../services/figureParser';
import {
  addFigure,
  cleanFigure,
  createFigureSeen,
  dedupeFigures,
  isUsefulImageURL,
} from '../services/figures';
import { uniqueURLs } from '../services/http';
import type { ArticleFigure, JournalArticle } from '../types';
import { type FeedHostContext, type FeedUIState, getString } from './feedState';

export interface CardElement extends HTMLDivElement {
  _article?: JournalArticle;
  _figuresEl?: HTMLDivElement;
  _figuresRequested?: boolean;
}

export function resetFigureObserver(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  onOpenLightbox: (figures: ArticleFigure[], index: number) => void
): void {
  if (state.figureObserver) {
    state.figureObserver.disconnect();
  }
  if (typeof IntersectionObserver === 'undefined') {
    state.figureObserver = null;
    return;
  }
  const root = doc.getElementById('content');
  state.figureObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          state.figureObserver?.unobserve(entry.target);
          void loadFiguresForCard(doc, ctx, entry.target as CardElement, onOpenLightbox);
        }
      }
    },
    { root, rootMargin: '300px' }
  );
}

function probeImageURL(
  url: string,
  timeout = 4500
): Promise<{ url: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!isUsefulImageURL(url)) {
      resolve(null);
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (result: { url: string; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeout);
    img.onload = () =>
      finish({
        url,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function figureImageLooksUsable(image: { width: number; height: number } | null): boolean {
  if (!image || !image.width || !image.height) return false;
  const maxEdge = Math.max(image.width, image.height);
  const minEdge = Math.min(image.width, image.height);
  return maxEdge >= 320 && minEdge >= 110 && image.width * image.height >= 40000;
}

async function validateFigure(figure: ArticleFigure): Promise<ArticleFigure | null> {
  const clean = cleanFigure(figure);
  if (!clean) return null;
  let bestLoad: { url: string; width: number; height: number } | null = null;
  for (const url of clean.urls) {
    const image = await probeImageURL(url);
    if (!image) continue;
    bestLoad = bestLoad || image;
    if (figureImageLooksUsable(image)) {
      return {
        ...clean,
        urls: uniqueURLs([image.url, ...clean.urls.filter((u) => u !== image.url)]),
        width: image.width,
        height: image.height,
      };
    }
  }
  if (
    bestLoad &&
    figureImageLooksUsable({
      width: Math.max(bestLoad.width, clean.width || 0),
      height: Math.max(bestLoad.height, clean.height || 0),
    })
  ) {
    return {
      ...clean,
      urls: uniqueURLs([bestLoad.url, ...clean.urls.filter((u) => u !== bestLoad.url)]),
      width: bestLoad.width,
      height: bestLoad.height,
    };
  }
  return null;
}

async function validateFigures(figures: ArticleFigure[], limit = 8): Promise<ArticleFigure[]> {
  const candidates = dedupeFigures(figures).slice(0, Math.max(limit * 2, 16));
  const validated = new Array<ArticleFigure | null>(candidates.length).fill(null);
  await runWithConcurrency(
    candidates.map((fig, index) => ({ fig, index })),
    3,
    async ({ fig, index }) => {
      validated[index] = await validateFigure(fig);
    }
  );
  const out: ArticleFigure[] = [];
  const seen = createFigureSeen();
  for (const item of validated) {
    if (!item) continue;
    addFigure(out, seen, item);
    if (out.length >= limit) break;
  }
  return dedupeFigures(out).slice(0, limit);
}

async function fetchPublisherVisuals(ctx: FeedHostContext, article: JournalArticle): Promise<ArticleFigure[]> {
  const figures: ArticleFigure[] = [];
  const seen = createFigureSeen();
  const pages = await ctx.JournalFlow.getVisualSourcePages(article);
  for (const url of pages) {
    try {
      const page = await ctx.JournalFlow.fetchArticleHTML(url);
      const baseURL = page.url || url;
      const parsed = parsePublisherVisuals(page.text, baseURL);
      for (const fig of parsed) {
        addFigure(figures, seen, fig);
      }
      if (figures.length >= 24) break;
    } catch (e) {
      ctx.Zotero?.debug?.(`[JournalFlow] publisher visuals failed for ${url}: ${e}`);
    }
  }
  return figures;
}

function setImageWithFallback(doc: Document, parent: HTMLElement, figure: ArticleFigure): void {
  const img = doc.createElement('img');
  img.loading = 'lazy';
  img.alt = figure.label || '';
  let idx = 0;
  img.addEventListener('error', () => {
    idx++;
    if (idx < figure.urls.length) {
      img.src = figure.urls[idx];
    } else {
      parent.remove();
    }
  });
  img.src = figure.urls[0];
  parent.appendChild(img);
}

export async function loadFiguresForCard(
  doc: Document,
  ctx: FeedHostContext,
  card: CardElement,
  onOpenLightbox: (figures: ArticleFigure[], index: number) => void
): Promise<void> {
  if (card._figuresRequested) return;
  card._figuresRequested = true;
  const article = card._article;
  const container = card._figuresEl;
  if (!article || !container) return;

  container.hidden = false;
  const loading = doc.createElement('span');
  loading.className = 'figures-loading';
  loading.textContent = getString(ctx, 'figures-loading');
  container.appendChild(loading);

  try {
    if (article.figures === null) {
      let allFigures: ArticleFigure[] = [];
      if (article.pmcid) {
        try {
          const xml = await ctx.JournalFlow.fetchFullTextXML(article.pmcid);
          allFigures = parseEuropePMCFigures(xml, article.pmcid);
        } catch (e) {
          ctx.Zotero?.debug?.(`[JournalFlow] Europe PMC figures failed for ${article.pmcid}: ${e}`);
        }
      }
      if (article.url || article.doi || article.fullTextLinks?.length) {
        const fallback = await fetchPublisherVisuals(ctx, article);
        const seen = createFigureSeen(allFigures);
        for (const fig of fallback) {
          addFigure(allFigures, seen, fig);
        }
      }
      const combined: ArticleFigure[] = [];
      const seen = createFigureSeen();
      for (const fig of allFigures) {
        addFigure(combined, seen, fig);
      }
      article.figures = combined;
      article.graphicalAbstract = null;
    }
  } catch (e) {
    ctx.Zotero?.debug?.(`[JournalFlow] figures failed for ${article.doi || article.url}: ${e}`);
    article.figures = [];
  }

  container.replaceChildren();
  article.figures = await validateFigures(article.figures || [], 8);
  if (!article.figures.length) {
    container.hidden = true;
    return;
  }

  for (const [index, figure] of article.figures.slice(0, 8).entries()) {
    const item = doc.createElement('div');
    item.className = 'figure-item';
    setImageWithFallback(doc, item, figure);
    const label = doc.createElement('span');
    label.className = 'fig-label';
    label.textContent = figure.label || '';
    label.title = figure.caption;
    item.appendChild(label);
    item.addEventListener('click', () => onOpenLightbox(article.figures || [], index));
    container.appendChild(item);
  }
}
