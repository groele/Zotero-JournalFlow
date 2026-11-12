import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ROOT, createPrefStore, loadTsModule, toPlain } from './helpers.mjs';

function flushMicrotasks(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('scientificText converts XML/HTML sub/sup tags into Unicode subscripts and superscripts', () => {
  const crossref = loadTsModule('src/services/crossref.ts');
  assert.equal(
    crossref.stripJATS(
      '<jats:p>CO<sub>2</sub> reduction over Fe<jats:sup>3+</jats:sup> at T<sub>c</sub> = 10<sup>-4</sup> K</jats:p>'
    ),
    'CO₂ reduction over Fe³⁺ at T_c = 10⁻⁴ K'
  );
  // Verify numeric/ion subscripts & superscripts precisely
  const sci = loadTsModule('src/services/scientificText.ts');
  assert.equal(sci.formatScientificTags('H<sub>2</sub>O and Fe<sup>3+</sup> + e<sup>-</sup>'), 'H₂O and Fe³⁺ + e⁻');
  assert.equal(sci.formatScientificTags('10<sup>-4</sup> M Ti<sub>3</sub>C<sub>2</sub>'), '10⁻⁴ M Ti₃C₂');
});

test('crossref dateFromParts prefers YYYY-MM[-DD] over year-only issued and filtering retains current year-only items', () => {
  const crossref = loadTsModule('src/services/crossref.ts');
  const filtering = loadTsModule('src/services/filtering.ts');

  const date = crossref.dateFromParts({
    issued: { 'date-parts': [[2026]] },
    created: { 'date-parts': [[2026, 11, 10]] },
  });
  assert.equal(date, '2026-11-10');

  const currentYear = String(new Date().getFullYear());
  const oldYear = String(new Date().getFullYear() - 3);
  const kept = filtering.filterRecentDays(
    [
      { doi: '10.1/yr-cur', title: 'Year Only Current', date: currentYear },
      { doi: '10.1/yr-old', title: 'Year Only Old', date: oldYear },
    ],
    14
  );
  assert.deepEqual(toPlain(kept.map((a) => a.doi)), ['10.1/yr-cur']);
});

test('http retries on 429 and circuit-breaks host upon Cloudflare challenge HTML', async () => {
  let fetchCalls = 0;
  const mockFetch = async (url) => {
    fetchCalls++;
    if (url.includes('retry-test')) {
      if (fetchCalls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '1' },
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: () => 'application/json' },
        text: async () => '{"ok":true}',
      };
    }
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => 'text/html' },
      text: async () => '<html><title>Just a moment...</title><div>cf-browser-verification</div></html>',
    };
  };

  const http = loadTsModule('src/services/http.ts', { fetch: mockFetch });
  const data = await http.httpGetJSON('https://api.example.org/retry-test', { retries: 1 });
  assert.deepEqual(toPlain(data), { ok: true });
  assert.equal(fetchCalls, 2);

  await assert.rejects(() => http.httpGetHTML('https://blocked.example.com/paper/1'), /challenge/i);
  assert.equal(http.isHostBlocked('https://blocked.example.com/paper/2'), true);
  await assert.rejects(() => http.httpGetHTML('https://blocked.example.com/paper/2'), /temporarily skipped/i);
  assert.equal(fetchCalls, 3);
});

test('semanticScholar batch enrichment recovers abstract, OA flag, and PDF link', async () => {
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.ids, ['DOI:10.1021/jacs.1']);
    return {
      ok: true,
      status: 200,
      url: _url,
      text: async () =>
        JSON.stringify([
          {
            abstract:
              'We synthesize a covalent organic framework catalyst achieving record selectivity in aqueous electrocatalysis.',
            isOpenAccess: true,
            openAccessPdf: { url: 'https://oa.example.org/jacs1.pdf' },
          },
        ]),
    };
  };
  const s2 = loadTsModule('src/services/semanticScholar.ts', { fetch: mockFetch });
  const articles = [
    {
      doi: '10.1021/JACS.1',
      title: 'COF Catalysis',
      abstract: '',
      abstractSource: '',
      isOpenAccess: false,
      fullTextLinks: [],
    },
  ];
  await s2.enrichWithSemanticScholar(articles);
  assert.match(articles[0].abstract, /covalent organic framework/);
  assert.equal(articles[0].abstractSource, 'semanticscholar');
  assert.equal(articles[0].isOpenAccess, true);
  assert.ok(articles[0].fullTextLinks.includes('https://oa.example.org/jacs1.pdf'));
});

test('DailyFeedCacheStore supports sliding TTL expiration independent of calendar midnight', async () => {
  const files = new Map();
  const cacheMod = loadTsModule('src/services/cache.ts', {
    Zotero: { DataDirectory: { dir: 'Z:/mock' }, debug() {} },
    PathUtils: { join: (...p) => p.join('/') },
    IOUtils: {
      readUTF8: async (p) => files.get(p),
      writeUTF8: async (p, v) => files.set(p, v),
    },
  });
  const store = new cacheMod.DailyFeedCacheStore();
  const key = cacheMod.feedCacheKey('0031-9007', 200, 14, true);
  store.setMemory(key, [{ title: 'PRL Paper' }], Date.now() - 2 * 3600 * 1000);
  assert.equal(store.getMemory(key, 6 * 3600 * 1000)?.length, 1);
  assert.equal(store.getMemory(key, 1 * 3600 * 1000), null);
});

test('ReadingStateStore persists read, starred, and translated state across reloads', async () => {
  const files = new Map();
  const globals = {
    Zotero: { DataDirectory: { dir: 'Z:/mock' } },
    PathUtils: { join: (...p) => p.join('/') },
    IOUtils: {
      readUTF8: async (p) => {
        if (!files.has(p)) throw new Error('ENOENT');
        return files.get(p);
      },
      writeUTF8: async (p, v) => files.set(p, v),
    },
  };
  const rs1 = loadTsModule('src/services/readingState.ts', globals);
  const store1 = new rs1.ReadingStateStore();
  const key = rs1.articleStateKey('https://doi.org/10.1002/ADMA.20260001');
  await store1.setRead(key, true);
  await store1.toggleStarred(key);
  await store1.setTranslation(key, 'zh', { title: '中文标题', abstract: '中文摘要' });

  const store2 = new rs1.ReadingStateStore();
  await store2.ensureLoaded();
  assert.equal(store2.isRead(key), true);
  assert.equal(store2.isStarred(key), true);
  assert.deepEqual(toPlain(store2.getTranslation(key, 'zh')), { title: '中文标题', abstract: '中文摘要' });
});

test('BibTeX citation formatting and subscription preset packs + JSON import work cleanly', () => {
  const cit = loadTsModule('src/ui/citation.ts');
  const bib = cit.formatArticleBibTeX({
    doi: '10.1103/PhysRevLett.135.016701',
    title: 'Quantum Spin Liquids in Kitaev Materials',
    authors: 'Ada Lovelace, Alan Turing et al.',
    journal: 'Physical Review Letters',
    date: '2026-11-10',
    volume: '135',
    issue: '1',
    pages: '016701',
    url: 'https://doi.org/10.1103/PhysRevLett.135.016701',
  });
  assert.match(bib, /^@article\{Lovelace2026quantum,/);
  assert.match(bib, /author = \{Ada Lovelace and Alan Turing and others\},/);

  const subs = loadTsModule('src/host/subscriptions.ts');
  const withAps = subs.applyPresetPack([{ issn: '0028-0836', title: 'Nature' }], 'aps');
  assert.ok(withAps.some((j) => j.issn === '0031-9007'));
  const parsed = subs.parseSubscriptionsImport(
    JSON.stringify({ journals: [{ issn: '00027863', title: 'JACS', altIssns: ['15205126'] }] })
  );
  assert.equal(parsed[0].issn, '0002-7863');
  assert.deepEqual(toPlain(parsed[0].altIssns), ['1520-5126']);
});

test('zoteroImport creates native journalArticle item on translator failure and looks up existing library DOIs', async () => {
  const savedItems = [];
  class MockItem {
    constructor(type) {
      this.id = 77;
      this.type = type;
      this.fields = {};
      this.collections = [];
    }
    setField(k, v) {
      this.fields[k] = v;
    }
    setCreators(creators) {
      this.creators = creators;
    }
    addToCollection(id) {
      this.collections.push(id);
    }
    async saveTx() {
      savedItems.push(this);
    }
  }
  const zotMock = {
    Libraries: { userLibraryID: 1 },
    ItemFields: { getID: () => 5 },
    Item: MockItem,
    Translate: {
      Search: class {
        setIdentifier() {}
        async getTranslators() {
          return [];
        }
      },
    },
    DB: {
      queryAsync: async () => [{ itemID: 99, value: 'https://doi.org/10.1038/EXISTING-1' }],
    },
    debug: () => {},
  };
  const zi = loadTsModule('src/host/zoteroImport.ts', { Zotero: zotMock });
  const res = await zi.importArticleToZotero(
    {
      doi: '10.1007/new-1',
      title: 'Fallback Paper',
      authors: 'Marie Curie, Linus Pauling',
      journal: 'Nature Physics',
      issn: '1745-2473',
      date: '2026-11-01',
      volume: '22',
      issue: '4',
      pages: '10-20',
      abstract: 'A complete abstract.',
      url: 'https://doi.org/10.1007/new-1',
    },
    { collectionID: 12 }
  );
  assert.deepEqual(toPlain(res), { itemID: 77, usedFallback: true });
  assert.equal(savedItems[0].fields.title, 'Fallback Paper');
  assert.deepEqual(savedItems[0].collections, [12]);
  assert.equal(savedItems[0].creators.length, 2);

  const existing = await zi.getExistingLibraryDOIs(['10.1038/existing-1']);
  assert.deepEqual(toPlain(existing), { '10.1038/existing-1': 99 });
});

test('preferences pane enables LLM endpoint/key/model controls strictly when translateProvider is openai', async () => {
  const prefStore = createPrefStore({
    'extensions.journalflow.translateProvider': 'google',
    'extensions.journalflow.cacheTTLHours': 12,
  });
  const xhtml = fs.readFileSync(path.join(ROOT, 'chrome/content/preferences.xhtml'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'chrome/content/scripts/preferences.js'), 'utf8');
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${xhtml}</body></html>`, {
    url: 'about:blank',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.Zotero = { Prefs: prefStore.Prefs, logError: () => {} };
  window.eval(bundle);
  await flushMicrotasks();

  const doc = window.document;
  const providerSel = doc.getElementById('pref-translateProvider');
  const keyInput = doc.getElementById('pref-llmApiKey');
  assert.ok(providerSel);
  assert.ok(keyInput);
  assert.equal(keyInput.disabled, true);
  assert.ok(keyInput.closest('.jf-control-row').classList.contains('jf-subordinate-row'));
  assert.ok(keyInput.closest('.jf-control-row').classList.contains('is-disabled'));

  providerSel.value = 'openai';
  providerSel.dispatchEvent(new window.Event('change'));
  await flushMicrotasks();
  assert.equal(keyInput.disabled, false);
  assert.equal(keyInput.closest('.jf-control-row').classList.contains('is-disabled'), false);
});

test('feed.js guards stale journal switches via loadGeneration, filters pills, batches imports, and toggles lightbox canvas', async () => {
  const xhtml = fs
    .readFileSync(path.join(ROOT, 'chrome/content/feed.xhtml'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const bundle = fs.readFileSync(path.join(ROOT, 'chrome/content/scripts/feed.js'), 'utf8');
  const dom = new JSDOM(xhtml, {
    contentType: 'application/xhtml+xml',
    url: 'https://journalflow.local/feed.xhtml',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  let resolveSlow;
  let batchImported = [];
  const slowFeed = [
    {
      doi: '10.1/slow',
      title: 'Stale Journal Paper',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-10',
      abstract: 'Should be discarded by race guard.',
      isOpenAccess: false,
      figures: null,
    },
  ];
  const fastFeed = [
    {
      doi: '10.1/fast-oa',
      title: 'Fast Journal OA',
      journal: 'Science',
      issn: '0036-8075',
      date: '2026-11-11',
      abstract: 'Visible OA paper.',
      isOpenAccess: true,
      figures: [{ label: 'Fig. 1', caption: 'C', urls: ['https://example.org/fig1.png'] }],
      _read: false,
      _starred: true,
    },
    {
      doi: '10.1/fast-closed',
      title: 'Fast Journal Closed',
      journal: 'Science',
      issn: '0036-8075',
      date: '2026-11-10',
      abstract: '',
      isOpenAccess: false,
      figures: null,
      _read: true,
      _starred: false,
    },
  ];

  window.__JournalFlowContext = {
    Zotero: { debug: () => {} },
    JournalFlow: {
      getUILang: () => 'en',
      getUILanguageMode: () => 'auto',
      setUILanguage: () => {},
      getWindowMode: () => 'tab',
      getString: (id) => id,
      getPref: (k) => (k === 'loadFigures' ? false : true),
      getJournals: () => [
        { issn: '0028-0836', title: 'Nature', publisher: 'Springer Nature' },
        { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
      ],
      getFeed: (issn) => {
        if (issn === '0028-0836') {
          return new Promise((resolve) => {
            resolveSlow = resolve;
          });
        }
        return Promise.resolve(fastFeed);
      },
      dedupeArticles: (arr) => arr,
      getExistingLibraryDOIs: async () => ({}),
      getUserCollections: () => ({ collections: [{ id: 42, name: 'AI Papers' }], activeCollectionID: 42 }),
      importArticleToZotero: async (article, opts) => {
        batchImported.push({ doi: article.doi, collectionID: opts.collectionID });
        return { itemID: 500, usedFallback: false };
      },
      getTranslationTarget: () => 'zh',
      openURL: () => {},
    },
  };

  window.eval(bundle);
  await flushMicrotasks(15);

  const doc = window.document;
  // Click Science journal node while 'All journals' is still waiting on slow Nature promise
  const scienceNode = Array.from(doc.querySelectorAll('#journal-list li.journal-node')).find((li) =>
    li.textContent?.includes('Science')
  );
  assert.ok(scienceNode, 'expected Science journal node in publisher tree');
  scienceNode.click();
  await flushMicrotasks(20);
  // Now resolve the stale All/Nature promise; cards should still reflect only Science's 2 articles!
  resolveSlow?.(slowFeed);
  await flushMicrotasks(20);
  assert.equal(doc.querySelectorAll('#cards .card').length, 2);

  // Filter pill: OA -> only 1 card
  doc.getElementById('filter-oa-btn').click();
  assert.equal(doc.querySelectorAll('#cards .card').length, 1);
  // Reset filter to All -> test Select All / Clear Selection toggle -> default empty targetCollectionID passes null, explicit select passes 42
  doc.getElementById('filter-all-btn').click();
  const selectAllBtn = doc.getElementById('select-all-btn');
  const batchBar = doc.getElementById('batch-import-bar');
  const colSelect = doc.getElementById('collection-select');
  assert.equal(colSelect.value, '', 'default selector keeps empty value so library auto-files into Zotero-JournalFlow/<Journal>');
  selectAllBtn.click();
  assert.equal(batchBar.classList.contains('has-selection'), true);
  assert.equal(doc.querySelectorAll('#cards .card.is-selected').length, 2);
  selectAllBtn.click();
  assert.equal(batchBar.classList.contains('has-selection'), false);
  assert.equal(doc.querySelectorAll('#cards .card.is-selected').length, 0);

  const firstCheck = doc.querySelector('.card-select');
  firstCheck.checked = true;
  firstCheck.dispatchEvent(new window.Event('change'));
  assert.equal(batchBar.classList.contains('has-selection'), true);
  doc.getElementById('batch-import-btn').click();
  await flushMicrotasks(20);
  assert.deepEqual(batchImported, [{ doi: '10.1/fast-oa', collectionID: null }]);

  colSelect.value = '42';
  colSelect.dispatchEvent(new window.Event('change'));
  const secondCheck = doc.querySelectorAll('.card-select')[1];
  secondCheck.checked = true;
  secondCheck.dispatchEvent(new window.Event('change'));
  doc.getElementById('batch-import-btn').click();
  await flushMicrotasks(20);
  assert.deepEqual(batchImported[1], { doi: '10.1/fast-closed', collectionID: 42 });

  // Lightbox canvas toggle switches .light-canvas (starts true -> false on 1st click -> true on 2nd click)
  const canvasBtn = doc.getElementById('lightbox-canvas-btn');
  const stage = doc.getElementById('lightbox-stage');
  canvasBtn.click();
  assert.equal(stage.classList.contains('light-canvas'), false);
  canvasBtn.click();
  assert.equal(stage.classList.contains('light-canvas'), true);
});

test('zoteroImport auto-creates journal-named collections on first import, reuses existing ones, respects parent scopes, and guards concurrency', async () => {
  const store = [
    { id: 10, libraryID: 1, name: 'AI Papers', parentID: null, deleted: false },
    { id: 11, libraryID: 1, name: 'Deleted Journal', parentID: null, deleted: true },
  ];
  let nextColId = 100;
  let nextItemId = 500;
  let createCalls = 0;

  class MockCollection {
    constructor() {
      this.id = 0;
      this.libraryID = 1;
      this.name = '';
      this.parentID = null;
      this.deleted = false;
    }
    async saveTx() {
      createCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      this.id = ++nextColId;
      store.push(this);
    }
  }

  const createdTranslateItems = [];
  const translatedItems = [];
  class MockItem {
    constructor(type) {
      this.id = ++nextItemId;
      this.type = type;
      this.fields = {};
      this.collections = [];
      this.parentItemID = null;
    }
    setField(k, v) {
      this.fields[k] = v;
    }
    setCreators() {}
    addToCollection(id) {
      this.collections.push(id);
    }
    async saveTx() {
      translatedItems.push(this);
    }
  }

  const zotMock = {
    Libraries: { userLibraryID: 1 },
    Collection: MockCollection,
    Collections: {
      get: (id) => store.find((c) => c.id === id) || null,
      getByParent: (parentID) => store.filter((c) => !c.deleted && c.parentID === parentID),
      getByLibrary: (_libID, recursive = false) =>
        store.filter((c) => !c.deleted && (recursive || !c.parentID)),
    },
    Item: MockItem,
    Translate: {
      Search: class {
        setIdentifier({ DOI }) {
          this.doi = DOI;
        }
        async getTranslators() {
          return this.doi?.includes('no-tr') ? [] : [{ label: 'MockDOI' }];
        }
        setTranslator() {}
        async translate() {
          const parentItem = new MockItem('journalArticle');
          const attachment = new MockItem('attachment');
          attachment.parentItemID = parentItem.id;
          createdTranslateItems.push(parentItem, attachment);
          return [parentItem, attachment];
        }
      },
    },
    debug: () => {},
  };

  const zi = loadTsModule('src/host/zoteroImport.ts', { Zotero: zotMock });

  const makeArticle = (doi, journal) => ({
    doi,
    title: `Title ${doi}`,
    authors: 'Ada Lovelace',
    journal,
    issn: '1748-3387',
    date: '2026-11-12',
    abstract: '',
  });

  // 1. First concurrent import of two different journals creates ONE top-level "Zotero-JournalFlow" root folder and two child journal folders inside it
  const [r1, rPrl] = await Promise.all([
    zi.importArticleToZotero(makeArticle('10.1038/nn-1', 'Nature Nanotechnology')),
    zi.importArticleToZotero(makeArticle('10.1103/prl-1', 'Physical Review Letters')),
  ]);
  assert.equal(r1.usedFallback, false);
  assert.equal(createCalls, 3, 'should create Zotero-JournalFlow once + 2 journal subfolders');
  const rootCols = store.filter((c) => c.name === 'Zotero-JournalFlow' && !c.parentID);
  assert.equal(rootCols.length, 1);
  const jfRoot = rootCols[0];
  const nnCol = store.find((c) => c.name === 'Nature Nanotechnology' && c.parentID === jfRoot.id);
  const prlCol = store.find((c) => c.name === 'Physical Review Letters' && c.parentID === jfRoot.id);
  assert.ok(nnCol);
  assert.ok(prlCol);
  const top1 = translatedItems.find((i) => i.id === r1.itemID);
  const att1 = createdTranslateItems.find((i) => i.parentItemID === r1.itemID);
  assert.deepEqual(top1.collections, [nnCol.id]);
  assert.deepEqual(att1.collections, []);
  assert.deepEqual(translatedItems.find((i) => i.id === rPrl.itemID).collections, [prlCol.id]);

  // 2. Second import (even via fallback + different casing/extra whitespace) reuses Zotero-JournalFlow -> Nature Nanotechnology
  const r2 = await zi.importArticleToZotero(makeArticle('10.1038/no-tr-2', '  nature   nanotechnology '));
  assert.equal(r2.usedFallback, true);
  assert.equal(createCalls, 3, 'should reuse existing root + journal collection instead of creating duplicate');
  const top2 = translatedItems.find((i) => i.id === r2.itemID);
  assert.deepEqual(top2.collections, [nnCol.id]);

  // 3. Concurrent imports for the same journal reuse Zotero-JournalFlow and create ONLY ONE subfolder
  const [c1, c2] = await Promise.all([
    zi.importArticleToZotero(makeArticle('10.1038/nat-1', 'Nature')),
    zi.importArticleToZotero(makeArticle('10.1038/nat-2', 'Nature')),
  ]);
  assert.equal(createCalls, 4);
  const natCols = store.filter((c) => c.name === 'Nature' && c.parentID === jfRoot.id);
  assert.equal(natCols.length, 1);
  assert.deepEqual(translatedItems.find((i) => i.id === c1.itemID).collections, [natCols[0].id]);
  assert.deepEqual(translatedItems.find((i) => i.id === c2.itemID).collections, [natCols[0].id]);

  // 4. Selecting "Zotero-JournalFlow" directly creates subfolder inside it without nesting Zotero-JournalFlow/Zotero-JournalFlow; selecting explicit subfolder directly matches name
  const sub1 = await zi.importArticleToZotero(makeArticle('10.1021/jacs-1', 'JACS'), { collectionID: jfRoot.id });
  const jacsSub = store.find((c) => c.name === 'JACS' && c.parentID === jfRoot.id);
  assert.ok(jacsSub);
  assert.equal(store.filter((c) => c.name === 'Zotero-JournalFlow').length, 1);
  assert.deepEqual(translatedItems.find((i) => i.id === sub1.itemID).collections, [jacsSub.id]);

  const direct = await zi.importArticleToZotero(makeArticle('10.1021/jacs-2', 'JACS'), { collectionID: jacsSub.id });
  assert.equal(store.filter((c) => c.name === 'JACS').length, 1, 'should not nest JACS/JACS');
  assert.deepEqual(translatedItems.find((i) => i.id === direct.itemID).collections, [jacsSub.id]);

  // 5. getUserCollections lists Zotero-JournalFlow and indented child journal collections cleanly
  const listed = zi.getUserCollections();
  assert.ok(listed.collections.some((c) => c.id === jfRoot.id && c.name === 'Zotero-JournalFlow'));
  assert.ok(listed.collections.some((c) => c.id === jacsSub.id && c.name === '  JACS'));
});
