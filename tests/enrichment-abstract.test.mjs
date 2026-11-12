import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, toPlain } from './helpers.mjs';

const enrichment = loadTsModule('src/services/enrichment.ts');

test('metaAbstractFromHTML prioritizes scientific meta tags and rejects navigation boilerplate', () => {
  const html = `
    <html><head>
      <meta name="description" content="Home search sign in subscribe"/>
      <meta name="citation_abstract" content="Abstract: We demonstrate high-efficiency electrocatalytic CO2 reduction across copper-nickel interfaces."/>
    </head></html>
  `;
  assert.equal(
    enrichment.metaAbstractFromHTML(html),
    'We demonstrate high-efficiency electrocatalytic CO2 reduction across copper-nickel interfaces.'
  );
});

test('jsonLDAbstractFromHTML extracts abstract from @graph and nested structures', () => {
  const html = `
    <script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"ScholarlyArticle","abstract":{"text":"Single-molecule FRET reveals conformational dynamics of CRISPR-Cas12a cleavage."}}]}
    </script>
  `;
  assert.equal(
    enrichment.jsonLDAbstractFromHTML(html),
    'Single-molecule FRET reveals conformational dynamics of CRISPR-Cas12a cleavage.'
  );
});

test('abstractFromHTML falls back to JSON-LD when meta tags contain only short fluff', () => {
  const html = `
    <meta name="og:description" content="Too short"/>
    <script type="application/ld+json">
      {"description":"Large-scale benchmark of multimodal scientific agents on wet-lab reasoning tasks."}
    </script>
  `;
  assert.equal(
    enrichment.abstractFromHTML(html),
    'Large-scale benchmark of multimodal scientific agents on wet-lab reasoning tasks.'
  );
});

test('getVisualSourcePages deduplicates URLs and excludes binary files (.pdf, .zip)', async () => {
  const article = {
    doi: '10.1038/test-1',
    url: 'https://www.nature.com/articles/test-1',
    fullTextLinks: [
      'https://www.nature.com/articles/test-1.pdf',
      'https://www.nature.com/articles/test-1',
    ],
    _unpaywall: {
      is_oa: true,
      best_oa_location: {
        url_for_landing_page: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/paper.pdf',
      },
      oa_locations: [],
    },
  };
  const pages = await enrichment.getVisualSourcePages(article, { includeUnpaywall: true });
  assert.equal(article.isOpenAccess, true);
  assert.deepEqual(toPlain(pages), [
    'https://www.nature.com/articles/test-1',
    'https://doi.org/10.1038/test-1',
    'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/',
  ]);
});
