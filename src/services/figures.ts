import type { ArticleFigure } from '../types';
import {
  cleanText,
  normalizeFigureText,
  parseFigureLabelInfo,
  sortFigures,
  splitFigureLabel,
  stripCaptionLabel,
  stripKnownFigureLabel,
} from './figureLabels';
import { uniqueURLs } from './http';
import { expandHighResURLs } from './publisherUrls';

export { expandHighResURLs };

const NOISE_IMAGE_TOKEN_RE =
  /(?:^|[/_.\-])(?:logos?|icons?|avatars?|profile|sprites?|spinners?|loader|pixel|tracking|advert|banner|share|facebook|twitter|wechat|weibo|creativecommons|orcid)(?:$|[/_.\-?&=])/i;
const ALLOW_SVG_FIGURE_RE =
  /(?:arxiv\.org\/html\/|\/bin\/|ltx_|scheme|chart|figure|fig[-_]?\d)/i;

export function isUsefulImageURL(url: string | null | undefined): boolean {
  if (!url || /^data:/i.test(url)) return false;
  if (/\.ico([?#].*)?$/i.test(url)) return false;
  if (/favicon|apple-touch-icon/i.test(url)) return false;
  if (NOISE_IMAGE_TOKEN_RE.test(url)) return false;
  if (/\.svg([?#].*)?$/i.test(url) && !ALLOW_SVG_FIGURE_RE.test(url)) {
    return false;
  }
  return true;
}

export function cleanFigure(figure: Partial<ArticleFigure> | null | undefined): ArticleFigure | null {
  if (!figure) return null;
  const rawURLs = Array.isArray(figure.urls) ? figure.urls : [figure.url || ''];
  const urls = uniqueURLs(rawURLs.flatMap(expandHighResURLs).filter(isUsefulImageURL));
  if (!urls.length) return null;

  const label = cleanText(figure.label);
  let caption = cleanText(figure.caption);
  const split = splitFigureLabel(label);
  let info = split.info;
  if (split.caption) {
    caption = caption || split.caption;
  }
  if (!info) {
    const captionSplit = splitFigureLabel(caption);
    info = captionSplit.info;
    if (captionSplit.caption) {
      caption = captionSplit.caption;
    }
  }
  if (!info) {
    info = parseFigureLabelInfo([figure.metaLabel || '', figure.urlHint || '', urls.join(' ')].join(' '));
  }
  if (!info && figure.fallbackLabel) {
    const fbLabel = cleanText(figure.fallbackLabel);
    if (fbLabel) {
      info = {
        kind: 'main',
        group: 3,
        number: 999,
        suffix: fbLabel.toLowerCase(),
        key: `fallback:${normalizeFigureText(fbLabel)}:${urls[0]}`,
        label: fbLabel,
      };
    }
  }
  if (!info) return null;

  caption = stripKnownFigureLabel(info, caption);
  return {
    label: info.label,
    caption,
    urls,
    labelInfo: info,
    width: figure.width || 0,
    height: figure.height || 0,
  };
}

export function figureCaptionText(figure: ArticleFigure): string {
  const clean = cleanFigure(figure);
  if (!clean) return '';
  if (clean.label && clean.caption) return `${clean.label}: ${clean.caption}`;
  return clean.caption || clean.label || '';
}

export function figureURLKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    const pathname = decodeURIComponent(u.pathname)
      .toLowerCase()
      .replace(/\.(jpg|jpeg|png|gif|webp|tif|tiff)$/i, '')
      .replace(
        /[@._-](\d+x\d+|\d+w|small|medium|large|lrg|full|hires|highres|zoom|thumbnail|thumb|lowres|original)$/i,
        ''
      )
      .replace(/([._-])(full|large|lrg|medium|small|thumb|thumbnail|hires|highres)([._-])/gi, '$1$3')
      .replace(/\/(full|large|medium|small|thumb|thumbnail|hires|highres|image_l|image_m|lw\d+)\//gi, '/');
    const file = pathname.split('/').pop() || pathname;
    const prefix = /(extended|ext[-_]?data|extended[-_]?data)/i.test(pathname) ? 'extendedfig' : 'fig';
    const token = file.match(/(?:fig(?:ure)?|f|gr|sc|fx|scheme|chart|graphic|image|plate)[._-]?0*([1-9]\d*)([a-z])?/i);
    if (token) {
      return `${u.hostname.toLowerCase()}::${prefix}${token[1]}${token[2] || ''}`;
    }
    return u.hostname.toLowerCase() + pathname;
  } catch {
    return String(url || '').split(/[?#]/)[0].toLowerCase();
  }
}

export interface FigureSeenTracker {
  urls: Set<string>;
  captions: Set<string>;
  numbers: Set<string>;
  byNumber: Map<string, ArticleFigure>;
}

function figureTextKey(figure: ArticleFigure): string {
  const caption = stripCaptionLabel(figure.label, figure.caption);
  return normalizeFigureText(caption || figure.label);
}

export function createFigureSeen(seedFigures: ArticleFigure[] = []): FigureSeenTracker {
  const seen: FigureSeenTracker = {
    urls: new Set(),
    captions: new Set(),
    numbers: new Set(),
    byNumber: new Map(),
  };
  for (const fig of seedFigures) {
    const clean = cleanFigure(fig);
    if (!clean) continue;
    for (const url of clean.urls) seen.urls.add(figureURLKey(url));
    const textKey = figureTextKey(clean);
    if (textKey && textKey.length > 12) seen.captions.add(textKey);
    const numberKey = clean.labelInfo?.key || '';
    if (numberKey) {
      seen.numbers.add(numberKey);
      seen.byNumber.set(numberKey, clean);
    }
  }
  return seen;
}

export function addFigure(
  list: ArticleFigure[],
  seen: FigureSeenTracker,
  figure: Partial<ArticleFigure> | null | undefined
): void {
  const clean = cleanFigure(figure);
  if (!clean) return;
  const numberKey = clean.labelInfo?.key || '';
  if (numberKey && seen.byNumber.has(numberKey)) {
    const existing = seen.byNumber.get(numberKey)!;
    existing.urls = uniqueURLs([...(existing.urls || []), ...(clean.urls || [])]);
    if (!existing.caption && clean.caption) existing.caption = clean.caption;
    existing.width = Math.max(existing.width || 0, clean.width || 0);
    existing.height = Math.max(existing.height || 0, clean.height || 0);
    return;
  }
  const urlKeys = clean.urls.map(figureURLKey).filter(Boolean);
  if (urlKeys.some((k) => seen.urls.has(k)) && (!numberKey || seen.numbers.has(numberKey))) return;
  const textKey = figureTextKey(clean);
  if (textKey && textKey.length > 12 && seen.captions.has(textKey)) return;
  if (numberKey && seen.numbers.has(numberKey) && (!textKey || textKey.length < 36 || seen.captions.has(textKey))) {
    return;
  }
  for (const k of urlKeys) seen.urls.add(k);
  if (textKey && textKey.length > 12) seen.captions.add(textKey);
  if (numberKey) {
    seen.numbers.add(numberKey);
    seen.byNumber.set(numberKey, clean);
  }
  list.push(clean);
}

export function dedupeFigures(figures: ArticleFigure[]): ArticleFigure[] {
  const out: ArticleFigure[] = [];
  const seen = createFigureSeen();
  for (const fig of figures || []) {
    addFigure(out, seen, fig);
  }
  return sortFigures(out);
}

export function figureImageURLs(pmcid: string, graphicHref: string): string[] {
  const clean = String(graphicHref || '').replace(/^.*\//, '');
  const stem = clean.replace(/\.(jpg|jpeg|png|gif|webp|tif|tiff)$/i, '');
  const variants = [clean, `${stem}.jpg`, `${stem}.png`, `${stem}.jpeg`, `${stem}.gif`];
  const urls: string[] = [];
  for (const name of variants) {
    if (!name) continue;
    urls.push(`https://europepmc.org/articles/${pmcid}/bin/${name}`);
    urls.push(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/bin/${name}`);
    urls.push(`https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/bin/${name}`);
  }
  return uniqueURLs(urls);
}

export function imageURLsFromSrcset(srcset: string | null | undefined): string[] {
  if (!srcset) return [];
  const out: Array<{ url: string; width: number }> = [];
  for (const part of srcset.split(',')) {
    const pieces = part.trim().split(/\s+/);
    const url = pieces[0];
    let width = 0;
    for (const p of pieces.slice(1)) {
      const m = p.match(/^(\d+)w$/);
      if (m) width = parseInt(m[1], 10);
      const density = p.match(/^([\d.]+)x$/);
      if (density) width = Math.round(parseFloat(density[1]) * 1000);
    }
    if (url) out.push({ url, width });
  }
  return out.sort((a, b) => b.width - a.width).map((item) => item.url);
}
