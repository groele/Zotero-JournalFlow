import { createSemaphore, runWithConcurrency } from '../utils/concurrency';
import { parseEuropePMCFallbackFigures, parseFallbackVisuals } from '../services/figureFallback';
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

const figureFetchGate = createSemaphore(4);
const sourceSigByArticle = new WeakMap<JournalArticle, string>();
const hostTimeouts = new Map<string, number>();

function visualSourceSignature(article: JournalArticle): string {
  return [article.pmcid || '', article.url || '', ...(article.fullTextLinks || [])].join('|');
}

function hostKeyOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
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
    { root, rootMargin: '1000px 0px' }
  );
}

function probeImageURL(
  url: string,
  timeout = 4500
): Promise<{ url: string; width: number; height: number; timedOut?: boolean } | null> {
  return new Promise((resolve) => {
    if (!isUsefulImageURL(url)) {
      resolve(null);
      return;
    }
    const host = hostKeyOf(url);
    if (host && (hostTimeouts.get(host) || 0) >= 3) {
      resolve(null);
      return;
    }
    const img = new Image();
    if ('referrerPolicy' in img) {
      img.referrerPolicy = 'no-referrer';
    }
    let settled = false;
    const finish = (result: { url: string; width: number; height: number; timedOut?: boolean } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (host) hostTimeouts.set(host, (hostTimeouts.get(host) || 0) + 1);
      finish({ url, width: 0, height: 0, timedOut: true });
    }, timeout);
    img.onload = () => {
      if (host) hostTimeouts.delete(host);
      finish({
        url,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function figureImageLooksUsable(image: { url: string; width: number; height: number } | null): boolean {
  if (!image) return false;
  if ((!image.width || !image.height) && /\.svg(?:[?#]|$)/i.test(image.url)) {
    return isUsefulImageURL(image.url);
  }
  if (!image.width || !image.height) return false;
  const maxEdge = Math.max(image.width, image.height);
  const minEdge = Math.min(image.width, image.height);
  return maxEdge >= 160 && minEdge >= 64 && image.width * image.height >= 14000;
}

async function validateFigure(figure: ArticleFigure): Promise<ArticleFigure | null> {
  const clean = cleanFigure(figure);
  if (!clean) return null;
  let bestLoad: { url: string; width: number; height: number } | null = null;
  const timedOutHosts = new Set<string>();
  for (const url of clean.urls.slice(0, 6)) {
    const host = hostKeyOf(url);
    if (host && timedOutHosts.has(host)) continue;
    const image = await probeImageURL(url);
    if (!image) continue;
    if (image.timedOut) {
      if (host) timedOutHosts.add(host);
      continue;
    }
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
      url: bestLoad.url,
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

async function validateFigures(figures: ArticleFigure[], limit = 10): Promise<ArticleFigure[]> {
  const candidates = dedupeFigures(figures).slice(0, Math.max(limit * 2, 24));
  const validated = new Array<ArticleFigure | null>(candidates.length).fill(null);
  await runWithConcurrency(
    candidates.map((fig, index) => ({ fig, index })),
    4,
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
      if (parsed.length < 2) {
        for (const fb of parseFallbackVisuals(page.text, baseURL)) {
          addFigure(figures, seen, fb);
        }
      }
      if (figures.length >= 6) break;
    } catch (e) {
      ctx.Zotero?.debug?.(`[JournalFlow] publisher visuals failed for ${url}: ${e}`);
    }
  }
  return figures;
}

function setImageWithFallback(doc: Document, parent: HTMLElement, figure: ArticleFigure): void {
  const img = doc.createElement('img');
  img.loading = 'lazy';
  if ('referrerPolicy' in img) {
    img.referrerPolicy = 'no-referrer';
  }
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

  await figureFetchGate.run(async () => {
    if (!card.isConnected) return;
    try {
      const currentSig = visualSourceSignature(article);
      if (article.figures !== null && article.figures.length === 0 && sourceSigByArticle.get(article) !== currentSig) {
        article.figures = null;
      }
      if (article.figures === null) {
        sourceSigByArticle.set(article, currentSig);
        let allFigures: ArticleFigure[] = [];
        if (article.pmcid) {
          try {
            const xml = await ctx.JournalFlow.fetchFullTextXML(article.pmcid);
            allFigures = parseEuropePMCFigures(xml, article.pmcid);
            if (allFigures.length < 2) {
              const fbSeen = createFigureSeen(allFigures);
              for (const fb of parseEuropePMCFallbackFigures(xml, article.pmcid)) {
                addFigure(allFigures, fbSeen, fb);
              }
            }
          } catch (e) {
            ctx.Zotero?.debug?.(`[JournalFlow] Europe PMC figures failed for ${article.pmcid}: ${e}`);
          }
        }
        if (
          allFigures.length < 4 &&
          (article.url || article.doi || article.fullTextLinks?.length)
        ) {
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
    article.figures = await validateFigures(article.figures || [], 10);
    if (!article.figures.length) {
      container.hidden = true;
      return;
    }

    for (const [index, figure] of article.figures.slice(0, 10).entries()) {
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
  });
}
