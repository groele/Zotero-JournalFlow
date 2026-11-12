import { ADDON_ID, ADDON_VERSION, CACHE_SCHEMA, DEFAULT_JOURNALS_JSON, LEGACY_PREF_BRANCH, PREF_BRANCH, PREF_DEFAULTS, UI_STRINGS } from './config';
import { FeedCoordinator } from './host/feedCoordinator';
import { applyPresetPack, backfillSubscriptions, exportSubscriptionsWithPicker, importSubscriptionsWithPicker, mergeSubscriptions, parseSubscriptionsImport } from './host/subscriptions';
import { WindowHostManager } from './host/windowManager';
import { addToZoteroByDOI, getExistingLibraryDOIs, getUserCollections, importArticleToZotero, openExternalURL, openPreferencesPane, selectLibraryItem } from './host/zoteroImport';
import { DailyFeedCacheStore, localDateKey } from './services/cache';
import { getJournalByISSN, searchJournals } from './services/crossref';
import { getVisualSourcePages } from './services/enrichment';
import { figureImageURLs } from './services/figures';
import { dedupeArticles } from './services/filtering';
import { httpGetHTML, httpGetText } from './services/http';
import { ReadingStateStore, articleStateKey } from './services/readingState';
import { getTranslationTarget as computeTarget, translateText as runTranslate } from './services/translation';
import type { ArticleTranslation, JournalArticle, JournalFlowService, JournalSubscription, PresetPackId, TranslateProvider, UILanguage, UILanguageMode, WindowOpenMode, WorkbenchLaunchState, ZoteroCollectionSummary } from './types';

declare const Zotero: any;
declare const addonId: string | undefined;
declare const version: string | undefined;
declare const rootURI: string | undefined;

export class JournalFlowHost implements JournalFlowService {
  id: string | null = typeof addonId !== 'undefined' ? addonId : ADDON_ID;
  version: string | null = typeof version !== 'undefined' ? version : ADDON_VERSION;
  rootURI: string | null = typeof rootURI !== 'undefined' ? rootURI : '';

  private cache = new DailyFeedCacheStore();
  private readingState = new ReadingStateStore();
  private windows = new WindowHostManager(this, () => this.rootURI || '');
  private feedCoordinator = new FeedCoordinator(
    this.cache,
    this.readingState,
    (k) => this.getPref(k),
    () => this.getJournals(),
    () => this.disposed
  );
  private initialized = false;
  private disposed = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.disposed = false;

    this.migrateLegacyJournals();
    if (this.getPref('cacheSchema') !== CACHE_SCHEMA) {
      await this.cache.clear();
      this.setPref('cacheSchema', CACHE_SCHEMA);
    }

    void this.readingState.ensureLoaded().catch(() => {});
    void this.backfillSubscriptionsMetadata().catch(() => {});

    for (const win of Zotero?.getMainWindows?.() || []) {
      if (win?.document?.readyState === 'loading') {
        win?.addEventListener?.('load', () => this.windows.addToWindow(win), { once: true });
      } else {
        this.windows.addToWindow(win);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    this.initialized = false;
    this.windows.closeAllWorkbenches();
    await Promise.all([this.cache.flush(), this.readingState.flush()]);
  }

  onMainWindowLoad(win: any): void {
    if (this.disposed) return;
    this.windows.addToWindow(win);
  }

  onMainWindowUnload(win: any): void {
    this.windows.removeFromWindow(win);
  }

  private migrateLegacyJournals(): void {
    try {
      if (this.getPref('legacyMigrated')) return;
      const current = Zotero?.Prefs?.get?.(`${PREF_BRANCH}journals`, true);
      const legacy = Zotero?.Prefs?.get?.(`${LEGACY_PREF_BRANCH}journals`, true);
      if (legacy && (!current || current === DEFAULT_JOURNALS_JSON)) {
        this.setPref('journals', legacy);
      }
      if (Zotero?.Prefs?.get?.(`${LEGACY_PREF_BRANCH}dailyFeedCache`, true)) {
        Zotero.Prefs.clear?.(`${LEGACY_PREF_BRANCH}dailyFeedCache`, true);
      }
      this.setPref('legacyMigrated', true);
    } catch {}
  }

  private async backfillSubscriptionsMetadata(): Promise<void> {
    const next = await backfillSubscriptions(this.getJournals(), (issn) => getJournalByISSN(issn));
    if (next && !this.disposed) this.saveJournals(next);
  }

  getPref(key: string): unknown {
    const val = Zotero?.Prefs?.get?.(PREF_BRANCH + key, true);
    return val !== undefined && val !== null ? val : PREF_DEFAULTS[key];
  }

  setPref(key: string, value: unknown): void {
    Zotero?.Prefs?.set?.(PREF_BRANCH + key, value, true);
  }

  getUILanguageMode(): UILanguageMode {
    const pref = String(this.getPref('uiLanguage') || 'auto');
    return pref === 'en' || pref === 'zh' ? pref : 'auto';
  }

  getUILang(): UILanguage {
    const mode = this.getUILanguageMode();
    if (mode === 'en' || mode === 'zh') return mode;
    const locale = String(Zotero?.locale || 'en').toLowerCase();
    return locale.startsWith('zh') ? 'zh' : 'en';
  }

  setUILanguage(lang: UILanguageMode): void {
    this.setPref('uiLanguage', lang);
    this.windows.relabelAllWindows();
  }

  getString(id: string): string {
    const lang = this.getUILang();
    return UI_STRINGS[lang]?.[id] || UI_STRINGS.en[id] || id;
  }

  getJournals(): JournalSubscription[] {
    try {
      const parsed = JSON.parse(String(this.getPref('journals') || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveJournals(journals: JournalSubscription[]): void {
    this.setPref('journals', JSON.stringify(journals));
  }

  followJournal(journal: JournalSubscription): JournalSubscription[] {
    const { next } = mergeSubscriptions(this.getJournals(), [journal]);
    this.saveJournals(next);
    return next;
  }

  unfollowJournal(issn: string): JournalSubscription[] {
    const journals = this.getJournals().filter((j) => j.issn !== issn);
    this.saveJournals(journals);
    Promise.resolve(this.cache.deleteByISSN(issn)).catch(() => {});
    return journals;
  }

  applyJournalPreset(packId: PresetPackId): JournalSubscription[] {
    const next = applyPresetPack(this.getJournals(), packId);
    this.saveJournals(next);
    return next;
  }

  exportSubscriptionsJSON(): string {
    return JSON.stringify({ schema: 'journalflow-subscriptions-v1', journals: this.getJournals() }, null, 2);
  }

  exportSubscriptionsToFile() {
    return exportSubscriptionsWithPicker(this.exportSubscriptionsJSON(), this.getString('export-subs'));
  }

  async importSubscriptionsFromFile() {
    const picked = await importSubscriptionsWithPicker(this.getString('import-subs'));
    if (!picked.imported || !picked.raw) return picked;
    return { imported: true, path: picked.path, journals: this.importSubscriptionsJSON(picked.raw) };
  }

  importSubscriptionsJSON(raw: string): JournalSubscription[] {
    const { next } = mergeSubscriptions(this.getJournals(), parseSubscriptionsImport(raw));
    this.saveJournals(next);
    return next;
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  getCacheFilePath(): string {
    return this.cache.getCacheFilePath();
  }

  searchJournals(query: string): Promise<JournalSubscription[]> {
    return searchJournals(query);
  }

  getJournalByISSN(issn: string): Promise<JournalSubscription> {
    return getJournalByISSN(issn);
  }

  dedupeArticles(articles: JournalArticle[]): JournalArticle[] {
    return dedupeArticles(articles);
  }

  getFeed(issn: string, options: { force?: boolean } = {}): Promise<JournalArticle[]> {
    return this.feedCoordinator.getFeed(issn, options);
  }

  enrichFeedMetadata(articles: JournalArticle[], onUpdated?: (article: JournalArticle) => void): Promise<JournalArticle[]> {
    return this.feedCoordinator.enrichFeedMetadata(articles, onUpdated);
  }

  enrichFeedAbstracts(articles: JournalArticle[], onRecovered?: (article: JournalArticle) => void): Promise<JournalArticle[]> {
    return this.feedCoordinator.enrichFeedAbstracts(articles, onRecovered);
  }

  enrichSingleArticle(article: JournalArticle): Promise<boolean> {
    return this.feedCoordinator.enrichSingleArticle(article);
  }

  fetchFullTextXML(pmcid: string): Promise<string> {
    return httpGetText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`);
  }

  figureImageURLs(pmcid: string, graphicHref: string): string[] {
    return figureImageURLs(pmcid, graphicHref);
  }

  getVisualSourcePages(article: JournalArticle, options: { includeUnpaywall?: boolean } = {}): Promise<string[]> {
    return getVisualSourcePages(article, options);
  }

  fetchArticleHTML(url: string): Promise<{ text: string; url: string }> {
    return httpGetHTML(url);
  }

  getTranslationTarget(text: string): UILanguage {
    return computeTarget(text, this.getUILang());
  }

  translateText(text: string, target: UILanguage): Promise<string> {
    const provider = String(this.getPref('translateProvider') || 'pdftranslate') as TranslateProvider;
    const llmConfig = {
      endpoint: String(this.getPref('llmEndpoint') || ''),
      apiKey: String(this.getPref('llmApiKey') || ''),
      model: String(this.getPref('llmModel') || ''),
    };
    return runTranslate(text, target, provider, (msg) => Zotero?.debug?.(msg), llmConfig, typeof Zotero !== 'undefined' ? Zotero : undefined);
  }

  addToZoteroByDOI(doi: string): Promise<unknown[]> {
    return addToZoteroByDOI(doi);
  }

  importArticleToZotero(
    article: JournalArticle,
    options: { collectionID?: number | null } = {}
  ): Promise<{ itemID: number | null; usedFallback: boolean }> {
    return importArticleToZotero(article, options);
  }

  getExistingLibraryDOIs(dois: string[]): Promise<Record<string, number>> {
    return getExistingLibraryDOIs(dois);
  }

  getUserCollections(): { collections: ZoteroCollectionSummary[]; activeCollectionID: number | null } {
    return getUserCollections();
  }

  selectLibraryItem(itemID: number): void {
    selectLibraryItem(itemID);
  }

  openPreferences(win?: unknown): void {
    openPreferencesPane(win);
  }

  isArticleRead(article: Pick<JournalArticle, 'doi' | 'title'>): boolean {
    return this.readingState.isRead(articleStateKey(article.doi, article.title));
  }

  setArticleRead(article: Pick<JournalArticle, 'doi' | 'title'>, value: boolean): Promise<void> {
    return this.readingState.setRead(articleStateKey(article.doi, article.title), value);
  }

  isArticleStarred(article: Pick<JournalArticle, 'doi' | 'title'>): boolean {
    return this.readingState.isStarred(articleStateKey(article.doi, article.title));
  }

  toggleArticleStarred(article: Pick<JournalArticle, 'doi' | 'title'>): Promise<boolean> {
    return this.readingState.toggleStarred(articleStateKey(article.doi, article.title));
  }

  getCachedTranslation(
    article: Pick<JournalArticle, 'doi' | 'title'>,
    lang: UILanguage
  ): ArticleTranslation | undefined {
    return this.readingState.getTranslation(articleStateKey(article.doi, article.title), lang);
  }

  cacheTranslation(
    article: Pick<JournalArticle, 'doi' | 'title'>,
    lang: UILanguage,
    tx: ArticleTranslation
  ): Promise<void> {
    return this.readingState.setTranslation(articleStateKey(article.doi, article.title), lang, tx);
  }

  openURL(url: string): void {
    openExternalURL(url);
  }

  getWindowMode(): WindowOpenMode {
    return this.windows.getWindowMode();
  }

  switchWindowMode(mode: WindowOpenMode, win?: unknown, launchState?: WorkbenchLaunchState): void {
    this.windows.switchWindowMode(mode, win, launchState);
  }

  openWorkbench(win?: unknown, launchState?: WorkbenchLaunchState): void {
    this.windows.openWorkbench(win, launchState);
  }

  getLocalDateKey(): string {
    return localDateKey();
  }
}

export const instance = new JournalFlowHost();

if (typeof Zotero !== 'undefined') {
  Zotero.JournalFlow = instance;
  Promise.resolve(instance.init()).catch((error) => {
    Zotero?.logError?.(`[JournalFlow] init failed: ${error}`);
  });
}

export default instance;
