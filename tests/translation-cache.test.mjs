import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, toPlain } from './helpers.mjs';

test('translation language detection, target switching, and chunking respect sentence boundaries', () => {
  const tx = loadTsModule('src/services/translation.ts');
  assert.equal(tx.detectLang('Attention Is All You Need'), 'en');
  assert.equal(tx.detectLang('大模型科学发现综述'), 'zh');
  assert.equal(tx.getTranslationTarget('Attention Is All You Need', 'zh'), 'zh');
  assert.equal(tx.getTranslationTarget('大模型科学发现综述', 'zh'), 'en');

  const chunks = tx.chunkText('First sentence. Second sentence. Third sentence.', 32);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 32));
});

test('translateText integrates windingwind/zotero-pdf-translate first and falls back smoothly when absent or mismatched', async () => {
  const calls = [];
  const mockFetch = async (url) => ({
    ok: true,
    status: 200,
    url,
    text: async () => JSON.stringify([[['谷歌回退翻译标题']]]),
  });
  const txOk = loadTsModule('src/services/translation.ts', {
    fetch: mockFetch,
    Zotero: {
      PDFTranslate: {
        api: {
          translate: async (text, opts) => {
            calls.push({ text, opts });
            return { result: '基于 PDF Translate 插件的中文译文' };
          },
        },
      },
    },
  });
  const res1 = await txOk.translateText('Quantum Hall Effect', 'zh', 'pdftranslate');
  assert.equal(res1, '基于 PDF Translate 插件的中文译文');
  assert.equal(calls.length, 1);
  assert.deepEqual(toPlain(calls[0].opts), { langFrom: 'en', langTo: 'zh-CN' });

  // Fallback when Zotero.PDFTranslate is unavailable
  const txFallback = loadTsModule('src/services/translation.ts', {
    fetch: mockFetch,
    Zotero: {},
  });
  const res2 = await txFallback.translateText('Quantum Hall Effect', 'zh', 'pdftranslate');
  assert.equal(res2, '谷歌回退翻译标题');

  // Fallback when Zotero.PDFTranslate echoes unchanged source text
  const txEcho = loadTsModule('src/services/translation.ts', {
    fetch: mockFetch,
    Zotero: {
      PDFTranslate: {
        api: {
          translate: async (text) => ({ result: text }),
        },
      },
    },
  });
  const res3 = await txEcho.translateText('Quantum Hall Effect', 'zh', 'pdftranslate');
  assert.equal(res3, '谷歌回退翻译标题');
});

test('DailyFeedCacheStore persists via IOUtils, invalidates by ISSN, and strips transient UI fields', async () => {
  const files = new Map();
  const mockGlobals = {
    Zotero: { DataDirectory: { dir: 'Z:/mock-zotero-data' }, debug() {} },
    PathUtils: { join: (...parts) => parts.join('/') },
    IOUtils: {
      readUTF8: async (p) => {
        if (!files.has(p)) throw new Error('ENOENT');
        return files.get(p);
      },
      writeUTF8: async (p, content) => {
        files.set(p, content);
      },
    },
  };
  const cacheMod = loadTsModule('src/services/cache.ts', mockGlobals);
  const store = new cacheMod.DailyFeedCacheStore();
  assert.equal(store.getCacheFilePath(), 'Z:/mock-zotero-data/journalflow-cache.json');

  const key = cacheMod.feedCacheKey('0028-0836', 200, 14, true);
  const sample = [
    {
      doi: '10.1038/s41586-026-0001-1',
      title: 'Test Paper',
      authors: 'Author A',
      journal: 'Nature',
      issn: '0028-0836',
      date: '2026-11-12',
      volume: '630',
      issue: '1',
      pages: '1-5',
      abstract: 'A detailed abstract.',
      abstractSource: 'crossref',
      url: 'https://doi.org/10.1038/s41586-026-0001-1',
      fullTextLinks: [],
      pmcid: 'PMC1',
      pubTypes: ['journal article'],
      isOpenAccess: true,
      figures: [{ label: 'Fig. 1', caption: 'X', urls: ['https://example.org/a.png'] }],
      graphicalAbstract: null,
      _showTranslated: true,
    },
  ];

  await store.setPersisted(key, '0028-0836', sample);
  const rawDisk = JSON.parse(files.get('Z:/mock-zotero-data/journalflow-cache.json'));
  assert.equal(rawDisk.entries[key].articles[0].figures, null);
  assert.equal(rawDisk.entries[key].articles[0]._showTranslated, undefined);

  const restored = await store.getPersisted(key);
  assert.equal(restored.articles[0].title, 'Test Paper');

  await store.deleteByISSN('0028-0836');
  const afterDelete = await store.getPersisted(key);
  assert.equal(afterDelete, null);
});
