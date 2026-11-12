import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, toPlain } from './helpers.mjs';

const labels = loadTsModule('src/services/figureLabels.ts');
const figures = loadTsModule('src/services/figures.ts');
const parser = loadTsModule('src/services/figureParser.ts');

test('parseFigureLabelInfo classifies main, extended, and supplementary figures accurately', () => {
  assert.deepEqual(labels.parseFigureLabelInfo('Figure 2B')?.label, 'Fig. 2b');
  assert.equal(labels.parseFigureLabelInfo('Extended Data Fig. 3a')?.kind, 'extended');
  assert.equal(labels.parseFigureLabelInfo('Extended Data Fig. 3a')?.label, 'Extended Fig. 3a');
  assert.equal(labels.parseFigureLabelInfo('Supplementary Fig. S4')?.kind, 'supplementary');
  assert.equal(labels.parseFigureLabelInfo('Supplementary Fig. S4')?.label, 'Fig. S4');
});

test('dedupeFigures merges matching figure numbers and sorts main -> extended -> supplementary', () => {
  const input = [
    { label: 'Supplementary Fig. 1', caption: 'Control controls.', urls: ['https://example.org/s1.png'] },
    { label: 'Extended Data Fig. 2', caption: 'Scaling curves.', urls: ['https://example.org/ed2-thumb.jpg'] },
    { label: 'Figure 1', caption: 'Architecture diagram.', urls: ['https://example.org/fig1.jpg'] },
    { label: 'Fig. 1', caption: '', urls: ['https://example.org/fig1-hires.jpg'] },
  ];
  const sorted = figures.dedupeFigures(input);
  assert.deepEqual(
    toPlain(sorted.map((f) => f.label)),
    ['Fig. 1', 'Extended Fig. 2', 'Fig. S1']
  );
  assert.ok(sorted[0].urls.includes('https://example.org/fig1-hires.jpg'));
});

test('parseEuropePMCFigures extracts body figures while filtering graphical abstracts & previews', () => {
  const xml = `
    <article xmlns:xlink="http://www.w3.org/1999/xlink">
      <fig fig-type="graphical-abstract"><label>GA</label><caption>Graphical Abstract</caption><graphic xlink:href="ga.jpg"/></fig>
      <fig><label>Fig. 1</label><caption>Overview of crystal growth kinetics.</caption><graphic xlink:href="fig1.gif"/></fig>
    </article>
  `;
  const parsed = parser.parseEuropePMCFigures(xml, 'PMC999999');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, 'Fig. 1');
  assert.ok(parsed[0].urls.some((u) => u.includes('europepmc.org/articles/PMC999999/bin/fig1.jpg')));
});

test('parsePublisherVisuals parses HTML figure elements, expands hi-res variants, and skips icons', () => {
  const html = `
    <html><body><article>
      <figure class="article-figure">
        <a href="/media/fig1_full.png">Hi-Res</a>
        <img src="https://cdn.example.org/cdn-cgi/image/width=200/fig1.png" alt="Figure 1" />
        <figcaption>Figure 1: Cryo-EM density map at 2.8 A resolution.</figcaption>
      </figure>
      <figure class="social-preview">
        <img src="/assets/twitter-logo.png" alt="Share" />
      </figure>
    </article></body></html>
  `;
  const parsed = parser.parsePublisherVisuals(html, 'https://journal.example.org/paper/1');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, 'Fig. 1');
  assert.equal(parsed[0].caption, 'Cryo-EM density map at 2.8 A resolution.');
  assert.ok(parsed[0].urls.includes('https://journal.example.org/media/fig1_full.png'));
});
