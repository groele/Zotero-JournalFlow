import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadTsModule } from './helpers.mjs';

const pub = loadTsModule('src/services/publisherNormalize.ts');
const { setScope, createInitialFeedState } = loadTsModule('src/ui/feedState.ts');
const { renderJournalListTree } = loadTsModule('src/ui/sidebarTree.ts');

test('groupJournalsByPublisher clusters mixed and empty publishers under Other', () => {
  const journals = [
    { issn: '2041-1723', title: 'Nature Communications', publisher: 'NPG' },
    { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
    { issn: '0000-0001', title: 'Mystery Journal', publisher: '' },
  ];
  const groups = pub.groupJournalsByPublisher(journals);
  assert.equal(groups.length, 3);
  const other = groups.find((g) => g.publisher === 'Other');
  assert.ok(other);
  assert.equal(other.journals.length, 1);
});

test('setScope keeps activeISSN in sync for issn scope only', () => {
  const state = createInitialFeedState();
  setScope(state, { type: 'publisher', id: 'Elsevier' });
  assert.equal(state.activeISSN, null);
  setScope(state, { type: 'issn', id: '0092-8674' });
  assert.equal(state.activeISSN, '0092-8674');
  setScope(state, { type: 'all', id: null });
  assert.equal(state.activeISSN, null);
});

test('renderJournalListTree smoke: publisher nodes and journal children in DOM', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><ul id="journal-list"></ul></body></html>');
  const doc = dom.window.document;
  const state = createInitialFeedState();
  state.journals = [
    { issn: '0028-0836', title: 'Nature', publisher: 'Nature Publishing Group' },
    { issn: '0036-8075', title: 'Science', publisher: 'AAAS' },
  ];
  const strings = {
    'all-journals': 'All journals',
    'publisher-other': 'Other',
    'collapse-publisher': 'Collapse',
    'expand-publisher': 'Expand',
  };
  const ctx = {
    JournalFlow: {
      getString: (id) => strings[id] || id,
      unfollowJournal: (issn) => state.journals.filter((j) => j.issn !== issn),
    },
  };
  let reloads = 0;
  renderJournalListTree(doc, ctx, state, () => {
    reloads += 1;
  });
  const list = doc.getElementById('journal-list');
  assert.ok(list);
  assert.ok(list.querySelector('li.publisher-node'));
  assert.equal(list.querySelectorAll('li.journal-node').length, 2);
  const publisher = list.querySelector('li.publisher-node');
  assert.equal(publisher?.lastElementChild?.classList.contains('publisher-toggle'), true);
  assert.ok(publisher?.querySelector('.jcount'));
  // Collapse first, then header click expands like Zotero item-pane accordion
  const springer = Array.from(list.querySelectorAll('li.publisher-node')).find((n) =>
    n.textContent?.includes('Springer')
  );
  assert.ok(springer);
  state.collapsedPublishers.add('Springer Nature');
  renderJournalListTree(doc, ctx, state, () => {
    reloads += 1;
  });
  const hiddenBefore = doc.querySelectorAll('#journal-list li.journal-node[hidden]').length;
  assert.ok(hiddenBefore >= 1);
  doc.querySelector('li.publisher-node.is-collapsed')?.click();
  assert.equal(doc.querySelectorAll('#journal-list li.journal-node[hidden]').length, 0);
  assert.ok(reloads >= 1);
  const justExpanded = doc.querySelectorAll('#journal-list li.journal-node.is-just-expanded');
  assert.equal(justExpanded.length, 1, 'newly expanded children animate once');

  // Re-rendering without toggling does not replay expand animation
  renderJournalListTree(doc, ctx, state, () => {
    reloads += 1;
  });
  assert.equal(doc.querySelectorAll('#journal-list li.journal-node.is-just-expanded').length, 0);

  // Clicking chevron on expanded publisher collapses children cleanly without changing feed scope
  const reloadsBeforeCollapse = reloads;
  const springerNow = Array.from(doc.querySelectorAll('#journal-list li.publisher-node')).find((n) =>
    n.textContent?.includes('Springer')
  );
  springerNow?.querySelector('button.publisher-toggle')?.click();
  assert.equal(doc.querySelectorAll('#journal-list li.journal-node[hidden]').length, 1);
  assert.equal(reloads, reloadsBeforeCollapse);
});
