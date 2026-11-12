import type {
  ArticleFilterMode,
  ArticleFigure,
  ArticleSortMode,
  FeedScope,
  JournalArticle,
  JournalFeedStatus,
  JournalFlowService,
  JournalSubscription,
  WindowOpenMode,
  WorkbenchLaunchState,
} from '../types';

export interface FeedHostContext {
  Zotero: any;
  JournalFlow: JournalFlowService;
  windowMode?: WindowOpenMode;
  initialState?: WorkbenchLaunchState;
}

export interface LightboxDragState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

export interface FeedScopeState {
  journals: JournalSubscription[];
  activeScope: FeedScope;
  activeISSN: string | null;
  collapsedPublishers: Set<string>;
  followedFilterQuery: string;
  journalCounts: Record<string, number>;
  journalStatus: Record<string, JournalFeedStatus>;
  isRefreshing: boolean;
}

export interface FeedViewState {
  articles: JournalArticle[];
  figureObserver: IntersectionObserver | null;
  articleQuery: string;
  filterMode: ArticleFilterMode;
  sortMode: ArticleSortMode;
  focusedArticleKey: string | null;
  visibleLimit: number;
  loadGeneration: number;
  bulkTranslationRunning: boolean;
  primeTimer: number | null;
  noticeTimer: number | null;
}

export interface LibraryImportState {
  selectedKeys: Set<string>;
  targetCollectionID: number | null;
  collectionsLoaded: boolean;
}

export interface LightboxState {
  lightboxFigures: ArticleFigure[];
  lightboxIndex: number;
  lightboxZoom: number;
  lightboxPanX: number;
  lightboxPanY: number;
  lightboxDrag: LightboxDragState | null;
  lightboxLightCanvas: boolean;
}

export interface FeedUIState extends FeedScopeState, FeedViewState, LibraryImportState, LightboxState {}

export function setScope(state: Pick<FeedScopeState, 'activeScope' | 'activeISSN'>, scope: FeedScope): void {
  state.activeScope = scope;
  state.activeISSN = scope.type === 'issn' ? scope.id : null;
}

export function createFeedScopeState(): FeedScopeState {
  return {
    journals: [],
    activeScope: { type: 'all', id: null },
    activeISSN: null,
    collapsedPublishers: new Set<string>(),
    followedFilterQuery: '',
    journalCounts: {},
    journalStatus: {},
    isRefreshing: false,
  };
}

export function createFeedViewState(): FeedViewState {
  return {
    articles: [],
    figureObserver: null,
    articleQuery: '',
    filterMode: 'all',
    sortMode: 'newest',
    focusedArticleKey: null,
    visibleLimit: 40,
    loadGeneration: 0,
    bulkTranslationRunning: false,
    primeTimer: null,
    noticeTimer: null,
  };
}

export function createLibraryImportState(): LibraryImportState {
  return {
    selectedKeys: new Set<string>(),
    targetCollectionID: null,
    collectionsLoaded: false,
  };
}

export function createLightboxState(): LightboxState {
  return {
    lightboxFigures: [],
    lightboxIndex: 0,
    lightboxZoom: 1,
    lightboxPanX: 0,
    lightboxPanY: 0,
    lightboxDrag: null,
    lightboxLightCanvas: true,
  };
}

export function createInitialFeedState(): FeedUIState {
  return {
    ...createFeedScopeState(),
    ...createFeedViewState(),
    ...createLibraryImportState(),
    ...createLightboxState(),
  };
}

export function resolveFeedContext(win: any = globalThis): FeedHostContext | null {
  const fromArgs = win?.arguments?.[0];
  if (fromArgs?.JournalFlow && fromArgs?.Zotero) {
    return fromArgs as FeedHostContext;
  }
  const injected = win?.__JournalFlowContext || win?.wrappedJSObject?.__JournalFlowContext;
  if (injected?.JournalFlow && injected?.Zotero) {
    return injected as FeedHostContext;
  }
  const wmZot = (() => {
    try {
      return win?.Services?.wm?.getMostRecentWindow?.('navigator:browser')?.Zotero || null;
    } catch {
      return null;
    }
  })();
  const zot =
    win?.Zotero ||
    win?.wrappedJSObject?.Zotero ||
    win?.opener?.Zotero ||
    win?.parent?.Zotero ||
    win?.top?.Zotero ||
    wmZot ||
    (globalThis as any).Zotero ||
    null;
  const jf =
    zot?.JournalFlow ||
    win?.JournalFlow ||
    win?.opener?.JournalFlow ||
    win?.parent?.JournalFlow ||
    null;
  if (zot && jf) {
    return {
      Zotero: zot,
      JournalFlow: jf,
      windowMode: injected?.windowMode,
      initialState: injected?.initialState,
    };
  }
  return null;
}

export function getString(ctx: FeedHostContext, id: string): string {
  return ctx.JournalFlow.getString(id);
}

export function showNotice(
  doc: Document,
  state: Pick<FeedViewState, 'noticeTimer'>,
  message: string,
  kind: 'error' | 'warn' = 'error'
): void {
  const notice = doc.getElementById('notice');
  if (!notice) return;
  if (state.noticeTimer !== null) {
    clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }
  notice.className = kind;
  notice.textContent = message;
  notice.hidden = false;
  state.noticeTimer = (doc.defaultView || globalThis).setTimeout(() => {
    notice.hidden = true;
    state.noticeTimer = null;
  }, 6000) as unknown as number;
}

export function clearNotice(doc: Document, state: Pick<FeedViewState, 'noticeTimer'>): void {
  if (state.noticeTimer !== null) {
    clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }
  const notice = doc.getElementById('notice');
  if (notice) {
    notice.hidden = true;
    notice.textContent = '';
    notice.className = '';
  }
}

export function populateCollectionSelector(
  doc: Document,
  ctx: FeedHostContext,
  state: LibraryImportState,
  forceRefresh = false
): void {
  const select = doc.getElementById('collection-select') as HTMLSelectElement | null;
  if (!select || (state.collectionsLoaded && !forceRefresh) || typeof ctx.JournalFlow.getUserCollections !== 'function') {
    return;
  }
  state.collectionsLoaded = true;
  const { collections } = ctx.JournalFlow.getUserCollections();
  select.replaceChildren();
  const rootOpt = doc.createElement('option');
  rootOpt.id = 'collection-root-opt';
  rootOpt.value = '';
  rootOpt.textContent = getString(ctx, 'collection-root');
  select.appendChild(rootOpt);
  for (const col of collections) {
    const opt = doc.createElement('option');
    opt.value = String(col.id);
    opt.textContent = col.name;
    select.appendChild(opt);
  }
  if (state.targetCollectionID && !collections.some((c) => c.id === state.targetCollectionID)) {
    state.targetCollectionID = null;
  }
  select.value = state.targetCollectionID ? String(state.targetCollectionID) : '';
}
