import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, toPlain } from './helpers.mjs';

const labels = loadTsModule('src/services/figureLabels.ts');
const figures = loadTsModule('src/services/figures.ts');
const parser = loadTsModule('src/services/figureParser.ts');
const fallback = loadTsModule('src/services/figureFallback.ts');

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

test('parsePublisherVisuals resolves arXiv HTML5 <base href> and unlabeled ltx_figure elements', () => {
  const html = `
    <html><head><base href="/html/2610.16091v1/"/></head><body>
      <figure class="ltx_figure">
        <img class="ltx_graphics" src="x1.png" alt="Crystal structure"/>
        <figcaption class="ltx_caption">Phase diagram across temperature.</figcaption>
      </figure>
    </body></html>
  `;
  const parsed = parser.parsePublisherVisuals(html, 'https://arxiv.org/html/2610.16091v1');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].urls[0], 'https://arxiv.org/html/2610.16091v1/x1.png');
  assert.match(parsed[0].label, /Fig\. 1/);
});

test('parseEuropePMCFallbackFigures & parseFallbackVisuals recover graphical abstracts and filter logos', () => {
  const xml = `
    <article xmlns:xlink="http://www.w3.org/1999/xlink">
      <abstract abstract-type="graphical"><graphic xlink:href="ga-panel.png"/></abstract>
    </article>
  `;
  const xmlFigs = fallback.parseEuropePMCFallbackFigures(xml, 'PMC777777');
  assert.equal(xmlFigs.length, 1);
  assert.equal(xmlFigs[0].label, 'Graphical Abstract');
  assert.ok(xmlFigs[0].urls.some((u) => u.includes('PMC777777/bin/ga-panel.png')));

  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example.org/default-cover.png"/>
      <meta property="og:image" content="https://cdn.example.org/paper-toc.png"/>
    </head><body></body></html>
  `;
  const fb = fallback.parseFallbackVisuals(html, 'https://cdn.example.org/article/1');
  assert.equal(fb.length, 1);
  assert.deepEqual(toPlain(fb[0].urls), ['https://cdn.example.org/paper-toc.png']);
});

test('isUsefulImageURL preserves scientific terms, allows scientific SVGs, adds PMC NCBI CDN, and drops viewer popup links', () => {
  // Scientific words containing 'icon' / 'share' / scientific SVGs must NOT be false-positived
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/silicon_device_fig1.png'), true);
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/semiconductor_band_figure.svg'), true);
  assert.equal(figures.isUsefulImageURL('https://arxiv.org/html/2610.16091v1/shared_phase.png'), true);
  assert.equal(figures.isUsefulImageURL('https://arxiv.org/html/2610.16091v1/x1.svg'), true);

  // Noise logos, favicons, share buttons, and non-figure SVGs must still be blocked
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/assets/site-logo.png'), false);
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/icons/share_icon.png'), false);
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/favicon.ico'), false);
  assert.equal(figures.isUsefulImageURL('https://cdn.example.org/assets/orcid.svg'), false);

  // Modern pmc.ncbi.nlm.nih.gov mirror included in PMC candidate URLs
  const pmcUrls = figures.figureImageURLs('PMC123456', 'fig1.gif');
  assert.ok(pmcUrls.includes('https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/bin/fig1.jpg'));

  // HTML viewer popup links inside <figure> should be ignored in favor of real <img>
  const html = `
    <html><body><article>
      <figure>
        <a href="/action/showPopup?citid=fig1">View full size</a>
        <img src="/cms/asset/fig1.png" alt="Figure 1" />
        <figcaption>Figure 1: Gate tunable superconductivity.</figcaption>
      </figure>
    </article></body></html>
  `;
  const parsed = parser.parsePublisherVisuals(html, 'https://journals.example.org/doi/10.1000/1');
  assert.equal(parsed.length, 1);
  assert.deepEqual(toPlain(parsed[0].urls), ['https://journals.example.org/cms/asset/fig1.png']);
});
