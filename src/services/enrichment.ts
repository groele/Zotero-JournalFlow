import { POLITE_MAILTO } from '../config';
import type { JournalArticle, UnpaywallRecord } from '../types';
import { stripJATS } from './crossref';
import { httpGetHTML, httpGetJSON, uniqueURLs } from './http';
import { enrichArticleWithArXiv, enrichWithArXiv } from './arxiv';
import { enrichWithOpenAlex } from './openalex';
import { enrichWithSemanticScholar } from './semanticScholar';
import { runWithConcurrency } from '../utils/concurrency';
import {
  abstractFromHTML,
  decodeEntities,
  domAbstractFromHTML,
  jsonLDAbstractFromHTML,
  metaAbstractFromHTML,
  normalizeAbstract,
} from './publisherAbstracts';

declare const Zotero: any;

export {
  abstractFromHTML,
  decodeEntities,
  domAbstractFromHTML,
  enrichArticleWithArXiv,
  enrichWithArXiv,
  enrichWithOpenAlex,
  enrichWithSemanticScholar,
  jsonLDAbstractFromHTML,
  metaAbstractFromHTML,
  normalizeAbstract,
};

export { runWithConcurrency } from '../utils/concurrency';

export async function enrichWithEuropePMC(articles: JournalArticle[]): Promise<JournalArticle[]> {
  const withDOI = articles.filter((a) => a.doi);
  const batches: JournalArticle[][] = [];
  for (let i = 0; i < withDOI.length; i += 10) {
    batches.push(withDOI.slice(i, i + 10));
  }
  await runWithConcurrency(batches, 3, async (batch) => {
    const query = batch.map((a) => `DOI:"${a.doi}"`).join(' OR ');
    const url =
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}` +
      `&resultType=core&format=json&pageSize=${batch.length}`;
    try {
      const data = await httpGetJSON<any>(url);
      const results: any[] = data?.resultList?.result || [];
      for (const r of results) {
        const article = batch.find(
          (a) => r.doi && a.doi.toLowerCase() === String(r.doi).toLowerCase()
        );
        if (!article) continue;
        if (!article.abstract && r.abstractText) {
          article.abstract = stripJATS(r.abstractText);
          article.abstractSource = 'europepmc';
        }
        article.pmcid = r.pmcid || article.pmcid || null;
        if (r.isOpenAccess === 'Y') article.isOpenAccess = true;
        if (!article.authors && r.authorString) {
          article.authors = r.authorString;
        }
        if (r.pubTypeList?.pubType) {
          article.pubTypes = ([] as unknown[])
            .concat(r.pubTypeList.pubType)
            .map((t) => String(t).toLowerCase());
        }
      }
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero.debug?.(`JournalFlow: Europe PMC enrichment failed: ${error}`);
      }
    }
  });
  return articles;
}

export async function enrichBatchMetadata(articles: JournalArticle[]): Promise<JournalArticle[]> {
  await Promise.allSettled([
    enrichWithEuropePMC(articles),
    enrichWithOpenAlex(articles),
    enrichWithSemanticScholar(articles),
  ]);
  return articles;
}

export async function fetchUnpaywall(doi: string): Promise<UnpaywallRecord | null> {
  if (!doi) return null;
  const url =
    `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}` +
    `?email=${encodeURIComponent(POLITE_MAILTO)}`;
  try {
    return await httpGetJSON<UnpaywallRecord>(url, { retries: 1 });
  } catch (error) {
    if (typeof Zotero !== 'undefined') {
      Zotero.debug?.(`JournalFlow: Unpaywall lookup failed for ${doi}: ${error}`);
    }
    return null;
  }
}

function toArXivHTMLURL(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/https?:\/\/arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/i);
  if (!m) return null;
  const id = m[1].replace(/\.pdf$/i, '').replace(/\/+$/, '');
  return id ? `https://arxiv.org/html/${id}/` : null;
}

export async function getVisualSourcePages(
  article: JournalArticle,
  options: { includeUnpaywall?: boolean } = {}
): Promise<string[]> {
  const urls: Array<string | undefined> = [];
  if (article.url) {
    urls.push(article.url);
    const arxivSelf = toArXivHTMLURL(article.url);
    if (arxivSelf) urls.push(arxivSelf);
  }
  if (article.doi) {
    urls.push(`https://doi.org/${article.doi}`);
    const arxivDoi = article.doi.match(/^10\.48550\/arxiv\.([^\s?#]+)$/i);
    if (arxivDoi?.[1]) {
      urls.push(`https://arxiv.org/html/${arxivDoi[1]}/`);
    }
  }
  if (article.pmcid) {
    urls.push(
      `https://europepmc.org/article/PMC/${article.pmcid}`,
      `https://pmc.ncbi.nlm.nih.gov/articles/${article.pmcid}/`
    );
  }
  for (const url of article.fullTextLinks || []) {
    const arxivHTML = toArXivHTMLURL(url);
    if (arxivHTML) urls.push(arxivHTML);
    urls.push(url);
  }

  const includeUnpaywall = options.includeUnpaywall !== false;
  if (includeUnpaywall && article.doi && article._unpaywall === undefined) {
    article._unpaywall = await fetchUnpaywall(article.doi);
  }
  const oa = includeUnpaywall ? article._unpaywall : null;
  if (oa) {
    if (oa.best_oa_location) {
      const arxivBest =
        toArXivHTMLURL(oa.best_oa_location.url_for_landing_page) ||
        toArXivHTMLURL(oa.best_oa_location.url);
      if (arxivBest) urls.push(arxivBest);
      urls.push(oa.best_oa_location.url_for_landing_page);
      urls.push(oa.best_oa_location.url);
    }
    for (const loc of oa.oa_locations || []) {
      const arxivLoc = toArXivHTMLURL(loc.url_for_landing_page) || toArXivHTMLURL(loc.url);
      if (arxivLoc) urls.push(arxivLoc);
      urls.push(loc.url_for_landing_page);
      urls.push(loc.url);
    }
    if (oa.is_oa) {
      article.isOpenAccess = true;
    }
  }

  return uniqueURLs(urls)
    .filter((u) => !/\.(pdf|zip|docx?|pptx?|epub|xml|ris|bib)([?#].*)?$/i.test(u))
    .slice(0, 10);
}

export async function enrichSingleArticleAbstract(
  article: JournalArticle,
  options: { includeUnpaywall?: boolean } = {}
): Promise<boolean> {
  if (article.abstract) return false;
  if (await enrichArticleWithArXiv(article)) {
    return true;
  }
  const pages = await getVisualSourcePages(article, {
    includeUnpaywall: Boolean(options.includeUnpaywall),
  });
  for (const url of pages) {
    try {
      const page = await httpGetHTML(url);
      const abstract = abstractFromHTML(page.text);
      if (abstract) {
        article.abstract = abstract;
        article.abstractSource = 'publisher';
        return true;
      }
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero.debug?.(`JournalFlow: abstract fallback skipped for ${url}: ${error}`);
      }
    }
  }
  return false;
}

export async function enrichMissingAbstracts(
  articles: JournalArticle[],
  onRecovered?: (article: JournalArticle) => void,
  concurrency = 4
): Promise<JournalArticle[]> {
  const missing = articles.filter((a) => !a.abstract && (a.url || a.doi)).slice(0, 50);
  await runWithConcurrency(missing, concurrency, async (article) => {
    const ok = await enrichSingleArticleAbstract(article, { includeUnpaywall: false });
    if (ok) onRecovered?.(article);
  });
  return articles;
}
