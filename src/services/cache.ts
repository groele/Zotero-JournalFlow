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
  filterArticleTypes: boolean
): string {
  return [
    DAILY_FEED_CACHE_SCHEMA,
    issn,
    rows,
    days,
    filterArticleTypes ? 'research' : 'all',
  ].join('|');
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

  private pruneExpired(doc: DailyFeedCacheDocument, maxAgeMs: number): void {
    const now = Date.now();
    const keepLimit = Math.max(maxAgeMs * 2, 48 * 60 * 60 * 1000);
    for (const [key, entry] of Object.entries(doc.entries)) {
      if (!entry || !Array.isArray(entry.articles) || now - Number(entry.time || 0) > keepLimit) {
        delete doc.entries[key];
      }
    }
  }

  private async writeDiskDoc(doc: DailyFeedCacheDocument, pruneAgeMs = DEFAULT_CACHE_TTL_MS): Promise<void> {
    doc.day = localDateKey();
    this.pruneExpired(doc, pruneAgeMs);
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

  getMemory(cacheKey: string, maxAgeMs = DEFAULT_CACHE_TTL_MS): JournalArticle[] | null {
    const cached = this.memory.get(cacheKey);
    if (!cached) return null;
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
    { maxAgeMs = DEFAULT_CACHE_TTL_MS, allowStale = false } = {}
  ): Promise<DailyFeedCacheEntry | null> {
    const doc = await this.readDiskDoc();
    const entry = doc.entries[cacheKey];
    if (!entry || !Array.isArray(entry.articles)) return null;
    if (!allowStale && Date.now() - Number(entry.time || 0) > maxAgeMs) {
      return null;
    }
    return entry;
  }

  async setPersisted(cacheKey: string, issn: string, articles: JournalArticle[]): Promise<void> {
    const doc = await this.readDiskDoc();
    doc.entries[cacheKey] = {
      issn,
      time: Date.now(),
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
      if (key.split('|')[1] === issn) {
        this.memory.delete(key);
      }
    }
    const doc = await this.readDiskDoc();
    let changed = false;
    for (const key of Object.keys(doc.entries)) {
      if (doc.entries[key]?.issn === issn || key.split('|')[1] === issn) {
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
