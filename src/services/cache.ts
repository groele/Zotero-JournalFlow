import {
  CACHE_FILE_NAME,
  DAILY_FEED_CACHE_MAX_BYTES,
  DAILY_FEED_CACHE_SCHEMA,
} from '../config';
import type { DailyFeedCacheDocument, DailyFeedCacheEntry, JournalArticle } from '../types';

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

export const DEFAULT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const WEEKLY_CACHE_CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function mergeIncrementalArticles(
  existing: JournalArticle[],
  incoming: JournalArticle[]
): JournalArticle[] {
  const keyOf = (a: JournalArticle): string => {
    const doi = String(a.doi || '').trim().toLowerCase();
    if (doi) return `doi:${doi}`;
    return `title:${String(a.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')}`;
  };
  const merged = new Map<string, JournalArticle>();
  for (const prev of existing || []) {
    const k = keyOf(prev);
    if (k !== 'title:') merged.set(k, { ...prev });
  }
  for (const next of incoming || []) {
    const k = keyOf(next);
    if (k === 'title:') continue;
    const prev = merged.get(k);
    if (!prev) {
      merged.set(k, { ...next });
      continue;
    }
    merged.set(k, {
      ...prev,
      ...next,
      abstract: next.abstract || prev.abstract || '',
      abstractSource: next.abstract ? next.abstractSource : prev.abstractSource || '',
      pmcid: next.pmcid || prev.pmcid || null,
      fullTextLinks: next.fullTextLinks?.length ? next.fullTextLinks : prev.fullTextLinks || [],
      isOpenAccess: Boolean(next.isOpenAccess || prev.isOpenAccess),
    });
  }
  return Array.from(merged.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export interface MemoryCacheValue {
  day: string;
  time: number;
  articles: JournalArticle[];
}

export function localDateKey(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function feedCacheKey(
  issn: string,
  rows: number,
  days: number,
  filterArticleTypes: boolean,
  day = localDateKey()
): string {
  return [
    DAILY_FEED_CACHE_SCHEMA,
    day,
    issn,
    rows,
    days,
    filterArticleTypes ? 'research' : 'all',
  ].join('|');
}

export function feedCacheScopePrefix(
  issn: string,
  rows: number,
  days: number,
  filterArticleTypes: boolean
): string {
  return [issn, rows, days, filterArticleTypes ? 'research' : 'all'].join('|');
}

export function sanitizeFeedArticles(articles: JournalArticle[]): JournalArticle[] {
  return (articles || []).map((article) => ({
    doi: article.doi || '',
    title: article.title || '',
    authors: article.authors || '',
    journal: article.journal || '',
    issn: article.issn || '',
    date: article.date || '',
    volume: article.volume || '',
    issue: article.issue || '',
    pages: article.pages || '',
    abstract: article.abstract || '',
    abstractSource: article.abstractSource || '',
    url: article.url || '',
    fullTextLinks: article.fullTextLinks || [],
    pmcid: article.pmcid || null,
    pubTypes: article.pubTypes || [],
    isOpenAccess: !!article.isOpenAccess,
    figures: null,
    graphicalAbstract: null,
  }));
}

export class DailyFeedCacheStore {
  private memory = new Map<string, MemoryCacheValue>();
  private diskCache: DailyFeedCacheDocument | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  getCacheFilePath(): string {
    try {
      const dataDir = Zotero?.DataDirectory?.dir;
      if (dataDir && typeof PathUtils !== 'undefined' && PathUtils?.join) {
        return PathUtils.join(dataDir, CACHE_FILE_NAME);
      }
      if (dataDir) {
        return `${dataDir}/${CACHE_FILE_NAME}`;
      }
    } catch {
      // Fallback display label
    }
    return `Zotero/${CACHE_FILE_NAME}`;
  }

  private emptyDoc(): DailyFeedCacheDocument {
    return {
      schema: DAILY_FEED_CACHE_SCHEMA,
      day: localDateKey(),
      lastWeeklyCleanupTime: Date.now(),
      entries: {},
    };
  }

  private async readDiskDoc(): Promise<DailyFeedCacheDocument> {
    if (this.diskCache && this.diskCache.schema === DAILY_FEED_CACHE_SCHEMA) {
      return this.diskCache;
    }
    const filePath = this.getCacheFilePath();
    if (typeof IOUtils !== 'undefined' && IOUtils?.readUTF8 && filePath !== `Zotero/${CACHE_FILE_NAME}`) {
      try {
        const raw = await IOUtils.readUTF8(filePath);
        const parsed = JSON.parse(raw) as DailyFeedCacheDocument;
        if (parsed && parsed.schema === DAILY_FEED_CACHE_SCHEMA && parsed.entries) {
          this.diskCache = parsed;
          return parsed;
        }
      } catch {
        // File absent or invalid JSON; create fresh doc
      }
    }
    this.diskCache = this.emptyDoc();
    return this.diskCache;
  }

  private pruneWeeklyIfNeeded(doc: DailyFeedCacheDocument, now = Date.now()): void {
    const lastCleanup = Number(doc.lastWeeklyCleanupTime || 0);
    if (lastCleanup > 0 && now - lastCleanup < WEEKLY_CACHE_CLEANUP_INTERVAL_MS) {
      return;
    }
    for (const [key, entry] of Object.entries(doc.entries)) {
      if (!entry || !Array.isArray(entry.articles) || now - Number(entry.time || 0) > WEEKLY_CACHE_CLEANUP_INTERVAL_MS) {
        delete doc.entries[key];
      }
    }
    doc.lastWeeklyCleanupTime = now;
  }

  private async writeDiskDoc(doc: DailyFeedCacheDocument): Promise<void> {
    const now = Date.now();
    doc.day = localDateKey(new Date(now));
    this.pruneWeeklyIfNeeded(doc, now);
    this.diskCache = doc;
    const filePath = this.getCacheFilePath();
    if (typeof IOUtils === 'undefined' || !IOUtils?.writeUTF8 || filePath === `Zotero/${CACHE_FILE_NAME}`) {
      return;
    }
    const run = async () => {
      try {
        const raw = JSON.stringify(doc);
        if (raw.length > DAILY_FEED_CACHE_MAX_BYTES) {
          Zotero?.debug?.('JournalFlow: feed cache exceeds max bytes; skipping persistence');
          return;
        }
        await IOUtils.writeUTF8(filePath, raw);
      } catch (error) {
        Zotero?.debug?.(`JournalFlow: feed cache write failed: ${error}`);
      }
    };
    this.writeQueue = this.writeQueue.then(run, run);
    await this.writeQueue;
  }

  getMemory(cacheKey: string, maxAgeMs = DEFAULT_CACHE_TTL_MS, requireToday = false): JournalArticle[] | null {
    const cached = this.memory.get(cacheKey);
    if (!cached) return null;
    if (requireToday && cached.day !== localDateKey()) return null;
    if (Date.now() - cached.time <= maxAgeMs) {
      return cached.articles;
    }
    return null;
  }

  getMemoryStale(cacheKey: string): MemoryCacheValue | null {
    return this.memory.get(cacheKey) || null;
  }

  setMemory(cacheKey: string, articles: JournalArticle[], time = Date.now()): void {
    this.memory.set(cacheKey, {
      day: localDateKey(),
      time,
      articles,
    });
  }

  async getPersisted(
    cacheKey: string,
    { maxAgeMs = DEFAULT_CACHE_TTL_MS, allowStale = false, requireToday = false } = {}
  ): Promise<DailyFeedCacheEntry | null> {
    const doc = await this.readDiskDoc();
    const entry = doc.entries[cacheKey];
    if (!entry || !Array.isArray(entry.articles)) return null;
    if (requireToday && entry.day && entry.day !== localDateKey()) return null;
    if (!allowStale && Date.now() - Number(entry.time || 0) > maxAgeMs) {
      return null;
    }
    return entry;
  }

  async getLatestByParams(
    issn: string,
    rows: number,
    days: number,
    filterArticleTypes: boolean
  ): Promise<DailyFeedCacheEntry | null> {
    const doc = await this.readDiskDoc();
    const suffix = `|${feedCacheScopePrefix(issn, rows, days, filterArticleTypes)}`;
    let best: DailyFeedCacheEntry | null = null;
    for (const [k, entry] of Object.entries(doc.entries)) {
      if (!entry || !Array.isArray(entry.articles) || !entry.articles.length) continue;
      if (!k.endsWith(suffix) && entry.issn !== issn) continue;
      if (k.endsWith(suffix) && (!best || Number(entry.time || 0) > Number(best.time || 0))) {
        best = entry;
      }
    }
    return best;
  }

  async setPersisted(cacheKey: string, issn: string, articles: JournalArticle[]): Promise<void> {
    const doc = await this.readDiskDoc();
    const now = Date.now();
    doc.entries[cacheKey] = {
      issn,
      day: localDateKey(new Date(now)),
      time: now,
      articles: sanitizeFeedArticles(articles),
    };
    await this.writeDiskDoc(doc);
  }

  async deleteKey(cacheKey: string): Promise<void> {
    this.memory.delete(cacheKey);
    const doc = await this.readDiskDoc();
    if (!doc.entries[cacheKey]) return;
    delete doc.entries[cacheKey];
    await this.writeDiskDoc(doc);
  }

  async deleteByISSN(issn: string): Promise<void> {
    for (const key of Array.from(this.memory.keys())) {
      const parts = key.split('|');
      if (parts[1] === issn || parts[2] === issn) {
        this.memory.delete(key);
      }
    }
    const doc = await this.readDiskDoc();
    let changed = false;
    for (const key of Object.keys(doc.entries)) {
      const parts = key.split('|');
      if (doc.entries[key]?.issn === issn || parts[1] === issn || parts[2] === issn) {
        delete doc.entries[key];
        changed = true;
      }
    }
    if (changed) {
      await this.writeDiskDoc(doc);
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    const fresh = this.emptyDoc();
    await this.writeDiskDoc(fresh);
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}
