import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { ROOT } from './helpers.mjs';

function flushMicrotasks(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSampleArticles() {
  return [
    {
      doi: '10.1038/s41586-026-0001-a',
      title: 'Zeta Phase Transitions in Moiré Bilayers',
      authors: 'A. Physicist',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-12',
      volume: '631',
      issue: '1',
      pages: '1-6',
      abstract: 'A foundational study of correlated moire excitons.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1038/s41586-026-0001-a',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: ['journal-article'],
      isOpenAccess: true,
      figures: [
        { label: 'Fig. 1', caption: 'Band dispersion', urls: ['https://example.org/fig1.png'] },
        { label: 'Fig. 2', caption: 'Phase diagram', urls: ['https://example.org/fig2.png'] },
      ],
      graphicalAbstract: null,
      _read: true,
      _starred: false,
    },
    {
      doi: '10.1126/science.2026.0002',
      title: 'Alpha Catalytic Reduction of CO2',
      authors: 'B. Chemist',
      journal: 'Science',
      issn: '0036-8075',
      date: '2026-11-11',
      volume: '390',
      issue: '2',
      pages: '10-15',
      abstract: 'Selective conversion with copper single-atom catalysts.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1126/science.2026.0002',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: ['journal-article'],
      isOpenAccess: false,
      figures: null,
      graphicalAbstract: null,
      _read: false,
      _starred: true,
    },
  ];
}

test('v3.0.0 workbench supports scope banner, sort modes, DOI copy, bilingual parallel block, mark-all-read, lightbox filmstrip, and keyboard shortcuts', async () => {
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

  const copiedTexts = [];
  const openedUrls = [];
  const readUpdates = [];
  const starredUpdates = [];
  const articles = createSampleArticles();

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (txt) => {
        copiedTexts.push(txt);
      },
    },
  });

  window.__JournalFlowContext = {
    Zotero: { debug: () => {} },
    JournalFlow: {
      getUILang: () => 'en',
      getUILanguageMode: () => 'en',
      setUILanguage: () => {},
      getWindowMode: () => 'tab',
      getString: (id) => {
        const map = {
          'scope-all-title': 'All Followed Journals',
          'scope-metrics': '{total} paper(s) · {unread} unread · {oa} OA · {starred} starred',
          'bilingual-orig': 'EN · Original',
          'marked-scope-read': 'Marked {count} paper(s) as read.',
        };
        return map[id] || id;
      },
      getPref: (k) => (k === 'loadFigures' ? false : true),
      getJournals: () => [
        { issn: '0028-0836', title: 'Nature', publisher: 'Springer Nature' },
        { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
      ],
      getFeed: async (issn) => articles.filter((a) => a.issn === issn),
      dedupeArticles: (arr) => arr,
      getExistingLibraryDOIs: async () => ({}),
      getUserCollections: () => ({ collections: [], activeCollectionID: null }),
      getTranslationTarget: () => 'zh',
      translateText: async (text) => `译:${text}`,
      setArticleRead: async (a, value) => {
        readUpdates.push({ doi: a.doi, value });
      },
      toggleArticleStarred: async (a) => {
        const next = !a._starred;
        starredUpdates.push({ doi: a.doi, next });
        return next;
      },
      openURL: (url) => openedUrls.push(url),
    },
  };

  window.eval(bundle);
  await flushMicrotasks(35);

  const doc = window.document;
  // 1. Scope banner & live filter pill counts
  assert.equal(doc.getElementById('scope-banner-title')?.textContent, 'All Followed Journals');
  assert.equal(
    doc.getElementById('scope-banner-metrics')?.textContent,
    '2 paper(s) · 1 unread · 1 OA · 1 starred'
  );
  assert.equal(doc.querySelector('#filter-oa-btn .filter-count')?.textContent, '1');
  assert.equal(doc.querySelector('#filter-figures-btn .filter-count')?.textContent, '1');

  // 2. Sort selector: 'unread' puts unread Alpha paper first, 'title' sorts alphabetically
  const sortSelect = doc.getElementById('article-sort-select');
  sortSelect.value = 'unread';
  sortSelect.dispatchEvent(new window.Event('change'));
  assert.match(doc.querySelectorAll('#cards .card .card-title')[0]?.textContent || '', /Alpha Catalytic/);
  assert.equal(doc.getElementById('reset-filters-btn')?.hidden, false);

  doc.getElementById('reset-filters-btn')?.click();
  assert.equal(sortSelect.value, 'newest');
  assert.equal(doc.getElementById('reset-filters-btn')?.hidden, true);
  assert.match(doc.querySelectorAll('#cards .card .card-title')[0]?.textContent || '', /Zeta Phase/);

  // 3. Search clear button
  const searchInput = doc.getElementById('article-search-input');
  searchInput.value = 'Moire';
  searchInput.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('article-search-clear')?.hidden, false);
  doc.getElementById('article-search-clear')?.click();
  assert.equal(searchInput.value, '');
  assert.equal(doc.getElementById('article-search-clear')?.hidden, true);

  // 4. DOI quick copy pill & bilingual stacked original block
  const doiBadge = doc.querySelector('.card .badge-doi');
  doiBadge.click();
  await flushMicrotasks(15);
  assert.equal(copiedTexts[0], '10.1038/s41586-026-0001-a');

  const translateBtn = doc.querySelector('.card .card-actions button[data-action="translate"]');
  translateBtn.click();
  await flushMicrotasks(25);
  const firstCard = doc.querySelector('.card');
  assert.match(firstCard.querySelector('.card-title')?.textContent || '', /^译:Zeta Phase/);
  const origPanel = firstCard.querySelector('.card-bilingual-orig');
  assert.ok(origPanel, 'translated card renders bilingual original comparison block');
  assert.match(origPanel.querySelector('.bilingual-orig-title')?.textContent || '', /Zeta Phase Transitions/);
  // Toggling back removes bilingual comparison panel cleanly
  translateBtn.click();
  await flushMicrotasks(10);
  assert.equal(firstCard.querySelector('.card-bilingual-orig'), null);

  // 5. Lightbox filmstrip, counter, and copy/open URL actions
  const firstTitle = firstCard.querySelector('.card-title');
  assert.ok(firstTitle);
  // Trigger lightbox by clicking a mocked figure or calling lightbox buttons if rendered —
  // here articles[0] has figures; click first figure thumbnail if strip was rendered or simulate figures directly
  articles[0].figures = [
    { label: 'Fig. 1', caption: 'Band dispersion', urls: ['https://example.org/fig1.png'] },
    { label: 'Fig. 2', caption: 'Phase diagram', urls: ['https://example.org/fig2.png'] },
  ];
  // Use keyboard navigation 'j' to focus first card, 'k' / 'j', 's' to star, 'r' to toggle read, '/' & '?'
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  const cardsNow = doc.querySelectorAll('#cards .card');
  assert.equal(cardsNow[0].classList.contains('is-keyboard-focus'), true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  assert.equal(cardsNow[1].classList.contains('is-keyboard-focus'), true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  assert.equal(cardsNow[1].classList.contains('is-selected'), true);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  await flushMicrotasks(15);
  assert.equal(starredUpdates[0]?.next, false);

  // '?' opens shortcut modal, Escape closes it
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
  assert.equal(doc.getElementById('kbd-help-modal')?.hidden, false);
  assert.ok(doc.querySelectorAll('#kbd-help-list li').length >= 8);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.getElementById('kbd-help-modal')?.hidden, true);

  // 6. Mark all read clears unread count & persists via setArticleRead
  doc.getElementById('mark-scope-read-btn')?.click();
  await flushMicrotasks(20);
  assert.ok(readUpdates.some((u) => u.doi === '10.1126/science.2026.0002' && u.value === true));
  assert.equal(doc.getElementById('mark-scope-read-btn')?.disabled, true);
  assert.equal(
    doc.getElementById('scope-banner-metrics')?.textContent,
    '2 paper(s) · 0 unread · 1 OA · 0 starred'
  );
});

test('lightbox v3.0.0 shows counter, filmstrip thumbnails, and copies/opens figure URL', async () => {
  const { loadTsModule } = await import('./helpers.mjs');
  const feedState = loadTsModule('src/ui/feedState.ts');
  const lightbox = loadTsModule('src/ui/lightbox.ts');
  const xhtml = fs
    .readFileSync(path.join(ROOT, 'chrome/content/feed.xhtml'), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(xhtml, {
    contentType: 'application/xhtml+xml',
    url: 'https://journalflow.local/feed.xhtml',
  });
  const doc = dom.window.document;
  const copied = [];
  const opened = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t) => copied.push(t) },
  });
  const state = feedState.createLightboxState();
  const ac = new dom.window.AbortController();
  const ctx = {
    JournalFlow: {
      getString: (id) => id,
      openURL: (url) => opened.push(url),
    },
  };
  lightbox.initLightbox(doc, state, ac.signal, ctx);
  lightbox.openLightbox(
    doc,
    state,
    [
      { label: 'Fig. 1', caption: 'First chart', urls: ['https://example.org/f1.png'] },
      { label: 'Fig. 2', caption: 'Second chart', urls: ['https://example.org/f2.png'] },
    ],
    0
  );

  assert.equal(doc.getElementById('lightbox-counter')?.textContent, '1 / 2');
  const strip = doc.getElementById('lightbox-strip');
  assert.equal(strip?.hidden, false);
  const thumbs = strip?.querySelectorAll('.lightbox-thumb');
  assert.equal(thumbs?.length, 2);
  assert.equal(thumbs[0].classList.contains('is-active'), true);

  thumbs[1].click();
  assert.equal(doc.getElementById('lightbox-counter')?.textContent, '2 / 2');
  assert.equal(doc.getElementById('lightbox-strip')?.querySelectorAll('.lightbox-thumb')[1].classList.contains('is-active'), true);

  doc.getElementById('lightbox-copy-url-btn')?.click();
  await flushMicrotasks(15);
  assert.equal(copied[0], 'https://example.org/f2.png');

  doc.getElementById('lightbox-open-btn')?.click();
  assert.equal(opened[0], 'https://example.org/f2.png');
  ac.abort();
});
