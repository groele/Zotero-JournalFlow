import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers.mjs';

const pub = loadTsModule('src/services/publisherNormalize.ts');

test('canonicalizePublisher maps aliases and handles empty input', () => {
  assert.equal(pub.canonicalizePublisher('Springer Science and Business Media LLC'), 'Springer Nature');
  assert.equal(pub.canonicalizePublisher('  cell press  '), 'Elsevier');
  assert.equal(pub.canonicalizePublisher(''), 'Other');
  assert.equal(pub.canonicalizePublisher(null), 'Other');
  assert.equal(pub.canonicalizePublisher(undefined), 'Other');
});

test('groupJournalsByPublisher groups and sorts by canonical publisher and title', () => {
  const journals = [
    { issn: '2041-1723', title: 'Nature Communications', publisher: 'Springer Nature' },
    { issn: '0028-0836', title: 'Nature', publisher: 'Nature Publishing Group' },
    { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
  ];

  const groups = pub.groupJournalsByPublisher(journals);
  assert.equal(groups.length, 2);

  const aaas = groups.find((g) => g.publisher === 'AAAS');
  assert.ok(aaas);
  assert.equal(aaas.journals.length, 1);
  assert.equal(aaas.journals[0].title, 'Science');

  const springer = groups.find((g) => g.publisher === 'Springer Nature');
  assert.ok(springer);
  assert.equal(springer.journals.length, 2);
  assert.equal(String(springer.journals[0].title), 'Nature');
  assert.equal(String(springer.journals[1].title), 'Nature Communications');

  assert.equal(groups[0].publisher, 'AAAS');
  assert.equal(groups[1].publisher, 'Springer Nature');
});

test('withCanonicalPublisher returns a copy with canonical publisher', () => {
  const journal = { issn: '0092-8674', title: 'Cell', publisher: 'Cell Press' };
  const next = pub.withCanonicalPublisher(journal);
  assert.notEqual(next, journal);
  assert.equal(next.publisher, 'Elsevier');
  assert.equal(journal.publisher, 'Cell Press');
});
