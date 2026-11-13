import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ROOT, loadTsModule, toPlain } from './helpers.mjs';

function flushMicrotasks(ms = 35) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMemoryIOUtils() {
  const files = new Map();
  let writeCount = 0;
  return {
    files,
    getWriteCount: () => writeCount,
    IOUtils: {
      async makeDirectory() {},
      async readUTF8(filePath) {
        if (!files.has(filePath)) throw new Error('ENOENT');
        return files.get(filePath);
      },
      async writeUTF8(filePath, content) {
        writeCount += 1;
        files.set(filePath, content);
      },
    },
    PathUtils: {
      join: (...parts) => parts.join('/'),
    },
  };
}

test('ReadingStateStore.setReadMany coalesces disk writes and FeedCoordinator hydrates _tx', async () => {
  const mem = createMemoryIOUtils();
  const globals = {
    Zotero: { DataDirectory: { dir: 'Z:/mock' } },
    IOUtils: mem.IOUtils,
    PathUtils: mem.PathUtils,
  };
  const { ReadingStateStore, articleStateKey } = loadTsModule('src/services/readingState.ts', globals);
  const { FeedCoordinator } = loadTsModule('src/host/feedCoordinator.ts');

  const store = new ReadingStateStore();
  await store.ensureLoaded();
  await store.setTranslation('doi:10.1000/tx', 'zh', { title: '莫尔超晶格', abstract: '相关激子研究' });
  const writesBeforeBatch = mem.getWriteCount();

  await store.setReadMany(['doi:10.1000/tx', 'doi:10.1000/b', 'doi:10.1000/c'], true);
  assert.equal(mem.getWriteCount() - writesBeforeBatch, 1);
  assert.equal(store.isRead('doi:10.1000/b'), true);
  assert.equal(store.isRead('doi:10.1000/c'), true);

  const coord = new FeedCoordinator(
    { getArticles() { return []; }, setArticles() {} },
    store,
    () => '',
    () => [],
    () => false
  );
  const article = {
    doi: '10.1000/tx',
    title: 'Moiré Superlattices',
    authors: 'A. Author',
    journal: 'Nature',
    issn: '0028-0836',
    date: '2026-11-12',
    volume: '1',
    issue: '1',
    pages: '1-5',
    abstract: 'Correlated excitons.',
    abstractSource: 'crossref',
    url: 'https://doi.org/10.1000/tx',
    fullTextLinks: [],
    pmcid: null,
    pubTypes: [],
    isOpenAccess: true,
    figures: [],
    graphicalAbstract: null,
  };
  assert.equal(articleStateKey(article.doi), 'doi:10.1000/tx');
  coord.stampReadingState([article]);
  assert.equal(article._read, true);
  assert.deepEqual(toPlain(article._tx), { zh: { title: '莫尔超晶格', abstract: '相关激子研究' } });
});

test('zoteroImport.getExistingLibraryDOIs queries SQLite in batches with URL variants', async () => {
  const queries = [];
  const Zotero = {
    Libraries: { userLibraryID: 1 },
    ItemFields: { getID: (name) => (name === 'DOI' ? 26 : 0) },
    DB: {
      async queryAsync(sql, params) {
        queries.push({ sql, params });
        return [
          { itemID: 101, value: 'https://doi.org/10.1038/a' },
          { itemID: 202, value: '10.1126/B' },
        ];
      },
    },
  };
  const { getExistingLibraryDOIs } = loadTsModule('src/host/zoteroImport.ts', { Zotero });
  const existing = await getExistingLibraryDOIs([
    '10.1038/A',
    'https://doi.org/10.1126/b',
    '10.1000/missing',
  ]);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /LOWER\(idv\.value\) IN/);
  assert.ok(queries[0].params.includes('10.1038/a'));
  assert.ok(queries[0].params.includes('https://doi.org/10.1038/a'));
  assert.ok(queries[0].params.includes('https://dx.doi.org/10.1038/a'));
  assert.equal(existing['10.1038/a'], 101);
  assert.equal(existing['10.1126/b'], 202);
  assert.equal(existing['10.1000/missing'], undefined);
});

test('figureStrip.loadFiguresForCard dedupes concurrent calls and expires host cooldown', async () => {
  let fetchCount = 0;
  let now = 1_000_000;
  const origDateNow = Date.now;
  Date.now = () => now;
  try {
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="strip"></div></body></html>');
    const doc = dom.window.document;
    const stripEl = doc.getElementById('strip');

    const mod = loadTsModule('src/ui/figureStrip.ts', {
      window: dom.window,
      document: doc,
      Date,
      fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    });

    const article = {
      doi: '10.1000/fig',
      title: 'Figures Paper',
      authors: '',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-12',
      volume: '',
      issue: '',
      pages: '',
      abstract: '',
      abstractSource: '',
      url: 'https://doi.org/10.1000/fig',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: [],
      isOpenAccess: false,
      figures: null,
      graphicalAbstract: null,
    };

    let resolveFetch;
    const ctx = {
      JournalFlow: {
        getString: (k) => k,
        getVisualSourcePages: async () => {
          fetchCount += 1;
          await new Promise((r) => { resolveFetch = r; });
          return [];
        },
      },
    };
    const card1 = { _article: article, _figuresEl: stripEl, _figuresRequested: false };
    const card2 = { _article: article, _figuresEl: doc.createElement('div'), _figuresRequested: false };

    const p1 = mod.loadFiguresForCard(doc, ctx, card1, () => {});
    const p2 = mod.loadFiguresForCard(doc, ctx, card2, () => {});
    await flushMicrotasks(15);
    assert.equal(fetchCount, 1);
    resolveFetch();
    await Promise.all([p1, p2]);

    mod.recordImageHostTimeout('slow-cdn.example.org', now);
    mod.recordImageHostTimeout('slow-cdn.example.org', now);
    assert.equal(mod.isImageHostCoolingDown('slow-cdn.example.org', now), false);
    mod.recordImageHostTimeout('slow-cdn.example.org', now);
    assert.equal(mod.isImageHostCoolingDown('slow-cdn.example.org', now), true);
    now += 5 * 60 * 1000 + 1;
    assert.equal(mod.isImageHostCoolingDown('slow-cdn.example.org', now), false);
  } finally {
    Date.now = origDateNow;
  }
});

test('feedLoad preserves expanded abstract in default mode, persists sortMode, and scopes bulk actions', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'chrome/content/feed.xhtml'), 'utf8')
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/<script[^>]*><\/script>/gi, '');
  const dom = new JSDOM(html, { url: 'https://journalflow.local/', runScripts: 'dangerously' });
  const { window } = dom;
  const doc = window.document;

  const articles = [
    {
      doi: '10.1000/1',
      title: 'Unread Quantum Paper',
      authors: 'A. Author',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-12',
      volume: '1',
      issue: '1',
      pages: '1-5',
      abstract: 'First sentence of a very long abstract. '.repeat(12),
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1000/1',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: [],
      isOpenAccess: true,
      figures: [],
      graphicalAbstract: null,
      _read: false,
      _starred: false,
    },
    {
      doi: '10.1000/2',
      title: 'Already Read Paper',
      authors: 'B. Author',
      journal: 'Science',
      issn: '0036-8075',
      date: '2026-11-11',
      volume: '2',
      issue: '1',
      pages: '6-10',
      abstract: 'Read abstract content.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1000/2',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: [],
      isOpenAccess: false,
      figures: [],
      graphicalAbstract: null,
      _read: true,
      _starred: false,
    },
  ];

  const translatedTexts = [];
  let bulkReadArgs = null;

  const JournalFlow = {
    getUILang: () => 'en',
    getUILanguageMode: () => 'en',
    setUILanguage: () => {},
    getWindowMode: () => 'tab',
    getString: (k) => k,
    getPref: (k) => (k === 'loadFigures' ? false : true),
    getJournals: () => [
      { title: 'Nature', issn: '0028-0836', publisher: 'Springer Nature' },
      { title: 'Science', issn: '0036-8075', publisher: 'AAAS' },
    ],
    getFeed: async (issn) => articles.filter((a) => a.issn === issn),
    dedupeArticles: (arr) => arr,
    enrichFeedMetadata: async () => 1,
    enrichFeedAbstracts: async () => 0,
    getExistingLibraryDOIs: async () => ({}),
    getUserCollections: () => ({ collections: [], activeCollectionID: null }),
    getTranslationTarget: () => 'zh',
    setArticlesRead: async (list, value) => { bulkReadArgs = { count: list.length, value }; },
    setArticleRead: async () => {},
    translateText: async (text) => {
      translatedTexts.push(text);
      return `译:${text.slice(0, 12)}`;
    },
  };

  window.__JournalFlowContext = { Zotero: { debug: () => {} }, JournalFlow };
  window.sessionStorage.setItem('journalflow.sortMode', 'title');
  const scriptCode = fs.readFileSync(path.join(ROOT, 'chrome/content/scripts/feed.js'), 'utf8');
  window.eval(scriptCode);
  await flushMicrotasks(80);

  // sessionStorage restored sortMode = 'title'
  assert.equal(doc.getElementById('article-sort-select').value, 'title');

  // Expand abstract on first card and confirm background metadata enrichment does not collapse it
  const expandBtn = doc.querySelector('.abstract-toggle');
  assert.ok(expandBtn);
  expandBtn.click();
  await flushMicrotasks(20);
  assert.equal(doc.querySelector('.card-abstract')?.classList.contains('clamped'), false);

  // Filter to unread -> only 10.1000/1 is visible; translateAll only translates visible filtered article (title + abstract)
  doc.getElementById('filter-unread-btn').click();
  await flushMicrotasks(20);
  doc.getElementById('translate-all-btn').click();
  await flushMicrotasks(40);
  assert.equal(translatedTexts.length, 2);
  assert.equal(translatedTexts[0], 'Unread Quantum Paper');

  // Mark scope read uses batch setArticlesRead
  doc.getElementById('mark-scope-read-btn').click();
  await flushMicrotasks(20);
  assert.deepEqual(bulkReadArgs, { count: 1, value: true });
});

test('advanceFocusBeforeRemoval moves keyboard focus to next card before filtered removal', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="cards">
      <article class="card" data-sel-key="doi:10.1000/1"></article>
      <article class="card" data-sel-key="doi:10.1000/2"></article>
    </div>
  </body></html>`);
  const doc = dom.window.document;
  const mod = loadTsModule('src/ui/keyboardNav.ts', { window: dom.window, document: doc });
  const state = { focusedArticleKey: 'doi:10.1000/1' };
  mod.advanceFocusBeforeRemoval(doc, state, 'doi:10.1000/1');
  assert.equal(state.focusedArticleKey, 'doi:10.1000/2');
});

test('DailyFeedCacheStore creates daily incremental caches and cleans expired entries weekly', async () => {
  const mem = createMemoryIOUtils();
  let now = 1_760_000_000_000;
  const origDateNow = Date.now;
  Date.now = () => now;
  try {
    const cacheMod = loadTsModule('src/services/cache.ts', {
      Date,
      Zotero: { DataDirectory: { dir: 'Z:/mock' }, debug: () => {} },
      IOUtils: mem.IOUtils,
      PathUtils: mem.PathUtils,
    });
    const store = new cacheMod.DailyFeedCacheStore();
    const day1Key = cacheMod.feedCacheKey('0028-0836', 200, 14, true, cacheMod.localDateKey(new Date(now)));
    await store.setPersisted(day1Key, '0028-0836', [
      { doi: '10.1038/old', title: 'Old Enriched', abstract: 'Recovered abstract', abstractSource: 'epmc', pmcid: 'PMC123', date: '2026-11-10' },
    ]);

    // Advance 2 days (< 7 days): new day gets a brand-new cache key while Day 1 entry is retained
    now += 2 * 24 * 60 * 60 * 1000;
    const day3Key = cacheMod.feedCacheKey('0028-0836', 200, 14, true, cacheMod.localDateKey(new Date(now)));
    assert.notEqual(day3Key, day1Key);
    const baseEntry = await store.getLatestByParams('0028-0836', 200, 14, true);
    assert.ok(baseEntry);
    assert.equal(baseEntry.articles[0].doi, '10.1038/old');

    // Within the same day: incremental merge updates today's key and preserves enriched fields
    const merged = cacheMod.mergeIncrementalArticles(
      baseEntry.articles,
      [{ doi: '10.1038/old', title: 'Old Enriched', abstract: '', date: '2026-11-10' }, { doi: '10.1038/today', title: 'Today Paper', date: '2026-11-12' }]
    );
    await store.setPersisted(day3Key, '0028-0836', merged);
    assert.equal(merged.length, 2);
    assert.equal(merged.find((a) => a.doi === '10.1038/old').abstract, 'Recovered abstract');
    assert.equal(merged.find((a) => a.doi === '10.1038/old').pmcid, 'PMC123');
    assert.ok(await store.getPersisted(day1Key, { allowStale: true }));

    // Advance past 7 days: weekly cleanup prunes entries older than 7 days
    now += 6 * 24 * 60 * 60 * 1000;
    const day9Key = cacheMod.feedCacheKey('0036-8075', 200, 14, true, cacheMod.localDateKey(new Date(now)));
    await store.setPersisted(day9Key, '0036-8075', [
      { doi: '10.1126/new2', title: 'Week 2 Science', date: '2026-11-18' },
    ]);
    assert.equal(await store.getPersisted(day1Key, { allowStale: true }), null);
    assert.ok(await store.getPersisted(day3Key, { allowStale: true }));
    assert.ok(await store.getPersisted(day9Key, { allowStale: true }));
  } finally {
    Date.now = origDateNow;
  }
});

test('DailyFeedCacheStore evicts oldest non-today entries when exceeding byte cap and S2 stops on 429', async () => {
  const mem = createMemoryIOUtils();
  const cacheMod = loadTsModule('src/services/cache.ts', {
    Zotero: { DataDirectory: { dir: 'Z:/mock' }, debug: () => {} },
    IOUtils: mem.IOUtils,
    PathUtils: mem.PathUtils,
  });
  const store = new cacheMod.DailyFeedCacheStore();
  const doc = {
    schema: 'daily-feed-v2',
    day: '2026-11-13',
    lastWeeklyCleanupTime: Date.now(),
    entries: {
      'old-1': { issn: '0001-0001', day: '2026-11-10', time: 1000, articles: [{ doi: '10.1/a', title: 'x'.repeat(200) }] },
      'today-1': { issn: '0002-0002', day: '2026-11-13', time: 2000, articles: [{ doi: '10.1/b', title: 'Today' }] },
    },
  };
  const raw = store.evictOldestToFit(doc, 320);
  assert.ok(raw.length <= 320);
  assert.equal(doc.entries['old-1'], undefined);
  assert.ok(doc.entries['today-1']);

  let s2Calls = 0;
  const s2Mod = loadTsModule('src/services/semanticScholar.ts', {
    Zotero: {
      debug: () => {},
      HTTP: {
        request: async () => {
          s2Calls += 1;
          const err = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        },
      },
    },
  });
  const manyArticles = Array.from({ length: 85 }, (_, i) => ({
    doi: `10.1000/s2-${i}`,
    title: `Paper ${i}`,
    abstract: '',
    isOpenAccess: false,
    fullTextLinks: [],
  }));
  await s2Mod.enrichWithSemanticScholar(manyArticles);
  // 429 triggers host block on first batch (with 1 retry -> 2 calls), then aborts remaining batches
  assert.equal(s2Calls, 2);
});

test('translateText chunks long abstracts when using Zotero PDF Translate', async () => {
  const calls = [];
  const txMod = loadTsModule('src/services/translation.ts', {
    Zotero: {
      PDFTranslate: {
        api: {
          translate: async (chunk) => {
            calls.push(chunk.length);
            return '这是中文翻译片段。';
          },
        },
      },
    },
  });
  const longAbstract = 'This is a scientific sentence about quantum materials. '.repeat(45);
  assert.ok(longAbstract.length > 1800);
  const res = await txMod.translateText(longAbstract, 'zh', 'pdftranslate');
  assert.ok(calls.length >= 2);
  assert.match(res, /这是中文翻译片段/);
});
