import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, toPlain } from './helpers.mjs';

const crossref = loadTsModule('src/services/crossref.ts');
const filtering = loadTsModule('src/services/filtering.ts');

test('stripJATS removes JATS tags, decodes entities, and strips leading Abstract prefix', () => {
  assert.equal(
    crossref.stripJATS('<jats:title>Abstract</jats:title><jats:p>A &amp; B &lt; C &gt; D</jats:p>'),
    'A & B < C > D'
  );
  assert.equal(crossref.stripJATS(''), '');
});

test('formatAuthors formats up to 8 authors and appends et al. beyond 8', () => {
  const two = crossref.formatAuthors([
    { given: 'Ada', family: 'Lovelace' },
    { name: 'Consortium' },
  ]);
  assert.equal(two, 'Ada Lovelace, Consortium');

  const ten = Array.from({ length: 10 }, (_, i) => ({ given: `G${i}`, family: `F${i}` }));
  assert.equal(
    crossref.formatAuthors(ten),
    'G0 F0, G1 F1, G2 F2, G3 F3, G4 F4, G5 F5, G6 F6, G7 F7 et al.'
  );
});

test('dateFromParts & articleDateValue normalize partial Crossref date parts', () => {
  assert.equal(crossref.dateFromParts({ 'published-online': { 'date-parts': [[2026, 4, 9]] } }), '2026-04-09');
  assert.equal(crossref.dateFromParts({ issued: { 'date-parts': [[2026, 4]] } }), '2026-04');
  assert.ok(crossref.articleDateValue({ date: '2026-04' }) > 0);
});

test('isBlockedType and filterArticleTypes hide news, editorials, corrections, and errata', () => {
  const articles = [
    { doi: '10.1/a', title: 'Single-cell spatial atlas of mammalian brain', pubTypes: ['journal article'] },
    { doi: '10.1/b', title: 'Author Correction: Some earlier paper', pubTypes: [] },
    { doi: '10.1/c', title: 'Surprising finding in oceanography', pubTypes: ['news'] },
    { doi: '10.1/d', title: 'News & Views: Quantum error correction', pubTypes: [] },
  ];
  const kept = filtering.filterArticleTypes(articles);
  assert.deepEqual(
    toPlain(kept.map((a) => a.doi)),
    ['10.1/a']
  );
});

test('filterRecentDays keeps items on or after cutoff and dedupeArticles drops duplicate titles/DOIs', () => {
  const recent = crossref.dateDaysAgo(2);
  const stale = crossref.dateDaysAgo(60);
  const input = [
    { doi: '10.1/1', title: 'Deep Learning for Molecules', date: recent },
    { doi: '10.1/2', title: 'Deep   learning for   molecules', date: recent },
    { doi: '10.1/3', title: 'Older Article', date: stale },
  ];
  const deduped = filtering.dedupeArticles(filtering.filterRecentDays(input, 14));
  assert.deepEqual(
    toPlain(deduped.map((a) => a.doi)),
    ['10.1/1']
  );
});
