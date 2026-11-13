import type { ArticleTranslation, UILanguage } from '../types';

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

const STATE_FILE_NAME = 'journalflow-state.json';
const MAX_TRANSLATIONS = 400;
const MAX_DOIS = 1500;

interface PersistedReadingState {
  schema: string;
  readDois: string[];
  starredDois: string[];
  translations: Record<string, Partial<Record<UILanguage, ArticleTranslation>>>;
}

export function articleStateKey(doi?: string, title?: string): string {
  const normDoi = String(doi || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .toLowerCase();
  if (normDoi) return `doi:${normDoi}`;
  const normTitle = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  return normTitle ? `title:${normTitle}` : '';
}

export class ReadingStateStore {
  private loaded = false;
  private readSet = new Set<string>();
  private starredSet = new Set<string>();
  private translations = new Map<string, Partial<Record<UILanguage, ArticleTranslation>>>();
  private writeQueue: Promise<void> = Promise.resolve();

  private getFilePath(): string {
    try {
      const dir = Zotero?.DataDirectory?.dir;
      if (dir && typeof PathUtils !== 'undefined' && PathUtils?.join) {
        return PathUtils.join(dir, STATE_FILE_NAME);
      }
      if (dir) return `${dir}/${STATE_FILE_NAME}`;
    } catch {}
    return '';
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const filePath = this.getFilePath();
    if (!filePath || typeof IOUtils === 'undefined' || !IOUtils?.readUTF8) return;
    try {
      const raw = await IOUtils.readUTF8(filePath);
      const parsed = JSON.parse(raw) as PersistedReadingState;
      if (!parsed || parsed.schema !== 'state-v1') return;
      for (const k of parsed.readDois || []) this.readSet.add(k);
      for (const k of parsed.starredDois || []) this.starredSet.add(k);
      for (const [k, v] of Object.entries(parsed.translations || {})) {
        if (v && typeof v === 'object') this.translations.set(k, v);
      }
    } catch {
      // Absent or unreadable; start empty
    }
  }

  private async persist(): Promise<void> {
    const filePath = this.getFilePath();
    if (!filePath || typeof IOUtils === 'undefined' || !IOUtils?.writeUTF8) return;
    const payload: PersistedReadingState = {
      schema: 'state-v1',
      readDois: Array.from(this.readSet).slice(-MAX_DOIS),
      starredDois: Array.from(this.starredSet).slice(-MAX_DOIS),
      translations: Object.fromEntries(Array.from(this.translations.entries()).slice(-MAX_TRANSLATIONS)),
    };
    const run = async () => {
      try {
        await IOUtils.writeUTF8(filePath, JSON.stringify(payload));
      } catch {}
    };
    this.writeQueue = this.writeQueue.then(run, run);
    await this.writeQueue;
  }

  isRead(key: string): boolean {
    return Boolean(key && this.readSet.has(key));
  }

  async setRead(key: string, value: boolean): Promise<void> {
    if (!key) return;
    await this.ensureLoaded();
    if (value) this.readSet.add(key);
    else this.readSet.delete(key);
    await this.persist();
  }

  async setReadMany(keys: string[], value: boolean): Promise<void> {
    const valid = keys.filter(Boolean);
    if (!valid.length) return;
    await this.ensureLoaded();
    let changed = false;
    for (const key of valid) {
      const had = this.readSet.has(key);
      if (value && !had) {
        this.readSet.add(key);
        changed = true;
      } else if (!value && had) {
        this.readSet.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  getTranslations(key: string): Partial<Record<UILanguage, ArticleTranslation>> | undefined {
    if (!key) return undefined;
    const entry = this.translations.get(key);
    return entry ? { ...entry } : undefined;
  }

  isStarred(key: string): boolean {
    return Boolean(key && this.starredSet.has(key));
  }

  async toggleStarred(key: string): Promise<boolean> {
    if (!key) return false;
    await this.ensureLoaded();
    const next = !this.starredSet.has(key);
    if (next) this.starredSet.add(key);
    else this.starredSet.delete(key);
    await this.persist();
    return next;
  }

  getTranslation(key: string, lang: UILanguage): ArticleTranslation | undefined {
    return key ? this.translations.get(key)?.[lang] : undefined;
  }

  async setTranslation(key: string, lang: UILanguage, tx: ArticleTranslation): Promise<void> {
    if (!key) return;
    await this.ensureLoaded();
    const prev = this.translations.get(key) || {};
    this.translations.set(key, { ...prev, [lang]: tx });
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}
