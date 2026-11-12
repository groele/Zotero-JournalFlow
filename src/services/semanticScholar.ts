import type { JournalArticle } from '../types';
import { httpPostJSON, uniqueURLs } from './http';
import { normalizeDOI } from './openalex';

declare const Zotero: any;

const S2_BATCH_URL =
  'https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,abstract,isOpenAccess,openAccessPdf';

export async function enrichWithSemanticScholar(
  articles: JournalArticle[]
): Promise<JournalArticle[]> {
  const targets = articles.filter(
    (a) => a.doi && (!a.abstract || !a.isOpenAccess)
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
        if (typeof oaPdf === 'string' && oaPdf) {
          article.fullTextLinks = uniqueURLs([...(article.fullTextLinks || []), oaPdf]);
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
