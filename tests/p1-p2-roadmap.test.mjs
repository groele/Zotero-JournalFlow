import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ROOT, loadTsModule } from './helpers.mjs';

const fluent = loadTsModule('src/i18n/fluent.ts');
const config = loadTsModule('src/config.ts');
const presets = loadTsModule('src/presets.ts');
const adapters = loadTsModule('src/services/publisherAdapters.ts');
const feedState = loadTsModule('src/ui/feedState.ts');
const lightbox = loadTsModule('src/ui/lightbox.ts');
const sidebar = loadTsModule('src/ui/sidebar.ts');
const sidebarTree = loadTsModule('src/ui/sidebarTree.ts');
const cardsRender = loadTsModule('src/ui/cardsRender.ts');
const feedLoad = loadTsModule('src/ui/feedLoad.ts');

test('Fluent catalogues are single source of truth for UI_STRINGS across en and zh', () => {
  const enFtl = fs.readFileSync(path.join(ROOT, 'locale/en-US/journalflow.ftl'), 'utf8');
  const parsed = fluent.parseFluentFeedMessages(enFtl);
  assert.equal(parsed['loading-progress'], 'Loading feeds ({done}/{total})…');
  assert.equal(parsed['journal-status-ok'], 'Updated {time} · {count} article(s)');

  const enKeys = Object.keys(config.UI_STRINGS.en).sort();
  const zhKeys = Object.keys(config.UI_STRINGS.zh).sort();
  assert.deepEqual(enKeys, zhKeys);

  for (const key of [
    'preset-rsc',
    'preset-elsevier',
    'preset-ieee',
    'followed-filter-ph',
    'no-followed-matches',
    'soft-refreshing',
    'refresh-tooltip',
    'journal-status-loading',
    'journal-status-ok',
    'journal-status-error',
    'journal-retry',
  ]) {
    assert.ok(config.UI_STRINGS.en[key], `missing en key ${key}`);
    assert.ok(config.UI_STRINGS.zh[key], `missing zh key ${key}`);
  }
});

test('JOURNAL_PRESET_PACKS includes expanded publisher packs (rsc, elsevier, ieee) and new titles', () => {
  const byId = new Map(presets.JOURNAL_PRESET_PACKS.map((p) => [p.id, p.journals]));
  for (const id of ['top', 'aps', 'acs', 'wiley', 'springer', 'rsc', 'elsevier', 'ieee']) {
    const pack = byId.get(id);
    assert.ok(Array.isArray(pack) && pack.length >= 3, `expected pack ${id} to have >= 3 journals`);
  }
  const hasPRApplied = byId.get('aps').some((j) => j.issn === '2331-7019');
  const hasChemSocRev = byId.get('rsc').some((j) => j.issn === '0306-0012');
  const hasJoule = byId.get('elsevier').some((j) => j.issn === '2542-4351');
  const hasTPAMI = byId.get('ieee').some((j) => j.issn === '0162-8828');
  assert.ok(hasPRApplied && hasChemSocRev && hasJoule && hasTPAMI);
});

test('PublisherAdapter registry resolves publishers, extracts embedded abstracts, and expands image URLs', () => {
  assert.equal(adapters.resolvePublisherAdapter('https://pubs.rsc.org/en/content/articlelanding/2026/sc/d6sc00123a')?.id, 'rsc');
  assert.equal(adapters.resolvePublisherAdapter('https://ieeexplore.ieee.org/document/10456789')?.id, 'ieee');
  assert.equal(adapters.resolvePublisherAdapter('https://www.sciencedirect.com/science/article/pii/S254243512600001X')?.id, 'elsevier');

  const ieeeHtml = `<script>xplGlobal.document.metadata={"abstract":"We propose a neural optical processor that reduces latency by tenfold across programmable photonic waveguides."};</script>`;
  const embedded = adapters.extractAdapterEmbeddedAbstracts(ieeeHtml);
  assert.equal(embedded.length, 1);
  assert.match(embedded[0], /neural optical processor/);

  const plosImgs = adapters.expandAdapterHighResImageURLs(
    new URL('https://journals.plos.org/plosone/article/figure/image?size=inline&id=10.1371/journal.pone.0123456.g001')
  );
  assert.ok(plosImgs.some((u) => u.includes('size=large')));

  const springerImgs = adapters.expandAdapterHighResImageURLs(
    new URL('https://media.springernature.com/m685/springer-static/image/art%3A10.1038%2Fs41565-026-0001-x/MediaObjects/fig1.png')
  );
  assert.ok(springerImgs[0].includes('/full/springer-static/'));
});

test('FeedUIState is composed of domain slices and LightboxState works standalone', () => {
  const scope = feedState.createFeedScopeState();
  const view = feedState.createFeedViewState();
  const lib = feedState.createLibraryImportState();
  const lb = feedState.createLightboxState();

  assert.equal(scope.followedFilterQuery, '');
  assert.equal(Object.keys(scope.journalStatus).length, 0);
  assert.equal(scope.isRefreshing, false);
  assert.equal(view.visibleLimit, 40);
  assert.equal(lib.targetCollectionID, null);
  assert.equal(lb.lightboxLightCanvas, true);

  const composed = feedState.createInitialFeedState();
  for (const key of [
    ...Object.keys(scope),
    ...Object.keys(view),
    ...Object.keys(lib),
    ...Object.keys(lb),
  ]) {
    assert.ok(key in composed, `FeedUIState missing slice field ${key}`);
  }

  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="lightbox" hidden><button id="lightbox-canvas-btn"></button><button id="lightbox-prev"></button><button id="lightbox-next"></button><button id="lightbox-nav-prev"></button><button id="lightbox-nav-next"></button><button id="lightbox-zoom-reset"></button><div id="lightbox-stage"><img id="lightbox-img"/></div><div id="lightbox-caption"></div></div></body></html>'
  );
  lightbox.openLightbox(dom.window.document, lb, {
    label: 'Fig. 1',
    caption: 'Standalone LightboxState test',
    urls: ['https://example.org/fig1.png'],
  });
  assert.equal(dom.window.document.getElementById('lightbox').hidden, false);
  assert.equal(lb.lightboxFigures.length, 1);
});

function createSidebarMockCtx(state, onGetFeed) {
  return {
    Zotero: { debug() {} },
    JournalFlow: {
      getString: (id) => config.UI_STRINGS.en[id] || id,
      unfollowJournal: (issn) => state.journals.filter((j) => j.issn !== issn),
      getFeed: onGetFeed,
      dedupeArticles: (arr) => arr,
      getPref: () => false,
      getTranslationTarget: () => 'zh',
      openURL() {},
      getUserCollections: () => ({ collections: [], activeCollectionID: null }),
    },
  };
}

test('Sidebar filter searches across collapsed publishers and status retry button triggers callback', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><input id="followed-filter-input" type="search"/><ul id="journal-list"></ul></body></html>'
  );
  const doc = dom.window.document;
  const state = feedState.createInitialFeedState();
  state.journals = [
    { issn: '0028-0836', title: 'Nature', publisher: 'Springer Nature' },
    { issn: '0306-0012', title: 'Chem. Soc. Rev.', publisher: 'Royal Society of Chemistry (RSC)' },
  ];
  state.collapsedPublishers.add('RSC');
  state.journalStatus['0306-0012'] = { state: 'error', error: 'HTTP 503', updatedAt: Date.now() };
  state.journalStatus['0028-0836'] = { state: 'ok', count: 5, updatedAt: Date.now() };

  const retried = [];
  let scopeSelected = 0;
  const ctx = createSidebarMockCtx(state, async () => []);

  sidebarTree.renderJournalListTree(doc, ctx, state, () => {
    scopeSelected++;
  }, (issn) => retried.push(issn));

  // Collapsed child is hidden before filtering and uses CSS display:none !important on li[hidden]
  const feedCss = fs.readFileSync(path.join(ROOT, 'chrome/content/styles/feed.css'), 'utf8');
  assert.match(feedCss, /#journal-list\s+li\[hidden\]\s*\{\s*display:\s*none\s*!important;/);

  const pubNodes = Array.from(doc.querySelectorAll('#journal-list li.publisher-node'));
  const rscPub = pubNodes.find((n) => n.classList.contains('is-collapsed'));
  assert.ok(rscPub);
  const toggleBtn = rscPub.querySelector('button.publisher-toggle');
  assert.ok(toggleBtn?.querySelector('svg.chevron-icon'));
  assert.equal(rscPub.lastElementChild, toggleBtn, 'chevron toggle should sit at trailing edge like Zotero item-pane');

  const nodesBefore = Array.from(doc.querySelectorAll('#journal-list li.journal-node'));
  const chemNode = nodesBefore.find((n) => n.textContent.includes('Chem. Soc. Rev.'));
  assert.ok(chemNode);
  assert.equal(chemNode.hidden, true);
  toggleBtn.click();
  const chemAfterExpand = Array.from(doc.querySelectorAll('#journal-list li.journal-node')).find((n) =>
    n.textContent.includes('Chem. Soc. Rev.')
  );
  assert.equal(chemAfterExpand.hidden, false);
  assert.ok(scopeSelected >= 1, 'expanding a publisher accordion also selects that publisher scope');
  // Collapse back before testing retry & filter
  const expandedToggle = Array.from(doc.querySelectorAll('#journal-list li.publisher-node.is-expanded button.publisher-toggle')).find(
    (btn) => btn.closest('li')?.textContent?.includes('RSC') || btn.closest('li')?.textContent?.includes('Royal')
  );
  expandedToggle?.click();
  const chemCollapsedAgain = Array.from(doc.querySelectorAll('#journal-list li.journal-node')).find((n) =>
    n.textContent.includes('Chem. Soc. Rev.')
  );
  assert.equal(chemCollapsedAgain.hidden, true);
  const retryBtn = chemCollapsedAgain.querySelector('button.jstatus-retry');
  assert.ok(retryBtn);
  const scopeBeforeRetry = scopeSelected;
  retryBtn.click();
  assert.deepEqual(retried, ['0306-0012']);
  assert.equal(scopeSelected, scopeBeforeRetry, 'status retry must not change feed scope');

  // Live filter expands matching collapsed group
  const ac = new dom.window.AbortController();
  sidebar.initFollowedFilter(doc, ctx, state, ac.signal, () => {}, (issn) => retried.push(issn));
  const input = doc.getElementById('followed-filter-input');
  input.value = 'chem';
  input.dispatchEvent(new dom.window.Event('input'));

  const nodesFiltered = Array.from(doc.querySelectorAll('#journal-list li.journal-node'));
  assert.equal(nodesFiltered.length, 1);
  assert.equal(nodesFiltered[0].hidden, false);

  // Non-matching filter renders empty notice
  input.value = 'zzzz-no-such-journal';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.ok(doc.querySelector('#journal-list li.journal-empty-filter'));
  ac.abort();
});

test('loadFeed shows skeleton cards on cold load, preserves cards on soft refresh, and supports single-journal retry', async () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="status" hidden></div><div id="notice" hidden></div><div id="batch-import-bar" hidden><button id="select-all-btn"></button><select id="collection-select"></select><button id="batch-import-btn"></button></div><button id="translate-all-btn"></button><span id="article-search-count"></span><div id="cards"></div></body></html>'
  );
  const doc = dom.window.document;
  const state = feedState.createInitialFeedState();
  state.journals = [
    { issn: '0028-0836', title: 'Nature', publisher: 'Springer Nature' },
    { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
  ];

  let failScience = true;
  let resolveNature;
  const natureDeferred = new Promise((r) => {
    resolveNature = r;
  });

  const makeArticle = (doi, title, journal, issn, date) => ({
    doi,
    title,
    authors: 'A. Author',
    journal,
    issn,
    date,
    volume: '1',
    issue: '1',
    pages: '1-5',
    abstract: 'Sample abstract content for testing.',
    abstractSource: 'crossref',
    url: `https://doi.org/${doi}`,
    fullTextLinks: [],
    pmcid: null,
    pubTypes: ['journal-article'],
    isOpenAccess: true,
    figures: null,
    graphicalAbstract: null,
  });

  const ctx = createSidebarMockCtx(state, async (issn) => {
    if (issn === '0028-0836') return natureDeferred;
    if (failScience) throw new Error('network timeout');
    return [makeArticle('10.1126/sci.2', 'Science Paper 2', 'Science', '0036-8075', '2026-11-11')];
  });

  // 1. Cold load renders skeletons synchronously before resolving
  const coldPromise = feedLoad.loadFeed(doc, ctx, state, { force: false, soft: false });
  assert.ok(doc.querySelectorAll('#cards .card-skeleton').length >= 2, 'skeleton cards should render during cold load');
  assert.equal(state.journalStatus['0028-0836'].state, 'loading');

  resolveNature([makeArticle('10.1038/nat.1', 'Nature Paper 1', 'Nature', '0028-0836', '2026-11-12')]);
  await coldPromise;

  assert.equal(doc.querySelectorAll('#cards .card-skeleton').length, 0);
  assert.equal(doc.querySelectorAll('#cards .card').length, 1);
  assert.equal(state.journalStatus['0028-0836'].state, 'ok');
  assert.equal(state.journalStatus['0036-8075'].state, 'error');

  // 2. Soft refresh keeps visible card intact while background fetch runs
  let releaseSoft;
  const softGate = new Promise((r) => {
    releaseSoft = r;
  });
  ctx.JournalFlow.getFeed = async () => {
    await softGate;
    throw new Error('all offline during refresh');
  };

  const softPromise = feedLoad.loadFeed(doc, ctx, state, { force: true, soft: true });
  const cardsEl = doc.getElementById('cards');
  assert.ok(cardsEl.classList.contains('is-soft-refreshing'));
  assert.equal(cardsEl.querySelectorAll('.card:not(.card-skeleton)').length, 1, 'existing cards must remain visible during soft refresh');
  assert.equal(cardsEl.querySelectorAll('.card-skeleton').length, 0);

  releaseSoft();
  await softPromise;

  // When all feeds fail during soft refresh, previous articles are still preserved
  assert.equal(cardsEl.classList.contains('is-soft-refreshing'), false);
  assert.equal(state.articles.length, 1);
  assert.equal(cardsEl.querySelectorAll('.card').length, 1);

  // 3. Single journal retry recovers Science without losing Nature
  failScience = false;
  ctx.JournalFlow.getFeed = async (issn) => {
    if (issn === '0036-8075') {
      return [makeArticle('10.1126/sci.2', 'Science Paper 2', 'Science', '0036-8075', '2026-11-11')];
    }
    return [];
  };
  await feedLoad.retryJournalFeed(doc, ctx, state, '0036-8075');
  assert.equal(state.journalStatus['0036-8075'].state, 'ok');
  assert.equal(state.articles.length, 2);
  assert.equal(doc.querySelectorAll('#cards .card').length, 2);
});
