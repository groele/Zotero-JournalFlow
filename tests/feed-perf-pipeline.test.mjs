import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT, loadTsModule } from './helpers.mjs';

test('createSemaphore limits concurrent in-flight work', async () => {
  const { createSemaphore } = loadTsModule('src/utils/concurrency.ts');
  const gate = createSemaphore(2);
  let inFlight = 0;
  let maxInFlight = 0;
  const hold = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await Promise.all(
    Array.from({ length: 6 }, () =>
      gate.run(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await hold(20);
        inFlight--;
      })
    )
  );

  assert.ok(maxInFlight <= 2, `expected max concurrency 2, saw ${maxInFlight}`);
});

test('FeedCoordinator.getFeed does not await enrichBatchMetadata on critical path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/host/feedCoordinator.ts'), 'utf8');
  const getFeedMatch = src.match(/async getFeed\([\s\S]*?\n  \}/);
  assert.ok(getFeedMatch, 'getFeed method body not found');
  const body = getFeedMatch[0];
  assert.ok(
    !/await\s+enrichBatchMetadata/.test(body),
    'getFeed must not await enrichBatchMetadata; enrichment belongs in enrichFeedMetadata'
  );
  assert.ok(/async enrichFeedMetadata/.test(src), 'enrichFeedMetadata should offload batch metadata enrichment');
});

test('runWithConcurrency is exported from enrichment for backward compatibility', () => {
  const enrichment = loadTsModule('src/services/enrichment.ts');
  assert.equal(typeof enrichment.runWithConcurrency, 'function');
  const utils = loadTsModule('src/utils/concurrency.ts');
  assert.equal(typeof utils.runWithConcurrency, 'function');
});

test('resolveFeedTargets uses FeedScope.id for issn and publisher filters', () => {
  const feedLoadSrc = fs.readFileSync(path.join(ROOT, 'src/ui/feedLoad.ts'), 'utf8');
  assert.match(feedLoadSrc, /scope\?\.type === 'issn' && scope\.id/);
  assert.match(feedLoadSrc, /scope\?\.type === 'publisher' && scope\.id/);
  assert.doesNotMatch(feedLoadSrc, /scope\.issn\b/);
  assert.doesNotMatch(feedLoadSrc, /scope\.publisher\b/);
});
