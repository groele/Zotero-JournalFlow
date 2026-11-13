import { PUBTYPE_BLOCK, TITLE_BLOCK_RE } from '../config';
import type { ArticleFilterMode, JournalArticle } from '../types';
import { articleDateValue, dateDaysAgo } from './crossref';

export function articleMatchesFilterMode(article: JournalArticle, mode: ArticleFilterMode): boolean {
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

export function isBlockedType(article: Pick<JournalArticle, 'pubTypes' | 'title'>): boolean {
  if (article.pubTypes && article.pubTypes.length) {
    const joined = article.pubTypes.join('; ').toLowerCase();
    if (PUBTYPE_BLOCK.some((b) => joined.includes(b))) {
      return true;
    }
  }
  if (TITLE_BLOCK_RE.test(article.title || '')) {
    return true;
  }
  return false;
}

export function filterArticleTypes(articles: JournalArticle[]): JournalArticle[] {
  return articles.filter((a) => !isBlockedType(a));
}

export function filterRecentDays(articles: JournalArticle[], days: number): JournalArticle[] {
  if (!days || days < 1) {
    return articles;
  }
  const cutoffStr = dateDaysAgo(days);
  const cutoff = Date.parse(cutoffStr);
  const cutoffYear = Number.parseInt(cutoffStr.slice(0, 4), 10);
  return articles.filter((a) => {
    if (!a.date) return false;
    if (/^\d{4}$/.test(a.date.trim())) {
      const y = Number.parseInt(a.date.trim(), 10);
      return Number.isFinite(y) && y >= cutoffYear;
    }
    return articleDateValue(a) >= cutoff;
  });
}

export function dedupeArticles(articles: JournalArticle[]): JournalArticle[] {
  const seen = new Set<string>();
  const out: JournalArticle[] = [];
  for (const article of articles) {
    const key = (article.title || '').toLowerCase().replace(/\s+/g, ' ').trim() || article.doi;
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    out.push(article);
  }
  return out;
}
