import { POLITE_MAILTO } from '../config';
import type { JournalArticle, JournalSubscription } from '../types';
import { httpGetJSON, uniqueURLs } from './http';

declare const Zotero: any;

export function normalizeISSN(raw: string | null | undefined): string {
  const compact = String(raw || '').replace(/[^0-9xX]/g, '').toUpperCase();
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return String(raw || '').trim().toUpperCase();
}

export function normalizeDOI(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .toLowerCase();
}

export function reconstructAbstractFromInvertedIndex(
  inv: Record<string, number[]> | null | undefined
): string {
  if (!inv || typeof inv !== 'object') return '';
  let maxIndex = -1;
  for (const positions of Object.values(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos > maxIndex) maxIndex = pos;
    }
  }
  if (maxIndex < 0 || maxIndex > 20000) return '';
  const words = new Array<string>(maxIndex + 1);
  for (const [token, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0 && pos <= maxIndex) {
        words[pos] = token;
      }
    }
  }
  const text = words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const stripped = text.replace(/^(?:Abstract|Summary)\s*[:.]?\s*/i, '');
  return stripped.length >= 25 ? stripped : text;
}

export async function searchJournalsOpenAlex(query: string): Promise<JournalSubscription[]> {
  const url =
    `https://api.openalex.org/sources?search=${encodeURIComponent(query)}` +
    `&per-page=10&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  const data = await httpGetJSON<any>(url);
  const results: any[] = data?.results || [];
  return results
    .map((src) => {
      const issnList: string[] = Array.isArray(src?.issn)
        ? src.issn.map((i: string) => normalizeISSN(i)).filter(Boolean)
        : [];
      const primary = normalizeISSN(src?.issn_l) || issnList[0] || '';
      if (!primary) return null;
      return {
        issn: primary,
        title: String(src.display_name || primary),
        publisher: String(src.host_organization_name || ''),
        altIssns: uniqueURLs([primary, ...issnList]),
      } as JournalSubscription;
    })
    .filter((j): j is JournalSubscription => Boolean(j));
}

export async function getJournalByISSNOpenAlex(issn: string): Promise<JournalSubscription | null> {
  const norm = normalizeISSN(issn);
  if (!norm) return null;
  const url =
    `https://api.openalex.org/sources/issn:${encodeURIComponent(norm)}` +
    `?mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  try {
    const src = await httpGetJSON<any>(url);
    const issnList: string[] = Array.isArray(src?.issn)
      ? src.issn.map((i: string) => normalizeISSN(i)).filter(Boolean)
      : [];
    return {
      issn: norm,
      title: String(src?.display_name || norm),
      publisher: String(src?.host_organization_name || ''),
      altIssns: uniqueURLs([norm, normalizeISSN(src?.issn_l), ...issnList]),
    };
  } catch {
    return null;
  }
}

function mapOpenAlexAuthors(authorships: any[]): string {
  if (!Array.isArray(authorships) || !authorships.length) return '';
  const names = authorships
    .map((a) => String(a?.author?.display_name || a?.raw_author_name || '').trim())
    .filter(Boolean);
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} et al.` : names.join(', ');
}

function fromCutoffISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(1, days || 14));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function fetchJournalFeedOpenAlex(
  issn: string,
  rows: number,
  days: number,
  altIssns: string[] = []
): Promise<JournalArticle[]> {
  const norm = normalizeISSN(issn);
  const issnPool = uniqueURLs([norm, ...altIssns.map((v) => normalizeISSN(v))]);
  const perPage = Math.max(10, Math.min(200, rows || 100));
  const filterParts = [`primary_location.source.issn:${issnPool.join('|')}`];
  if (days && days > 0) {
    filterParts.push(`from_publication_date:${fromCutoffISO(days)}`);
  }
  const url =
    `https://api.openalex.org/works?filter=${encodeURIComponent(filterParts.join(','))}` +
    `&sort=publication_date:desc&per-page=${perPage}&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  const data = await httpGetJSON<any>(url);
  const works: any[] = data?.results || [];

  return works
    .filter((w) => w?.title)
    .map((w) => {
      const doi = normalizeDOI(w.doi);
      const abstract = reconstructAbstractFromInvertedIndex(w.abstract_inverted_index);
      const landing = w.primary_location?.landing_page_url || w.best_oa_location?.landing_page_url || '';
      const biblio = w.biblio || {};
      const pages =
        biblio.first_page && biblio.last_page
          ? `${biblio.first_page}-${biblio.last_page}`
          : String(biblio.first_page || '');
      const fullTextLinks = uniqueURLs([
        landing,
        w.best_oa_location?.landing_page_url,
        w.open_access?.oa_url,
      ]);
      const typeLabel = w.type ? [String(w.type).toLowerCase()] : [];
      return {
        doi,
        title: String(w.title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        authors: mapOpenAlexAuthors(w.authorships),
        journal: String(w.primary_location?.source?.display_name || ''),
        issn: norm,
        date: String(w.publication_date || ''),
        volume: String(biblio.volume || ''),
        issue: String(biblio.issue || ''),
        pages,
        abstract,
        abstractSource: abstract ? 'openalex' : '',
        url: landing || (doi ? `https://doi.org/${doi}` : ''),
        fullTextLinks,
        pmcid: null,
        pubTypes: typeLabel,
        isOpenAccess: Boolean(w.open_access?.is_oa),
        figures: null,
        graphicalAbstract: null,
      };
    });
}

export async function enrichWithOpenAlex(articles: JournalArticle[]): Promise<JournalArticle[]> {
  const targets = articles.filter(
    (a) => a.doi && (!a.abstract || !a.pubTypes?.length || !a.isOpenAccess)
  );
  for (let i = 0; i < targets.length; i += 15) {
    const batch = targets.slice(i, i + 15);
    const filter = `doi:${batch.map((a) => `https://doi.org/${normalizeDOI(a.doi)}`).join('|')}`;
    const url =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      `&per-page=${batch.length}&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
    try {
      const data = await httpGetJSON<any>(url);
      const results: any[] = data?.results || [];
      for (const work of results) {
        const wDoi = normalizeDOI(work.doi);
        const article = batch.find((a) => normalizeDOI(a.doi) === wDoi);
        if (!article) continue;

        if (!article.abstract && work.abstract_inverted_index) {
          const text = reconstructAbstractFromInvertedIndex(work.abstract_inverted_index);
          if (text) {
            article.abstract = text;
            article.abstractSource = 'openalex';
          }
        }
        if (work.open_access?.is_oa) {
          article.isOpenAccess = true;
        }
        if (!article.authors && Array.isArray(work.authorships)) {
          article.authors = mapOpenAlexAuthors(work.authorships);
        }
        if (work.type) {
          const nextType = String(work.type).toLowerCase();
          if (!article.pubTypes.includes(nextType)) {
            article.pubTypes.push(nextType);
          }
        }
        const extraLinks = uniqueURLs([
          ...(article.fullTextLinks || []),
          work.primary_location?.landing_page_url,
          work.best_oa_location?.landing_page_url,
          work.open_access?.oa_url,
        ]);
        article.fullTextLinks = extraLinks;
      }
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero.debug?.(`JournalFlow: OpenAlex enrichment failed: ${error}`);
      }
    }
  }
  return articles;
}
