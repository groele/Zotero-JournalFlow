import type { JournalArticle } from '../types';
import { httpGetText, uniqueURLs } from './http';
import { normalizeDOI } from './openalex';

declare const Zotero: any;

const PHYSICS_DOI_PREFIX_RE = /^10\.(?:1103|1088|1063|1007|1038|1051|1140|1098)\//i;

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(entryXML: string, tag: string): string {
  const m = entryXML.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function parseArXivIdFromEntry(entryXML: string): string {
  const idText = tagText(entryXML, 'id');
  const m = idText.match(/arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+)/i);
  return m ? m[1].replace(/v\d+$/i, '') : '';
}

export function extractArXivMatch(
  atomXML: string,
  article: Pick<JournalArticle, 'doi' | 'title'>
): { abstract: string; arxivId: string } | null {
  if (!atomXML) return null;
  const entries = atomXML.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const targetDOI = normalizeDOI(article.doi);
  const targetTitle = normalizeTitleKey(article.title);

  for (const entry of entries) {
    const entryDOI = normalizeDOI(tagText(entry, 'arxiv:doi'));
    const entryTitle = normalizeTitleKey(tagText(entry, 'title'));
    const doiMatch = Boolean(targetDOI && entryDOI && entryDOI === targetDOI);
    const titleMatch = Boolean(
      targetTitle.length >= 24 && entryTitle && (entryTitle === targetTitle || entryTitle.includes(targetTitle))
    );
    if (!doiMatch && !titleMatch) continue;
    const summary = tagText(entry, 'summary');
    const arxivId = parseArXivIdFromEntry(entry);
    if (summary.length >= 40 || arxivId) {
      return { abstract: summary.length >= 40 ? summary : '', arxivId };
    }
  }
  return null;
}

export function extractArXivAbstract(
  atomXML: string,
  article: Pick<JournalArticle, 'doi' | 'title'>
): string {
  return extractArXivMatch(atomXML, article)?.abstract || '';
}

export async function enrichArticleWithArXiv(article: JournalArticle): Promise<boolean> {
  const hasArXivLink = (article.fullTextLinks || []).some((u) => /arxiv\.org\/html\//i.test(u));
  if (article.abstract && hasArXivLink) return false;
  if (
    !PHYSICS_DOI_PREFIX_RE.test(article.doi || '') &&
    !(article.fullTextLinks || []).some((u) => /arxiv\.org/i.test(u))
  ) {
    return false;
  }
  try {
    const doi = normalizeDOI(article.doi);
    const q = doi
      ? `all:"${doi}"`
      : `ti:"${article.title.replace(/["']/g, ' ').slice(0, 120)}"`;
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=2`;
    const xml = await httpGetText(url, { timeout: 9000, retries: 1 });
    const match = extractArXivMatch(xml, article);
    if (match?.arxivId) {
      article.isOpenAccess = true;
      article.fullTextLinks = uniqueURLs([
        ...(article.fullTextLinks || []),
        `https://arxiv.org/html/${match.arxivId}/`,
        `https://arxiv.org/abs/${match.arxivId}`,
      ]);
    }
    if (!article.abstract && match?.abstract) {
      article.abstract = match.abstract;
      article.abstractSource = 'arxiv';
      return true;
    }
  } catch (error) {
    if (typeof Zotero !== 'undefined') {
      Zotero.debug?.(`JournalFlow: arXiv abstract fallback failed for ${article.doi}: ${error}`);
    }
  }
  return false;
}

export async function enrichWithArXiv(
  articles: JournalArticle[],
  concurrency = 3
): Promise<JournalArticle[]> {
  const candidates = articles
    .filter(
      (a) =>
        !a.abstract &&
        (PHYSICS_DOI_PREFIX_RE.test(a.doi || '') ||
          (a.fullTextLinks || []).some((u) => /arxiv\.org/i.test(u)))
    )
    .slice(0, 16);

  let next = 0;
  const workerCount = Math.min(Math.max(1, concurrency), candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < candidates.length) {
        const article = candidates[next++];
        await enrichArticleWithArXiv(article);
      }
    })
  );
  return articles;
}
