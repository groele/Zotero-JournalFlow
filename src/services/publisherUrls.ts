import { uniqueURLs } from './http';
import { expandAdapterHighResImageURLs } from './publisherAdapters';

const CDN_STRIP_PARAMS = [
  'width',
  'height',
  'w',
  'h',
  'fit',
  'crop',
  'resize',
  'quality',
  'auto',
  'format',
  'ixlib',
  'dpr',
  'output',
];

export function expandHighResURLs(url: string | null | undefined): string[] {
  if (!url) return [];
  const raw = String(url).trim();
  const candidates: string[] = [];

  try {
    const u = new URL(raw);
    const path = u.pathname;

    candidates.push(...expandAdapterHighResImageURLs(u));

    const noQuery = new URL(u.href);
    for (const key of CDN_STRIP_PARAMS) {
      noQuery.searchParams.delete(key);
    }
    candidates.push(noQuery.href);

    const genericPaths = [
      path.replace(/\/cdn-cgi\/image\/[^/]+\//i, '/'),
      path.replace(/\/(?:thumb|thumbnail|preview|small|medium)\//gi, '/'),
      path.replace(/([/_-])(?:thumb|thumbnail|preview|small|medium)([._/-])/gi, '$1$2'),
    ];
    for (const p of genericPaths) {
      if (p && p !== path) {
        const variant = new URL(u.href);
        variant.pathname = p;
        for (const key of ['width', 'height', 'w', 'h', 'fit', 'crop', 'resize']) {
          variant.searchParams.delete(key);
        }
        candidates.push(variant.href);
      }
    }
  } catch {
    // Keep original URL only
  }

  candidates.push(raw);
  return uniqueURLs(candidates);
}
