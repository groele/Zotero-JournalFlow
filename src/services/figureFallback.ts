import type { ArticleFigure } from '../types';
import { cleanText } from './figureLabels';
import { extractContainerURLs } from './figureParser';
import { addFigure, createFigureSeen, expandHighResURLs, figureImageURLs, isUsefulImageURL } from './figures';
import { resolveURL, uniqueURLs } from './http';

const GENERIC_PROMO_IMAGE_RE =
  /(?:default[-_]?cover|journal[-_]?cover|cover[-_]?(?:image|art|thumb)|site[-_]?logo|brand(?:ing)?|favicon|apple-touch-icon|social[-_]?default|opengraph[-_]?default|placeholder|no[-_]?image|banner[-_]?ad|springer-logo|nature[-_]?logo|elsevier[-_]?logo|wiley[-_]?logo|acs[-_]?logo|aps[-_]?logo|rsc[-_]?logo|ieee[-_]?logo|science[-_]?logo|badge|orcid|crossref)/i;

function resolveDocumentBaseURL(doc: Document, fallbackURL: string): string {
  const baseHref = doc.querySelector('base[href]')?.getAttribute('href');
  if (baseHref) {
    const resolved = resolveURL(fallbackURL, baseHref);
    if (resolved) return resolved;
  }
  if (/^https?:\/\/arxiv\.org\/html\/[^/?#]+$/i.test(fallbackURL)) {
    return `${fallbackURL}/`;
  }
  return fallbackURL;
}

function isAcceptableFallbackURL(url: string): boolean {
  return isUsefulImageURL(url) && !GENERIC_PROMO_IMAGE_RE.test(url);
}

function collectJSONLDImageURLs(doc: Document, baseURL: string): string[] {
  const found: string[] = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === 'string') {
      const resolved = resolveURL(baseURL, node);
      if (resolved && isAcceptableFallbackURL(resolved)) found.push(resolved);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      for (const key of ['image', 'thumbnailUrl', 'contentUrl', 'url', 'associatedMedia']) {
        if (key in obj && obj[key]) {
          if (key === 'url' && typeof obj.encodingFormat === 'string' && !/^image\//i.test(obj.encodingFormat)) {
            continue;
          }
          if (key === 'url' && typeof obj['@type'] === 'string' && !/ImageObject|MediaObject/i.test(obj['@type'])) {
            continue;
          }
          visit(obj[key]);
        }
      }
      if ('@graph' in obj) visit(obj['@graph']);
    }
  };
  for (const script of Array.from(doc.querySelectorAll("script[type='application/ld+json']"))) {
    try {
      const parsed = JSON.parse(script.textContent || '');
      visit(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return uniqueURLs(found);
}

export function parseEuropePMCFallbackFigures(
  xmlText: string,
  pmcid: string,
  parser = new DOMParser()
): ArticleFigure[] {
  if (!xmlText || !pmcid) return [];
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const seen = createFigureSeen();
  const out: ArticleFigure[] = [];
  for (const node of Array.from(doc.querySelectorAll('fig, abstract[abstract-type="graphical"], abstract[abstract-type="toc"]'))) {
    const graphic = node.querySelector('graphic, media');
    const href =
      graphic?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      graphic?.getAttribute('xlink:href') ||
      graphic?.getAttribute('href');
    if (!href) continue;
    const label = cleanText(node.querySelector('label')?.textContent) || 'Graphical Abstract';
    const caption = cleanText(node.querySelector('caption, p')?.textContent);
    addFigure(out, seen, {
      label,
      caption,
      fallbackLabel: label,
      urls: figureImageURLs(pmcid, href),
    });
  }
  return out;
}

export function parseFallbackVisuals(
  html: string,
  baseURL: string,
  parser = new DOMParser()
): ArticleFigure[] {
  if (!html) return [];
  const doc = parser.parseFromString(html, 'text/html');
  const resolvedBase = resolveDocumentBaseURL(doc, baseURL);
  const seen = createFigureSeen();
  const out: ArticleFigure[] = [];

  const gaSelectors = [
    '.article_abstract-image',
    '.article_abstract-figure',
    '.graphical-abstract',
    '.abstract-graphic',
    '.toc-graphic',
    '.toc-image',
    "[data-test='graphical-abstract']",
    "[id*='graphical-abstract']",
    "[class*='graphical-abstract']",
    "[class*='graphical_abstract']",
    "[class*='toc-graphic']",
  ].join(',');

  for (const container of Array.from(doc.querySelectorAll(gaSelectors))) {
    const urls = extractContainerURLs(container, resolvedBase).filter(isAcceptableFallbackURL);
    if (!urls.length) continue;
    const img = container.querySelector('img');
    const caption = cleanText(
      container.querySelector('figcaption, .caption, [class*="caption"]')?.textContent ||
        img?.getAttribute('alt') ||
        img?.getAttribute('title')
    );
    addFigure(out, seen, {
      label: 'Graphical Abstract',
      caption,
      fallbackLabel: 'Graphical Abstract',
      urls,
    });
  }

  let bodyImgIdx = 1;
  const bodySelectors = [
    'article img',
    'main img',
    "[role='main'] img",
    "[itemprop='articleBody'] img",
    '.article__body img',
    '.c-article-section__content img',
    'img.ltx_graphics',
    "img[alt*='graphical' i]",
    "img[alt*='toc' i]",
  ].join(',');

  for (const img of Array.from(doc.querySelectorAll(bodySelectors))) {
    if (out.length >= 12) break;
    const urls = extractContainerURLs(img.parentElement || img, resolvedBase).filter(isAcceptableFallbackURL);
    if (!urls.length) continue;
    const alt = cleanText(img.getAttribute('alt') || img.getAttribute('title') || img.getAttribute('aria-label'));
    const isGA = /(graphical\s+abstract|toc|table\s+of\s+contents)/i.test(`${alt} ${urls[0]}`);
    const fallbackLabel = isGA ? 'Graphical Abstract' : `Fig. ${bodyImgIdx++}`;
    addFigure(out, seen, {
      label: alt || fallbackLabel,
      caption: alt,
      fallbackLabel,
      metaLabel: alt,
      urlHint: urls[0],
      urls,
    });
  }

  const metaSelectors = [
    "meta[name='citation_figure_url']",
    "meta[property='og:image']",
    "meta[property='og:image:secure_url']",
    "meta[name='twitter:image']",
    "meta[name='twitter:image:src']",
    "link[rel='image_src']",
  ];
  const metaURLs: string[] = [];
  for (const sel of metaSelectors) {
    for (const el of Array.from(doc.querySelectorAll(sel))) {
      const raw = el.getAttribute('content') || el.getAttribute('href');
      const resolved = resolveURL(resolvedBase, raw);
      if (resolved && isAcceptableFallbackURL(resolved)) {
        metaURLs.push(...expandHighResURLs(resolved).filter(isAcceptableFallbackURL));
      }
    }
  }
  metaURLs.push(...collectJSONLDImageURLs(doc, resolvedBase).flatMap(expandHighResURLs).filter(isAcceptableFallbackURL));

  const uniqueMeta = uniqueURLs(metaURLs);
  if (uniqueMeta.length && out.length === 0) {
    addFigure(out, seen, {
      label: 'Graphic Preview',
      caption: '',
      fallbackLabel: 'Graphic',
      urls: uniqueMeta.slice(0, 6),
    });
  }

  return out;
}
