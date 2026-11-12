import type { ArticleFigure } from '../types';
import { cleanText, isPreviewFigure } from './figureLabels';
import {
  addFigure,
  createFigureSeen,
  expandHighResURLs,
  figureImageURLs,
  imageURLsFromSrcset,
  isUsefulImageURL,
} from './figures';
import { resolveURL, uniqueURLs } from './http';

export function parseEuropePMCFigures(
  xmlText: string,
  pmcid: string,
  parser = new DOMParser()
): ArticleFigure[] {
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const figures: ArticleFigure[] = [];
  for (const fig of Array.from(doc.querySelectorAll('fig'))) {
    const type = (fig.getAttribute('fig-type') || '').toLowerCase();
    const labelText = fig.querySelector('label')?.textContent || '';
    const captionText = fig.querySelector('caption')?.textContent || '';
    if (isPreviewFigure([type, labelText, captionText].join(' '))) continue;
    const graphic = fig.querySelector('graphic, media');
    const href =
      graphic?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      graphic?.getAttribute('xlink:href') ||
      graphic?.getAttribute('href');
    if (!href) continue;
    figures.push({
      label: labelText.trim(),
      caption: captionText.replace(/\s+/g, ' ').trim(),
      urls: figureImageURLs(pmcid, href),
    });
  }
  return figures;
}

function resolvePageBaseURL(doc: Document, baseURL: string): string {
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) {
    const resolved = resolveURL(baseURL, baseHref);
    if (resolved) return resolved;
  }
  if (/^https?:\/\/arxiv\.org\/html\/[^/?#]+$/i.test(baseURL)) {
    return `${baseURL}/`;
  }
  return baseURL;
}

export function parsePublisherVisuals(
  text: string,
  baseURL: string,
  parser = new DOMParser()
): ArticleFigure[] {
  const isXML =
    !/<(!doctype\s+)?html\b/i.test(text) &&
    /<\s*(article|fig|figure|graphic|media)(\s|>)/i.test(text);
  if (isXML) {
    const doc = parser.parseFromString(text, 'text/xml');
    const xmlFigs: ArticleFigure[] = [];
    for (const fig of Array.from(doc.querySelectorAll('fig, figure'))) {
      const label = cleanText(fig.querySelector('label')?.textContent);
      const caption = cleanText(fig.querySelector('caption, figcaption')?.textContent);
      if (isPreviewFigure([fig.getAttribute('fig-type') || '', label, caption].join(' '))) continue;
      const g = fig.querySelector('graphic, media, img');
      const href =
        g?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        g?.getAttribute('xlink:href') ||
        g?.getAttribute('href') ||
        g?.getAttribute('src');
      if (!href) continue;
      const noExt = href.replace(/\.(jpg|jpeg|png|gif|webp|tif|tiff)$/i, '');
      const urls = uniqueURLs(
        [href, `${noExt}.jpg`, `${noExt}.png`, `${noExt}.jpeg`, `${noExt}.webp`].map((v) =>
          resolveURL(baseURL, v)
        )
      );
      if (urls.length) xmlFigs.push({ label, caption, urls });
    }
    if (xmlFigs.length) return xmlFigs;
  }

  const doc = parser.parseFromString(text, 'text/html');
  const resolvedBase = resolvePageBaseURL(doc, baseURL);
  const seen = createFigureSeen();
  const figures: ArticleFigure[] = [];
  const selector = [
    'article figure',
    'main figure',
    "[role='main'] figure",
    '.article__body figure',
    '.article-full-text figure',
    '.hlFld-Fulltext figure',
    '.ltx_figure',
    'figure',
    '.html-fig',
    '.figure-wrap',
    '.article-section__figure',
    '.figure-viewer__item',
    '.asset-viewer-inline',
    '.c-article-section__figure',
    '.fig-inline',
    'div.fig',
    "[data-test='figure']",
    "[data-component='figure']",
    "[class*='figure']",
    "[class*='fig-']",
    "[id^='fig']",
    "[id*='figure']",
    '[data-fig-id]',
    '[data-figure-id]',
    "[class*='extended']",
  ].join(',');

  let unlabeledSeq = 1;
  for (const container of Array.from(doc.querySelectorAll(selector))) {
    if (figures.length >= 24) break;
    const marker = [
      container.className || '',
      container.id || '',
      container.getAttribute('aria-label') || '',
      container.getAttribute('data-fig-id') || '',
      container.getAttribute('data-figure-id') || '',
    ].join(' ');
    if (isPreviewFigure(marker)) continue;

    const urls = extractContainerURLs(container, resolvedBase);
    if (!urls.length) continue;
    const img = container.querySelector('img');
    const label =
      firstText(container, [
        '.label',
        '.figure-label',
        '.fig-label',
        '.figure__label',
        '.figure__title',
        '.html-fig_label',
        "[class*='label']",
        'label',
        'figcaption strong',
        'figcaption b',
      ]) || cleanText(img?.getAttribute('alt') || img?.getAttribute('aria-label'));
    const caption =
      firstText(container, [
        'figcaption',
        '.caption',
        '.figure-caption',
        '.fig-caption',
        '.figure__caption',
        '.figure__caption-text',
        '.caption-text',
        '.article-section__caption',
        '.article_abstract-caption',
        '.c-article-section__figure-description',
        '.html-fig_description',
        "[class*='caption']",
      ]) || cleanText(img?.getAttribute('title') || img?.getAttribute('alt'));
    const isSemanticFigure = container.matches(
      "figure, .ltx_figure, .c-article-section__figure, .article-section__figure, [data-test='figure'], [data-component='figure']"
    );
    addFigure(figures, seen, {
      label,
      caption,
      fallbackLabel: isSemanticFigure ? `Fig. ${unlabeledSeq++}` : undefined,
      metaLabel: [marker, img?.getAttribute('alt'), img?.getAttribute('title')].filter(Boolean).join(' '),
      urlHint: urls.join(' '),
      urls,
    });
  }
  return figures;
}

function firstText(container: Element, selectors: string[]): string {
  for (const sel of selectors) {
    const txt = cleanText(container.querySelector(sel)?.textContent);
    if (txt) return txt;
  }
  return '';
}

function imageURLScore(url: string): number {
  const value = String(url || '').toLowerCase();
  let score = 50;
  if (/(download|full|hi[-_]?res|high[-_]?res|_lrg\b|-f\.(?:jpe?g|png)|\/large(?:\/|$)|\/figures\/[^/]+\/large|image_l|size=large|size=original|\/max\/|original|zoom)/i.test(value)) {
    score -= 30;
  }
  if (/\.(jpe?g|png|gif|webp|tiff?)([?#].*)?$/i.test(value)) score -= 15;
  if (/(thumb|thumbnail|preview|small|medium|lowres|lw\d{2,3}|size=inline|w\d{2,3}|width=\d{2,3})/i.test(value)) {
    score += 30;
  }
  return score;
}

export function extractContainerURLs(container: Element, baseURL: string): string[] {
  const urls: string[] = [];
  const isHTMLFigurePage = (u: string) =>
    /\.html?(?:[?#].*)?$/i.test(u) ||
    /\/article\/.*\/figures?\/\d+\/?(?:[?#].*)?$/i.test(u) ||
    /\/doi\/(?:abs|full|epdf|pdf)\//i.test(u) ||
    /\baction=(?:showPopup|downloadCitation)\b/i.test(u);
  const isPotential = (u: string) =>
    !isHTMLFigurePage(u) &&
    (/\.(jpe?g|png|gif|webp|tiff?)([?#].*)?$/i.test(u) ||
      /\/figures\/[^/]+\/(?:large|medium|original)\/?$/i.test(u));

  for (const link of Array.from(container.querySelectorAll('a[href]'))) {
    const resolved = resolveURL(baseURL, link.getAttribute('href'));
    if (resolved && isPotential(resolved)) urls.push(...expandHighResURLs(resolved));
  }
  const attrs = [
    'data-download-url',
    'data-download-src',
    'data-full-src',
    'data-high-res-src',
    'data-high-res-image',
    'data-hi-res',
    'data-hires',
    'data-hires-image',
    'data-full',
    'data-original',
    'data-original-src',
    'data-zoom-src',
    'data-zoom-image',
    'data-large',
    'data-large-src',
    'data-lg-src',
    'data-src-large',
    'data-lg-img',
    'data-image',
    'data-image-src',
    'data-img-src',
    'data-lazy-src',
    'data-src',
    'src',
  ];
  for (const img of Array.from(container.querySelectorAll('img'))) {
    for (const attr of attrs) {
      const resolved = resolveURL(baseURL, img.getAttribute(attr));
      if (resolved) urls.push(...expandHighResURLs(resolved));
    }
    for (const s of imageURLsFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'))) {
      const resolved = resolveURL(baseURL, s);
      if (resolved) urls.push(...expandHighResURLs(resolved));
    }
  }
  for (const srcEl of Array.from(container.querySelectorAll('source[srcset], source[data-srcset]'))) {
    for (const s of imageURLsFromSrcset(srcEl.getAttribute('srcset') || srcEl.getAttribute('data-srcset'))) {
      const resolved = resolveURL(baseURL, s);
      if (resolved) urls.push(...expandHighResURLs(resolved));
    }
  }
  return uniqueURLs(urls)
    .filter(isUsefulImageURL)
    .sort((a, b) => imageURLScore(a) - imageURLScore(b));
}
