import {
  DailyFeedCacheStore,
  DEFAULT_CACHE_TTL_MS,
  feedCacheKey,
  mergeIncrementalArticles,
} from '../services/cache';
import { fetchJournalFeed } from '../services/crossref';
import {
  enrichBatchMetadata,
  enrichMissingAbstracts,
  enrichSingleArticleAbstract,
} from '../services/enrichment';
import { dedupeArticles, filterArticleTypes, filterRecentDays } from '../services/filtering';
import { ReadingStateStore, articleStateKey } from '../services/readingState';
import type { JournalArticle, JournalSubscription } from '../types';

export interface FeedParams {
  rows: number;
  days: number;
  filter: boolean;
  ttlMs: number;
}

export class FeedCoordinator {
  constructor(
    private cache: DailyFeedCacheStore,
    private readingState: ReadingStateStore,
    private getPref: (key: string) => unknown,
    private getJournals: () => JournalSubscription[],
    private isDisposed: () => boolean
  ) {}

  getFeedParams(): FeedParams {
    const rows = parseInt(String(this.getPref('articlesPerJournal') || '200'), 10) || 200;
    const days = parseInt(String(this.getPref('daysToFetch') || '14'), 10) || 14;
    const filter = Boolean(this.getPref('filterArticleTypes') ?? true);
    const ttlHours = Math.max(
      1,
      Math.min(168, parseInt(String(this.getPref('cacheTTLHours') || '12'), 10) || 12)
    );
    return { rows, days, filter, ttlMs: ttlHours * 60 * 60 * 1000 || DEFAULT_CACHE_TTL_MS };
  }

  stampReadingState(articles: JournalArticle[]): JournalArticle[] {
    for (const article of articles) {
      const key = articleStateKey(article.doi, article.title);
      if (!key) continue;
      article._read = this.readingState.isRead(key);
      article._starred = this.readingState.isStarred(key);
      const cachedTx = this.readingState.getTranslations(key);
      if (cachedTx && Object.keys(cachedTx).length) {
        article._tx = { ...(article._tx || {}), ...cachedTx };
      }
    }
    return articles;
  }

  async getFeed(issn: string, { force = false }: { force?: boolean } = {}): Promise<JournalArticle[]> {
    await this.readingState.ensureLoaded();
    const { rows, days, filter, ttlMs } = this.getFeedParams();
    const key = feedCacheKey(issn, rows, days, filter);

    let staleArticles: JournalArticle[] | null = null;
    let fetchDays = days;

    if (force) {
      await this.cache.deleteByISSN(issn);
    } else {
      const mem = this.cache.getMemory(key, ttlMs, true);
      if (mem) return this.stampReadingState(mem);
      const disk = await this.cache.getPersisted(key, { maxAgeMs: ttlMs, requireToday: true });
      if (disk) {
        this.cache.setMemory(key, disk.articles, disk.time);
        return this.stampReadingState(disk.articles);
      }
      const stale =
        (await this.cache.getPersisted(key, { allowStale: true })) ||
        (await this.cache.getLatestByParams(issn, rows, days, filter));
      if (stale?.articles?.length) {
        const daysSince = Math.max(1, Math.ceil((Date.now() - Number(stale.time || 0)) / 86_400_000));
        if (daysSince < days) {
          staleArticles = filterRecentDays(stale.articles, days);
          fetchDays = Math.min(days, daysSince + 1);
        }
      }
    }

    const journalSub = this.getJournals().find((j) => j.issn === issn);
    let articles = dedupeArticles(
      await fetchJournalFeed(issn, rows, fetchDays, journalSub?.altIssns || [])
    );
    if (this.isDisposed()) return [];

    if (filter) articles = filterArticleTypes(articles);
    articles = filterRecentDays(articles, days);
    if (staleArticles?.length) {
      articles = mergeIncrementalArticles(staleArticles, articles).slice(0, rows);
    }
    this.stampReadingState(articles);
    this.cache.setMemory(key, articles);
    await this.cache.setPersisted(key, issn, articles);
    return articles;
  }

  async enrichFeedMetadata(
    articles: JournalArticle[],
    onUpdated?: (article: JournalArticle) => void
  ): Promise<JournalArticle[]> {
    const affectedIssns = new Set<string>();
    for (const article of articles) {
      if (article.issn) affectedIssns.add(article.issn);
    }
    await enrichBatchMetadata(articles);
    if (this.isDisposed()) return articles;
    if (onUpdated) {
      for (const article of articles) onUpdated(article);
    }
    if (affectedIssns.size && !this.isDisposed()) {
      const { rows, days, filter } = this.getFeedParams();
      for (const issn of affectedIssns) {
        const key = feedCacheKey(issn, rows, days, filter);
        const mem = this.cache.getMemoryStale(key);
        if (mem) await this.cache.setPersisted(key, issn, mem.articles);
      }
    }
    return articles;
  }

  async enrichFeedAbstracts(
    articles: JournalArticle[],
    onRecovered?: (article: JournalArticle) => void
  ): Promise<JournalArticle[]> {
    const recoveredIssns = new Set<string>();
    await enrichMissingAbstracts(
      articles,
      (article) => {
        if (article.issn) recoveredIssns.add(article.issn);
        onRecovered?.(article);
      },
      4
    );
    if (recoveredIssns.size && !this.isDisposed()) {
      const { rows, days, filter } = this.getFeedParams();
      for (const issn of recoveredIssns) {
        const key = feedCacheKey(issn, rows, days, filter);
        const mem = this.cache.getMemoryStale(key);
        if (mem) await this.cache.setPersisted(key, issn, mem.articles);
      }
    }
    return articles;
  }

  async enrichSingleArticle(article: JournalArticle): Promise<boolean> {
    const ok = await enrichSingleArticleAbstract(article, { includeUnpaywall: true });
    if (ok && article.issn && !this.isDisposed()) {
      const { rows, days, filter } = this.getFeedParams();
      const key = feedCacheKey(article.issn, rows, days, filter);
      const mem = this.cache.getMemoryStale(key);
      if (mem) await this.cache.setPersisted(key, article.issn, mem.articles);
    }
    return ok;
  }
}
