import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers.mjs';

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
