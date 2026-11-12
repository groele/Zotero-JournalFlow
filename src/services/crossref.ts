import { POLITE_MAILTO } from '../config';
import type { JournalArticle, JournalSubscription } from '../types';
import { httpGetJSON, uniqueURLs } from './http';
import {
  fetchJournalFeedOpenAlex,
  getJournalByISSNOpenAlex,
  normalizeISSN,
  searchJournalsOpenAlex,
} from './openalex';
import { formatScientificTags } from './scientificText';
import { decodeEntities } from './publisherAbstracts';

declare const Zotero: any;

export function stripJATS(text: string | undefined | null): string {
  if (!text) return '';
  const withoutDuplicateMathML = String(text)
    .replace(
      /<(?:jats:)?alternatives\b[^>]*>([\s\S]*?)<\/(?:jats:)?alternatives>/gi,
      (_m, inner: string) =>
        /<(?:jats:)?tex-math\b/i.test(inner)
          ? inner.replace(/<(?:mml:)?math\b[\s\S]*?<\/(?:mml:)?math>/gi, ' ')
          : inner
    )
    .replace(/<(?:mml:)?annotation(?:-xml)?\b[^>]*>[\s\S]*?<\/(?:mml:)?annotation(?:-xml)?>/gi, ' ');
  const formatted = formatScientificTags(withoutDuplicateMathML);
  return decodeEntities(formatted.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Abstract\s*/i, '');
}

export function formatAuthors(
  authorList: Array<{ given?: string; family?: string; name?: string }> | undefined
): string {
  if (!authorList || !authorList.length) return '';
  const names = authorList
    .map((a) => {
      if (a.family) {
        return (a.given ? `${a.given} ` : '') + a.family;
      }
      return a.name || '';
    })
    .filter(Boolean);
  if (names.length > 8) {
    return `${names.slice(0, 8).join(', ')} et al.`;
  }
  return names.join(', ');
}

export function dateFromParts(work: Record<string, any>): string {
  const candidates = [
    work['published-online'],
    work['published-print'],
    work.published,
    work.issued,
    work.created,
    work.deposited,
  ];
  let yearOnlyFallback: number[] | null = null;
  for (const field of candidates) {
    const dp = field?.['date-parts'];
    if (!Array.isArray(dp) || !Array.isArray(dp[0]) || !dp[0].length) continue;
    if (dp[0].length >= 2) {
      return (dp[0] as number[]).map((n) => String(n).padStart(2, '0')).join('-');
    }
    if (!yearOnlyFallback) yearOnlyFallback = dp[0] as number[];
  }
  if (!yearOnlyFallback) return '';
  return yearOnlyFallback.map((n) => String(n).padStart(2, '0')).join('-');
}

export function dateDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export function articleDateValue(article: Pick<JournalArticle, 'date'>): number {
  if (!article.date) return 0;
  const parts = article.date.split('-');
  const normalized = [parts[0], parts[1] || '01', parts[2] || '01'].join('-');
  return Date.parse(normalized) || 0;
}

export async function searchJournals(query: string): Promise<JournalSubscription[]> {
  const crossrefURL =
    `https://api.crossref.org/journals?query=${encodeURIComponent(query)}` +
    `&rows=10&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  const [crRes, oaRes] = await Promise.allSettled([
    httpGetJSON<any>(crossrefURL),
    searchJournalsOpenAlex(query),
  ]);

  const byIssn = new Map<string, JournalSubscription>();
  if (crRes.status === 'fulfilled') {
    const items: any[] = crRes.value?.message?.items || [];
    for (const j of items) {
      if (!Array.isArray(j?.ISSN) || !j.ISSN.length) continue;
      const issns = uniqueURLs(j.ISSN.map((v: string) => normalizeISSN(v)));
      const primary = issns[0];
      if (!primary) continue;
      byIssn.set(primary, {
        issn: primary,
        title: String(j.title || primary),
        publisher: String(j.publisher || ''),
        altIssns: issns,
      });
    }
  }

  if (oaRes.status === 'fulfilled') {
    for (const j of oaRes.value) {
      const matchKey =
        (j.altIssns || [j.issn]).find((candidate) => byIssn.has(candidate)) || j.issn;
      const existing = byIssn.get(matchKey);
      if (existing) {
        existing.altIssns = uniqueURLs([...(existing.altIssns || []), ...(j.altIssns || [])]);
        if (!existing.publisher && j.publisher) existing.publisher = j.publisher;
      } else if (byIssn.size < 14) {
        byIssn.set(j.issn, j);
      }
    }
  }

  if (!byIssn.size && crRes.status === 'rejected' && oaRes.status === 'rejected') {
    throw crRes.reason;
  }
  return Array.from(byIssn.values()).slice(0, 12);
}

export async function getJournalByISSN(issn: string): Promise<JournalSubscription> {
  const norm = normalizeISSN(issn);
  const url =
    `https://api.crossref.org/journals/${encodeURIComponent(norm)}` +
    `?mailto=${encodeURIComponent(POLITE_MAILTO)}`;
  try {
    const data = await httpGetJSON<any>(url);
    const j = data?.message || {};
    const issns = Array.isArray(j.ISSN) ? uniqueURLs(j.ISSN.map((v: string) => normalizeISSN(v))) : [norm];
    if (j.title) {
      return {
        issn: norm,
        title: String(j.title),
        publisher: String(j.publisher || ''),
        altIssns: issns.length ? issns : [norm],
      };
    }
  } catch (error) {
    if (typeof Zotero !== 'undefined') {
      Zotero.debug?.(`JournalFlow: Crossref ISSN lookup failed for ${norm}: ${error}`);
    }
  }
  const oa = await getJournalByISSNOpenAlex(norm);
  if (oa) return oa;
  return { issn: norm, title: norm, publisher: '', altIssns: [norm] };
}

export async function fetchJournalFeed(
  issn: string,
  rows: number,
  days: number,
  altIssns: string[] = []
): Promise<JournalArticle[]> {
  const norm = normalizeISSN(issn);
  const allIssns = uniqueURLs([norm, ...altIssns.map((v) => normalizeISSN(v))]);
  const filters = ['type:journal-article'];
  if (days && days > 0) {
    filters.push(`from-pub-date:${dateDaysAgo(days)}`);
  }
  const select =
    'DOI,title,author,abstract,issued,published,published-online,published-print,created,deposited,container-title,volume,issue,page,URL,link,ISSN';
  const journalURL =
    `https://api.crossref.org/journals/${encodeURIComponent(norm)}/works` +
    `?sort=published&order=desc&rows=${rows}` +
    `&filter=${encodeURIComponent(filters.join(','))}` +
    `&select=${select}&mailto=${encodeURIComponent(POLITE_MAILTO)}`;

  let data: any;
  try {
    data = await httpGetJSON<any>(journalURL);
  } catch (error) {
    if (typeof Zotero !== 'undefined') {
      Zotero.debug?.(`JournalFlow: Crossref journal endpoint failed for ${norm}: ${error}`);
    }
  }

  let items: any[] = data?.message?.items || [];
  if (days && days > 0 && items.length < Math.min(12, rows)) {
    try {
      const createdFilters = ['type:journal-article', `from-created-date:${dateDaysAgo(days)}`];
      const createdURL =
        `https://api.crossref.org/journals/${encodeURIComponent(norm)}/works` +
        `?sort=created&order=desc&rows=${Math.min(rows, 80)}` +
        `&filter=${encodeURIComponent(createdFilters.join(','))}` +
        `&select=${select}&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
      const createdData = await httpGetJSON<any>(createdURL);
      const seenDois = new Set(items.map((w) => String(w?.DOI || '').toLowerCase()).filter(Boolean));
      for (const w of createdData?.message?.items || []) {
        const doi = String(w?.DOI || '').toLowerCase();
        if (!doi || !seenDois.has(doi)) {
          if (doi) seenDois.add(doi);
          items.push(w);
        }
      }
    } catch {}
  }

  if (!items.length) {
    try {
      const issnFilters = allIssns.map((id) => `issn:${id}`);
      const genericURL =
        `https://api.crossref.org/works?sort=published&order=desc&rows=${rows}` +
        `&filter=${encodeURIComponent(filters.concat(issnFilters).join(','))}` +
        `&select=${select}&mailto=${encodeURIComponent(POLITE_MAILTO)}`;
      const fallbackData = await httpGetJSON<any>(genericURL);
      items = fallbackData?.message?.items || [];
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero.debug?.(`JournalFlow: Crossref generic works failed for ${norm}: ${error}`);
      }
    }
  }

  if (!items.length) {
    return fetchJournalFeedOpenAlex(norm, rows, days, allIssns);
  }

  return items
    .filter((w) => Array.isArray(w?.title) && w.title.length > 0)
    .map((w) => ({
      doi: String(w.DOI || ''),
      title: stripJATS(w.title[0]),
      authors: formatAuthors(w.author),
      journal: (w['container-title'] && w['container-title'][0]) || '',
      issn: norm,
      date: dateFromParts(w),
      volume: w.volume || '',
      issue: w.issue || '',
      pages: w.page || '',
      abstract: stripJATS(w.abstract),
      abstractSource: w.abstract ? 'crossref' : '',
      url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : ''),
      fullTextLinks: (w.link || []).map((l: any) => l?.URL).filter(Boolean),
      pmcid: null,
      pubTypes: [],
      isOpenAccess: false,
      figures: null,
      graphicalAbstract: null,
    }));
}
