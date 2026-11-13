import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { ROOT, createPrefStore, loadTsModule } from './helpers.mjs';

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

test('preferences.js renders all controls on Gecko 140+/153+, clamps numerics, resets defaults, and cleans up via AbortController', async () => {
  const prefStore = createPrefStore({
    'extensions.journalflow.journals': JSON.stringify([
      { issn: '0028-0836', title: 'Nature' },
      { issn: '0036-8075', title: 'Science' },
    ]),
    'extensions.journalflow.windowMode': 'tab',
    'extensions.journalflow.uiLanguage': 'auto',
    'extensions.journalflow.daysToFetch': 14,
    'extensions.journalflow.articlesPerJournal': 200,
    'extensions.journalflow.filterArticleTypes': true,
    'extensions.journalflow.translateProvider': 'google',
    'extensions.journalflow.loadFigures': true,
  });

  let cleared = 0;
  let opened = 0;
  const xhtml = fs.readFileSync(path.join(ROOT, 'chrome/content/preferences.xhtml'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'chrome/content/scripts/preferences.js'), 'utf8');

  const dom = new JSDOM(`<!DOCTYPE html><html><body>${xhtml}</body></html>`, {
    url: 'about:blank',
    runScripts: 'outside-only',
  });
  const { window } = dom;

  window.Zotero = {
    Prefs: prefStore.Prefs,
    JournalFlow: {
      getJournals: () => JSON.parse(prefStore.store.get('extensions.journalflow.journals')),
      getCacheFilePath: () => 'Z:/Zotero/journalflow-cache.json',
      clearCache: async () => {
        cleared++;
      },
      openWorkbench: () => {
        opened++;
      },
      setUILanguage: () => {},
    },
    logError: () => {},
  };

  window.eval(bundle);
  await flushMicrotasks();

  const doc = window.document;
  assert.ok(doc.getElementById('pref-windowMode'));
  assert.ok(doc.getElementById('pref-uiLanguage'));
  assert.ok(doc.getElementById('pref-daysToFetch'));
  assert.ok(doc.getElementById('pref-articlesPerJournal'));
  assert.ok(doc.getElementById('pref-filterArticleTypes'));
  assert.ok(doc.getElementById('pref-translateProvider'));
  assert.ok(doc.getElementById('pref-loadFigures'));
  assert.equal(doc.getElementById('jf-cache-path-code').textContent, 'Z:/Zotero/journalflow-cache.json');
  assert.match(doc.getElementById('jf-followed-summary').textContent, /2/);

  // Numeric bounds clamping
  const daysInput = doc.getElementById('pref-daysToFetch');
  daysInput.value = '9999';
  daysInput.dispatchEvent(new window.Event('change'));
  await flushMicrotasks();
  assert.equal(prefStore.store.get('extensions.journalflow.daysToFetch'), 180);
  assert.equal(daysInput.value, '180');

  // Action buttons
  doc.getElementById('jf-btn-open-workbench').click();
  assert.equal(opened, 1);

  doc.getElementById('jf-btn-clear-cache').click();
  await flushMicrotasks();
  assert.ok(cleared >= 1);

  doc.getElementById('jf-btn-reset-defaults').click();
  await flushMicrotasks();
  assert.equal(prefStore.store.get('extensions.journalflow.daysToFetch'), 14);
  assert.equal(daysInput.value, '14');

  // Teardown cleanup via pagehide
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(doc.getElementById('journalflow-preferences-pane')._journalFlowInited, false);
});

test('feed.js supports Tab __JournalFlowContext, filters articles, highlights matches, and uses non-blocking notices', async () => {
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

  const articles = [
    {
      doi: '10.1038/a1',
      title: 'Foundation Models for Molecular Dynamics',
      authors: 'Ada Lovelace, Alan Turing',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-10',
      volume: '630',
      issue: '2',
      pages: '10-18',
      abstract: 'Simulating protein folding across millisecond trajectories.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1038/a1',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: ['journal article'],
      isOpenAccess: true,
      figures: null,
      graphicalAbstract: null,
    },
    {
      doi: '10.1126/b2',
      title: 'Ocean Carbon Flux Variability',
      authors: 'Marie Curie',
      journal: 'Science',
      issn: '0036-8075',
      date: '2026-11-09',
      volume: '386',
      issue: '5',
      pages: '22-28',
      abstract: 'Measuring seasonal carbon exchange in the Southern Ocean.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1126/b2',
      fullTextLinks: [],
      pmcid: null,
      pubTypes: ['journal article'],
      isOpenAccess: false,
      figures: null,
      graphicalAbstract: null,
    },
  ];

  const strings = {
    'all-journals': 'All journals',
    loading: 'Loading...',
    refresh: 'Refresh',
    followed: 'Followed',
    'add-journal': 'Follow',
    'search-ph': 'Search journal',
    'article-search-ph': 'Search articles',
    'lang-label': 'Language',
    'lang-auto': 'Auto',
    'lang-en': 'EN',
    'lang-zh': '中文',
    'window-mode-label': 'Open mode',
    'window-mode-tab': 'Zotero Tab (Recommended)',
    'window-mode-window': 'Standalone Window',
    'translate-all': 'Translate all',
    'original-all': 'Originals',
    'translate-to-zh': 'To ZH',
    'translate-to-en': 'To EN',
    add: 'Add to Zotero',
    added: 'Added',
    'add-failed': 'Add failed cleanly',
    'open-page': 'Open page',
    'show-more': 'Show more',
    'show-less': 'Show less',
    oa: 'OA',
  };

  let alertCalls = 0;
  window.alert = () => {
    alertCalls++;
  };
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  let switchedTo = null;
  window.__JournalFlowContext = {
    Zotero: { debug: () => {} },
    JournalFlow: {
      getUILang: () => 'en',
      getUILanguageMode: () => 'auto',
      setUILanguage: () => {},
      getWindowMode: () => 'tab',
      switchWindowMode: (mode, _win, launchState) => {
        switchedTo = { mode, launchState };
      },
      getString: (id) => strings[id] || id,
      getPref: (k) => (k === 'loadFigures' ? false : true),
      getJournals: () => [{ issn: '0028-0836', title: 'Nature' }],
      getFeed: async () => articles,
      dedupeArticles: (arr) => arr,
      clearCache: async () => {},
      getTranslationTarget: () => 'zh',
      openURL: () => {},
      addToZoteroByDOI: async () => {
        throw new Error('simulated failure');
      },
    },
  };

  window.eval(bundle);
  await flushMicrotasks();

  const doc = window.document;
  assert.equal(doc.querySelectorAll('#cards .card').length, 2);

  // Opening mode switcher & settings button must NOT render in main workbench topbar
  assert.equal(doc.getElementById('window-mode-select'), null);
  assert.equal(doc.getElementById('window-mode-label'), null);
  assert.equal(doc.getElementById('open-prefs-btn'), null);

  // Live article search highlighting
  const searchInput = doc.getElementById('article-search-input');
  searchInput.value = 'Molecular';
  searchInput.dispatchEvent(new window.Event('input'));
  assert.equal(doc.querySelectorAll('#cards .card').length, 1);
  assert.equal(doc.querySelector('mark.article-match')?.textContent, 'Molecular');

  // Non-blocking error banner when DOI import fails (no window.alert)
  const addBtn = doc.querySelector('.card-actions button.primary');
  addBtn.click();
  await flushMicrotasks();
  assert.equal(alertCalls, 0);
  assert.equal(doc.getElementById('notice').hidden, false);
  assert.equal(doc.getElementById('notice').textContent, 'Add failed cleanly');
});

test('WindowHostManager injects toolbar icon into zotero-items-toolbar (not zotero-item-toolbar) and opens workbench on click', async () => {
  const { WindowHostManager } = loadTsModule('src/host/windowManager.ts');
  const dom = new JSDOM(
    `<!DOCTYPE html><html windowtype="navigator:browser"><head></head><body>
      <div id="zotero-pane"></div>
      <div id="zotero-item-toolbar"></div>
      <div id="zotero-items-toolbar">
        <toolbarbutton id="zotero-tb-add"></toolbarbutton>
        <toolbarbutton id="zotero-tb-attachment"></toolbarbutton>
        <toolbarbutton id="zotero-tb-note-add"></toolbarbutton>
        <toolbarspring></toolbarspring>
        <input id="zotero-tb-search" />
      </div>
      <menupopup id="menu_ToolsPopup"></menupopup>
    </body></html>`,
    { url: 'about:blank' }
  );
  const { window } = dom;
  const addedTabs = [];
  window.Zotero_Tabs = {
    _tabs: [],
    add: (opts) => {
      const container = window.document.createElement('div');
      addedTabs.push(opts);
      return { id: 'tab-jf-1', container };
    },
    select: () => {},
  };

  const mockService = {
    getPref: (k) => (k === 'windowMode' ? 'tab' : ''),
    getString: (k) => k,
  };

  const mgr = new WindowHostManager(mockService, () => 'jar:file:///addon.xpi!/');
  mgr.addToWindow(window);

  const doc = window.document;
  const itemPaneToolbar = doc.getElementById('zotero-item-toolbar');
  const mainToolbar = doc.getElementById('zotero-items-toolbar');
  const btn = doc.getElementById('journalflow-toolbarbutton');
  assert.ok(btn);
  assert.equal(itemPaneToolbar.querySelector('#journalflow-toolbarbutton'), null);
  assert.equal(btn.parentNode, mainToolbar);
  assert.equal(btn.previousElementSibling.id, 'zotero-tb-note-add');
  assert.equal(btn.nextElementSibling.tagName.toLowerCase(), 'toolbarspring');
  assert.equal(doc.getElementById('journalflow-menuitem'), null);
  assert.equal(doc.getElementById('journalflow-host-style')?.namespaceURI, 'http://www.w3.org/1999/xhtml');

  btn.click();
  assert.equal(addedTabs.length, 1);
  assert.equal(addedTabs[0].type, 'journalflow');

  mgr.removeFromWindow(window);
  assert.equal(doc.getElementById('journalflow-toolbarbutton'), null);
  assert.equal(doc.getElementById('journalflow-menuitem'), null);
  assert.equal(doc.getElementById('journalflow-host-style'), null);
});

test('WorkbenchLauncher supports tab and standalone window modes and live switching with state handoff', async () => {
  const { WorkbenchLauncher } = loadTsModule('src/host/workbenchLauncher.ts');
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: 'about:blank' });
  const { window: mainWin } = dom;

  const closedTabs = [];
  const openedTabs = [];
  const closedWindows = [];
  const openedDialogs = [];
  let prefMode = 'tab';

  mainWin.Zotero_Tabs = {
    _tabs: [],
    add: (opts) => {
      const container = mainWin.document.createElement('div');
      const tab = { id: `tab-${openedTabs.length + 1}`, type: opts.type, title: opts.title, container };
      mainWin.Zotero_Tabs._tabs.push(tab);
      openedTabs.push(tab);
      return tab;
    },
    select: () => {},
    close: (id) => {
      closedTabs.push(id);
      mainWin.Zotero_Tabs._tabs = mainWin.Zotero_Tabs._tabs.filter((t) => t.id !== id);
    },
  };

  mainWin.openDialog = (url, name, features, payload) => {
    const win = {
      name,
      url,
      features,
      closed: false,
      focused: false,
      Zotero: null,
      __JournalFlowContext: null,
      document: { title: '' },
      addEventListener: () => {},
      postMessage: () => {},
      focus: () => {
        win.focused = true;
      },
      close: () => {
        win.closed = true;
        closedWindows.push(name);
      },
      payload,
    };
    openedDialogs.push(win);
    return win;
  };

  const service = {
    getPref: (k) => (k === 'windowMode' ? prefMode : ''),
    setPref: (k, v) => {
      if (k === 'windowMode') prefMode = v;
    },
  };

  const launcher = new WorkbenchLauncher(service);

  // 1. Default tab mode
  launcher.open(mainWin);
  assert.equal(openedTabs.length, 1);
  assert.equal(openedDialogs.length, 0);

  // 2. Live switch tab -> window preserves launchState and closes tab
  launcher.switchMode('window', mainWin, { activeISSN: '0028-0836', articleQuery: 'graphene' });
  await flushMicrotasks();
  assert.equal(prefMode, 'window');
  assert.equal(closedTabs.length, 1);
  assert.equal(openedDialogs.length, 1);
  assert.match(openedDialogs[0].features, /minimizable=yes/);
  assert.deepEqual(openedDialogs[0].__JournalFlowContext.initialState, {
    activeISSN: '0028-0836',
    articleQuery: 'graphene',
  });

  // 3. Re-opening in window mode focuses existing standalone window instead of spawning duplicate
  launcher.open(mainWin);
  assert.equal(openedDialogs.length, 1);
  assert.equal(openedDialogs[0].focused, true);

  // 4. Live switch window -> tab opens tab and closes standalone window
  launcher.switchMode('tab', mainWin, { activeISSN: '0036-8075', articleQuery: 'catalysis' });
  await flushMicrotasks();
  assert.equal(prefMode, 'tab');
  assert.equal(closedWindows.length, 1);
  assert.equal(openedTabs.length, 2);
});

test('WorkbenchLauncher passes non-null data.icon to Zotero 10 Zotero_Tabs.add and resolves tabContent without falling back to standalone window', async () => {
  const { WorkbenchLauncher } = loadTsModule('src/host/workbenchLauncher.ts');
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="tabs-deck"></div></body></html>`, {
    url: 'about:blank',
  });
  const { window: mainWin } = dom;
  const doc = mainWin.document;
  const deck = doc.getElementById('tabs-deck');

  let standaloneOpened = 0;
  let prefMode = 'tab';
  let seq = 0;

  // Emulates Zotero 10 chrome/content/zotero/tabs.js strictly:
  // _update() throws TypeError if tab.data is undefined (`if (!tab.data.icon)`)!
  mainWin.Zotero_Tabs = {
    _tabs: [],
    _update() {
      for (const tab of this._tabs) {
        if (!tab.data.icon) {
          // Matches Zotero 10 tabs.js line 380: if (!tab.data.icon)
        }
      }
    },
    getTabContent(id) {
      return doc.getElementById(id);
    },
    add(opts) {
      const id = opts.id || `tab-${++seq}`;
      const container = doc.createElement('tab-content');
      container.id = id;
      deck.appendChild(container);
      const tab = { id, type: opts.type, title: opts.title, data: opts.data, onClose: opts.onClose };
      this._tabs.push(tab);
      this._update();
      if (opts.select) this.select(id);
      return { id, container };
    },
    select(id) {
      this._update();
      return id;
    },
    close(id) {
      this._tabs = this._tabs.filter((t) => t.id !== id);
      doc.getElementById(id)?.remove();
      this._update();
    },
  };

  mainWin.openDialog = () => {
    standaloneOpened += 1;
    return {
      closed: false,
      addEventListener: () => {},
      postMessage: () => {},
      focus: () => {},
      close: () => {},
      document: { title: '' },
    };
  };

  const service = {
    getPref: (k) => (k === 'windowMode' ? prefMode : ''),
    setPref: (k, v) => {
      if (k === 'windowMode') prefMode = v;
    },
  };

  const launcher = new WorkbenchLauncher(service);
  launcher.open(mainWin);

  assert.equal(standaloneOpened, 0, 'tab mode must embed into Zotero_Tabs without falling back to standalone window');
  assert.equal(mainWin.Zotero_Tabs._tabs.length, 1);
  assert.equal(mainWin.Zotero_Tabs._tabs[0].data?.icon, 'journalflow');

  const container = doc.getElementById(mainWin.Zotero_Tabs._tabs[0].id);
  const iframe = container?.querySelector('iframe#journalflow-tab-iframe');
  assert.ok(iframe, 'embedded tab container must contain journalflow iframe');
  assert.equal(iframe.getAttribute('src'), 'chrome://journalflow/content/feed.xhtml');

  // Re-opening after iframe removal heals the existing tab container instead of leaving it blank
  iframe.remove();
  launcher.open(mainWin);
  assert.ok(container?.querySelector('iframe#journalflow-tab-iframe'));

  // Calling switchMode('window', fakeIframeWin) resolves parent Zotero_Tabs and closes tab
  const fakeIframeWin = { parent: mainWin, opener: null };
  launcher.switchMode('window', fakeIframeWin);
  await flushMicrotasks();
  assert.equal(standaloneOpened, 1);
  assert.equal(mainWin.Zotero_Tabs._tabs.length, 0);
});

test('bumpRepoVersion increments patch version and keeps full-chain version files synchronized', async () => {
  const { bumpRepoVersion } = await import(pathToFileURL(path.join(ROOT, 'scripts/bump-version.mjs')).href);
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.default.tmpdir(), 'jf-bump-test-'));

  try {
    const copyRel = (rel) => {
      const src = path.join(ROOT, rel);
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    };

    for (const rel of [
      'package.json',
      'package-lock.json',
      'manifest.json',
      'docs/brand/product.json',
      'scripts/architecture-baseline.json',
      'src/config.ts',
      'chrome/content/feed.xhtml',
      'chrome/content/preferences.xhtml',
      'update.json',
      'README.md',
      'README.zh-CN.md',
    ]) {
      copyRel(rel);
    }

    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'dist', 'zotero-journalflow-0.9.9.xpi'), 'stale');

    const beforePkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    const [maj, min, pat] = beforePkg.version.split('.').map(Number);
    const expectedNext = `${maj}.${min}.${pat + 1}`;

    const res = bumpRepoVersion(tmp, []);
    assert.equal(res.nextVersion, expectedNext);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')).version, expectedNext);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(tmp, 'package-lock.json'), 'utf8')).packages[''].version,
      expectedNext
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(tmp, 'scripts/architecture-baseline.json'), 'utf8')).lastReleasedVersion,
      expectedNext
    );
    assert.ok(fs.readFileSync(path.join(tmp, 'src/config.ts'), 'utf8').includes(`ADDON_VERSION = '${expectedNext}'`));
    assert.ok(fs.readFileSync(path.join(tmp, 'chrome/content/feed.xhtml'), 'utf8').includes(`>v${expectedNext}<`));
    assert.ok(fs.readFileSync(path.join(tmp, 'chrome/content/preferences.xhtml'), 'utf8').includes(`"version": "${expectedNext}"`));
    assert.equal(fs.existsSync(path.join(tmp, 'dist', 'zotero-journalflow-0.9.9.xpi')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
