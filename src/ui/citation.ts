import type { JournalArticle } from '../types';

export function formatArticleBibTeX(article: JournalArticle): string {
  const firstAuthor =
    String(article.authors || 'unknown')
      .split(',')[0]
      ?.trim()
      .split(/\s+/)
      .pop()
      ?.replace(/[^a-zA-Z0-9]/g, '') || 'paper';
  const year = (article.date || '').match(/^\d{4}/)?.[0] || String(new Date().getFullYear());
  const firstWord =
    String(article.title || 'article')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .find((w) => w.length >= 3 && !['the', 'and', 'for', 'with'].includes(w)) || 'study';
  const citeKey = `${firstAuthor}${year}${firstWord}`;

  const authors = String(article.authors || '')
    .replace(/\s+et al\.?$/i, ' and others')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' and ');

  const lines = [`@article{${citeKey},`];
  if (article.title) lines.push(`  title = {${article.title}},`);
  if (authors) lines.push(`  author = {${authors}},`);
  if (article.journal) lines.push(`  journal = {${article.journal}},`);
  lines.push(`  year = {${year}},`);
  if (article.volume) lines.push(`  volume = {${article.volume}},`);
  if (article.issue) lines.push(`  number = {${article.issue}},`);
  if (article.pages) lines.push(`  pages = {${article.pages}},`);
  if (article.doi) lines.push(`  doi = {${article.doi}},`);
  if (article.url) lines.push(`  url = {${article.url}},`);
  lines.push('}');
  return lines.join('\n');
}

export async function copyPlainText(text: string, doc: Document): Promise<boolean> {
  try {
    if (doc.defaultView?.navigator?.clipboard?.writeText) {
      await doc.defaultView.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand?.('copy');
    area.remove();
    return Boolean(ok);
  } catch {
    return false;
  }
}
