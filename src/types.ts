export type UILanguage = 'en' | 'zh';
export type UILanguageMode = 'auto' | UILanguage;
export type WindowOpenMode = 'tab' | 'window';
export type TranslateProvider = 'google' | 'mymemory' | 'openai';
export type ArticleFilterMode = 'all' | 'oa' | 'abstract' | 'figures' | 'unread' | 'starred';
export type PresetPackId = 'top' | 'aps' | 'acs' | 'wiley' | 'springer' | 'rsc' | 'elsevier' | 'ieee';
export type JournalFetchState = 'idle' | 'loading' | 'ok' | 'error';

export interface JournalFeedStatus {
  state: JournalFetchState;
  count?: number;
  updatedAt?: number;
  error?: string;
}

export interface ZoteroCollectionSummary {
  id: number;
  name: string;
}

export type FeedScopeType = 'all' | 'publisher' | 'issn';

export interface FeedScope {
  type: FeedScopeType;
  id: string | null;
}

export interface WorkbenchLaunchState {
  activeISSN?: string | null;
  activeScope?: FeedScope;
  articleQuery?: string;
}

export interface JournalSubscription {
  issn: string;
  title: string;
  publisher?: string;
  altIssns?: string[];
}

export interface FigureLabelInfo {
  kind: 'main' | 'extended' | 'supplementary';
  group: number;
  number: number;
  suffix: string;
  key: string;
  label: string;
}

export interface ArticleFigure {
  label: string;
  caption: string;
  urls: string[];
  labelInfo?: FigureLabelInfo | null;
  width?: number;
  height?: number;
  metaLabel?: string;
  urlHint?: string;
  url?: string;
}

export interface ArticleTranslation {
  title: string;
  abstract: string;
}

export interface JournalArticle {
  doi: string;
  title: string;
  authors: string;
  journal: string;
  issn: string;
  date: string;
  volume: string;
  issue: string;
  pages: string;
  abstract: string;
  abstractSource: string;
  url: string;
  fullTextLinks: string[];
  pmcid: string | null;
  pubTypes: string[];
  isOpenAccess: boolean;
  figures: ArticleFigure[] | null;
  graphicalAbstract: ArticleFigure | null;
  _unpaywall?: UnpaywallRecord | null;
  _tx?: Partial<Record<UILanguage, ArticleTranslation>>;
  _translationTarget?: UILanguage;
  _showTranslated?: boolean;
  _read?: boolean;
  _starred?: boolean;
  _libraryItemID?: number | null;
  _selected?: boolean;
}

export interface UnpaywallLocation {
  url?: string;
  url_for_landing_page?: string;
}

export interface UnpaywallRecord {
  is_oa?: boolean;
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

export interface DailyFeedCacheEntry {
  issn: string;
  time: number;
  articles: JournalArticle[];
}

export interface DailyFeedCacheDocument {
  schema: string;
  day: string;
  entries: Record<string, DailyFeedCacheEntry>;
}

export interface JournalFlowPreferencesService {
  id: string | null;
  version: string | null;
  rootURI: string | null;
  getUILang(): UILanguage;
  getUILanguageMode(): UILanguageMode;
  setUILanguage(lang: UILanguageMode): void;
  getString(id: string): string;
  getPref(key: string): unknown;
  setPref(key: string, value: unknown): void;
  openPreferences(win?: unknown): void;
  openURL(url: string): void;
  getWindowMode(): WindowOpenMode;
  switchWindowMode(mode: WindowOpenMode, win?: unknown, launchState?: WorkbenchLaunchState): void;
  openWorkbench(win?: unknown, launchState?: WorkbenchLaunchState): void;
}

export interface JournalFlowSubscriptionService {
  getJournals(): JournalSubscription[];
  saveJournals(journals: JournalSubscription[]): void;
  followJournal(journal: JournalSubscription): JournalSubscription[];
  unfollowJournal(issn: string): JournalSubscription[];
  applyJournalPreset(packId: PresetPackId): JournalSubscription[];
  exportSubscriptionsJSON(): string;
  importSubscriptionsJSON(raw: string): JournalSubscription[];
  searchJournals(query: string): Promise<JournalSubscription[]>;
  getJournalByISSN(issn: string): Promise<JournalSubscription>;
}

export interface JournalFlowFeedService {
  getFeed(issn: string, options?: { force?: boolean }): Promise<JournalArticle[]>;
  clearCache(): Promise<void> | void;
  getCacheFilePath(): string;
  enrichFeedMetadata(
    articles: JournalArticle[],
    onUpdated?: (article: JournalArticle) => void
  ): Promise<JournalArticle[]>;
  enrichFeedAbstracts(
    articles: JournalArticle[],
    onRecovered?: (article: JournalArticle) => void
  ): Promise<JournalArticle[]>;
  enrichSingleArticle(article: JournalArticle): Promise<boolean>;
  dedupeArticles(articles: JournalArticle[]): JournalArticle[];
  fetchFullTextXML(pmcid: string): Promise<string>;
  figureImageURLs(pmcid: string, graphicHref: string): string[];
  getVisualSourcePages(article: JournalArticle, options?: { includeUnpaywall?: boolean }): Promise<string[]>;
  fetchArticleHTML(url: string): Promise<{ text: string; url: string }>;
  isArticleRead(article: Pick<JournalArticle, 'doi' | 'title'>): boolean;
  setArticleRead(article: Pick<JournalArticle, 'doi' | 'title'>, value: boolean): Promise<void>;
  isArticleStarred(article: Pick<JournalArticle, 'doi' | 'title'>): boolean;
  toggleArticleStarred(article: Pick<JournalArticle, 'doi' | 'title'>): Promise<boolean>;
}

export interface JournalFlowTranslationService {
  getTranslationTarget(text: string): UILanguage;
  translateText(text: string, target: UILanguage): Promise<string>;
  getCachedTranslation(
    article: Pick<JournalArticle, 'doi' | 'title'>,
    lang: UILanguage
  ): ArticleTranslation | undefined;
  cacheTranslation(
    article: Pick<JournalArticle, 'doi' | 'title'>,
    lang: UILanguage,
    tx: ArticleTranslation
  ): Promise<void>;
}

export interface JournalFlowZoteroService {
  addToZoteroByDOI(doi: string): Promise<unknown[]>;
  importArticleToZotero(
    article: JournalArticle,
    options?: { collectionID?: number | null }
  ): Promise<{ itemID: number | null; usedFallback: boolean }>;
  getExistingLibraryDOIs(dois: string[]): Promise<Record<string, number>>;
  getUserCollections(): { collections: ZoteroCollectionSummary[]; activeCollectionID: number | null };
  selectLibraryItem(itemID: number): void;
}

export interface JournalFlowService
  extends JournalFlowPreferencesService,
    JournalFlowSubscriptionService,
    JournalFlowFeedService,
    JournalFlowTranslationService,
    JournalFlowZoteroService {}
