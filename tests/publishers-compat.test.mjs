import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers.mjs';

const crossref = loadTsModule('src/services/crossref.ts');
const arxiv = loadTsModule('src/services/arxiv.ts');
const openalex = loadTsModule('src/services/openalex.ts');
const pubAbstracts = loadTsModule('src/services/publisherAbstracts.ts');
const pubUrls = loadTsModule('src/services/publisherUrls.ts');
const labels = loadTsModule('src/services/figureLabels.ts');
const parser = loadTsModule('src/services/figureParser.ts');

test('APS JATS alternatives deduplicates MathML and arXiv Atom parser verifies DOI before recovering abstract', () => {
  const apsJats =
    '<jats:p>We observe <jats:inline-formula><jats:alternatives><jats:tex-math>\\Delta E = \\hbar\\omega</jats:tex-math><mml:math><mi>Δ</mi><mi>E</mi><mo>=</mo><mi>ℏ</mi><mi>ω</mi></mml:math></jats:alternatives></jats:inline-formula> in bilayer graphene.</jats:p>';
  const cleaned = crossref.stripJATS(apsJats);
  assert.equal(cleaned, 'We observe \\Delta E = \\hbar\\omega in bilayer graphene.');

  const atomXML = `
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry>
        <title>Topological Magnon Band Engineering in Layered CrI3</title>
        <arxiv:doi>10.1103/PhysRevLett.135.016701</arxiv:doi>
        <summary>We report inelastic neutron scattering revealing tunable Dirac magnon gaps in honeycomb ferromagnets.</summary>
      </entry>
    </feed>
  `;
  assert.match(
    arxiv.extractArXivAbstract(atomXML, { doi: '10.1103/physrevlett.135.016701', title: 'Other' }),
    /inelastic neutron scattering/
  );
  assert.equal(
    arxiv.extractArXivAbstract(atomXML, { doi: '10.1103/wrong', title: 'Unrelated paper title here' }),
    ''
  );
});

test('reconstructAbstractFromInvertedIndex rebuilds readable abstracts and normalizes ISSNs', () => {
  assert.equal(openalex.normalizeISSN('00280836'), '0028-0836');
  assert.equal(openalex.normalizeDOI('https://doi.org/10.1038/S41586-026-0001'), '10.1038/s41586-026-0001');

  const inv = {
    Abstract: [0],
    Quantum: [1],
    error: [2],
    correction: [3],
    achieves: [4],
    below: [5],
    threshold: [6],
    'scaling.': [7],
  };
  assert.equal(
    openalex.reconstructAbstractFromInvertedIndex(inv),
    'Quantum error correction achieves below threshold scaling.'
  );
});

test('publisherAbstracts extracts Springer #Abs1-content, APS/Wiley/ACS DOM over truncated meta teasers', () => {
  const springerHTML = `
    <html><head>
      <meta name="dc.description" content="Truncated preview teaser for institutional access..." />
    </head><body>
      <div id="Abs1-content" class="c-article-section__content"><p>Cryogenic electron microscopy reveals atomic-level conformational transitions in voltage-gated channels across physiological timescales.</p></div>
    </body></html>
  `;
  assert.match(pubAbstracts.abstractFromHTML(springerHTML), /Cryogenic electron microscopy/);

  const wileyHTML = `
    <html><body>
      <section class="article-section__abstract"><div class="article-section__content">
        <p>Perovskite tandem solar cells achieve certified 33.9% power conversion efficiency using self-assembled monolayers.</p>
      </div></section>
    </body></html>
  `;
  assert.match(pubAbstracts.abstractFromHTML(wileyHTML), /Perovskite tandem solar cells/);

  const ieeeHTML = `
    <html><head>
      <meta name="og:description" content="A short truncated teaser snippet ending with..." />
    </head><body><script>
      xplGlobal.document.metadata = {"title":"Demo","abstract":"We propose a transformer accelerator delivering 4.2x throughput improvements on sparse scientific workloads."};
    </script></body></html>
  `;
  assert.match(pubAbstracts.abstractFromHTML(ieeeHTML), /transformer accelerator delivering 4\.2x/);
});

test('publisherUrls expands high-res URLs for APS, ACS, Wiley, Springer, Elsevier, PLOS, and eLife', () => {
  const aps = pubUrls.expandHighResURLs(
    'https://journals.aps.org/prl/article/10.1103/PhysRevLett.135.016701/figures/1/medium'
  );
  assert.ok(aps.includes('https://journals.aps.org/prl/article/10.1103/PhysRevLett.135.016701/figures/1/large'));

  const acs = pubUrls.expandHighResURLs('https://pubs.acs.org/cms/10.1021/jacs/asset/images/medium/ja_fig1.gif');
  assert.ok(acs.includes('https://pubs.acs.org/cms/10.1021/jacs/asset/images/large/ja_fig1.jpeg'));
  assert.ok(acs.includes('https://pubs.acs.org/cms/10.1021/jacs/asset/images/large/ja_fig1.gif'));

  const wiley = pubUrls.expandHighResURLs(
    'https://onlinelibrary.wiley.com/cms/asset/abc-123/adma20260001-fig-0001-m.jpg'
  );
  assert.ok(wiley.includes('https://onlinelibrary.wiley.com/cms/asset/abc-123/adma20260001-fig-0001-f.jpg'));

  const springer = pubUrls.expandHighResURLs(
    'https://media.springernature.com/lw685/springer-static/image/art%3A10.1007/s00220-026/fig1.png'
  );
  assert.ok(
    springer.includes('https://media.springernature.com/full/springer-static/image/art%3A10.1007/s00220-026/fig1.png')
  );

  const els = pubUrls.expandHighResURLs('https://ars.els-cdn.com/content/image/1-s2.0-S0092-gr1.jpg');
  assert.ok(els.includes('https://ars.els-cdn.com/content/image/1-s2.0-S0092-gr1_lrg.jpg'));

  const plos = pubUrls.expandHighResURLs('https://journals.plos.org/plosone/article/figure/image?size=inline&id=10.1371/g001');
  assert.ok(plos.some((u) => u.includes('size=large')));
});

test('figureLabels & figureParser handle APS, ACS Scheme S1, Wiley figure__caption, and ignore Springer HTML figure links', () => {
  assert.equal(labels.parseFigureLabelInfo('Scheme S2')?.label, 'Scheme S2');
  assert.equal(labels.parseFigureLabelInfo('Scheme S2')?.kind, 'supplementary');
  assert.equal(labels.parseFigureLabelInfo('Chart 1')?.label, 'Chart 1');
  assert.equal(labels.parseFigureLabelInfo('图 3')?.label, 'Fig. 3');
  assert.equal(labels.parseFigureLabelInfo('附图 S2')?.label, 'Fig. S2');

  const acsWileySpringerHTML = `
    <html><body>
      <figure class="c-article-section__figure">
        <a href="/article/10.1007/s00220-026/figures/1">View figure page</a>
        <img src="//media.springernature.com/lw685/springer-static/image/fig1.png" alt="Figure 1" />
        <figcaption>Figure 1 Phase diagram computed via tensor network renormalization.</figcaption>
      </figure>
      <div class="figure">
        <span class="figure__label">Scheme 1</span>
        <img data-lg-src="/cms/10.1021/jacs/asset/images/large/ja-scheme1.jpeg" src="/cms/10.1021/jacs/asset/images/medium/ja-scheme1.gif" />
        <div class="figure__caption-text">Scheme 1. Catalytic cross-coupling reaction mechanism in aqueous media.</div>
      </div>
    </body></html>
  `;
  const parsed = parser.parsePublisherVisuals(
    acsWileySpringerHTML,
    'https://link.springer.com/article/10.1007/s00220-026'
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].label, 'Fig. 1');
  assert.ok(parsed[0].urls[0].startsWith('https://media.springernature.com/full/'));
  assert.ok(!parsed[0].urls.some((u) => /\/figures\/1$/.test(u)));
  assert.equal(parsed[1].label, 'Scheme 1');
  assert.ok(parsed[1].urls[0].includes('ja-scheme1.jpeg'));
});
