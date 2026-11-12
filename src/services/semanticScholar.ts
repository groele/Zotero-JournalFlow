import type { JournalArticle } from '../types';
import { httpPostJSON, uniqueURLs } from './http';
import { normalizeDOI } from './openalex';

declare const Zotero: any;

const S2_BATCH_URL =
  'https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,abstract,isOpenAccess,openAccessPdf';

function normalizeArXivID(raw: unknown): string {
  const clean = String(raw || '')
    .trim()
    .replace(/^arxiv:\s*/i, '');
  return /^[a-z0-9.\-/]+$/i.test(clean) && /\d{4}\.\d{4,5}|[a-z-]+\/\d{7}/i.test(clean) ? clean : '';
}

export async function enrichWithSemanticScholar(
  articles: JournalArticle[]
): Promise<JournalArticle[]> {
  const targets = articles.filter(
    (a) =>
      a.doi &&
      (!a.abstract || !a.isOpenAccess || !(a.fullTextLinks || []).some((u) => /arxiv\.org\/html\//i.test(u)))
  );
  if (!targets.length) return articles;

  for (let i = 0; i < targets.length; i += 40) {
    const batch = targets.slice(i, i + 40);
    const ids = batch.map((a) => `DOI:${normalizeDOI(a.doi)}`);
    try {
      const results = await httpPostJSON<any[]>(S2_BATCH_URL, { ids }, { timeout: 12000, retries: 1 });
      if (!Array.isArray(results)) continue;
      for (let idx = 0; idx < batch.length; idx++) {
        const record = results[idx];
        const article = batch[idx];
        if (!record || typeof record !== 'object') continue;

        if (!article.abstract && typeof record.abstract === 'string') {
          const clean = record.abstract.replace(/\s+/g, ' ').trim();
          if (clean.length >= 40) {
            article.abstract = clean;
            article.abstractSource = 'semanticscholar';
          }
        }
        if (record.isOpenAccess) {
          article.isOpenAccess = true;
        }
        const oaPdf = record.openAccessPdf?.url;
        const arxivId = normalizeArXivID(record.externalIds?.ArXiv);
        const extraLinks: string[] = [];
        if (arxivId) {
          article.isOpenAccess = true;
          extraLinks.push(`https://arxiv.org/html/${arxivId}/`, `https://arxiv.org/abs/${arxivId}`);
        }
        if (typeof oaPdf === 'string' && oaPdf) {
          extraLinks.push(oaPdf);
        }
        if (extraLinks.length) {
          article.fullTextLinks = uniqueURLs([...(article.fullTextLinks || []), ...extraLinks]);
        }
      }
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero.debug?.(`JournalFlow: Semantic Scholar enrichment skipped: ${error}`);
      }
    }
  }
  return articles;
}
