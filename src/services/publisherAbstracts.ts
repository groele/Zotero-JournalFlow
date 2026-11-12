import { extractAdapterEmbeddedAbstracts, getAllAbstractSelectors } from './publisherAdapters';
import { formatScientificTags } from './scientificText';

export function decodeEntities(text: string): string {
  return (text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&times;/gi, '×')
    .replace(/&plusmn;/gi, '±')
    .replace(/&mu;/gi, 'μ')
    .replace(/&alpha;/gi, 'α')
    .replace(/&beta;/gi, 'β')
    .replace(/&gamma;/gi, 'γ')
    .replace(/&delta;/gi, 'δ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}

export function normalizeAbstract(text: unknown): string {
  const formatted = formatScientificTags(String(text || ''));
  const value = decodeEntities(formatted.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:Abstract|Summary|Highlights)\s*[:.]?\s*/i, '');
  if (value.length < 40) return '';
  if (/^(home|search|privacy|cookie|javascript|sign in|subscribe|log in|skip to)\b/i.test(value)) {
    return '';
  }
  return value;
}

function isLikelyTruncatedTeaser(text: string): boolean {
  return text.length < 220 && /(?:\.{3}|…|\[\.{3}\]|read more)$/i.test(text);
}

function parseTagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[3] || m[4] || m[5] || '';
  }
  return attrs;
}

export function metaAbstractFromHTML(html: string): string {
  const highPriority = [
    'citation_abstract',
    'dc.description',
    'dcterms.abstract',
    'dcterms.description',
    'eprints.abstract',
  ];
  const lowPriority = ['prism.teaser', 'description', 'og:description', 'twitter:description'];
  const collected = new Map<string, string>();
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    const attrs = parseTagAttrs(m[0]);
    const key = (attrs.name || attrs.property || '').toLowerCase();
    if (!highPriority.includes(key) && !lowPriority.includes(key)) continue;
    const abstract = normalizeAbstract(attrs.content);
    if (abstract && !collected.has(key)) {
      collected.set(key, abstract);
    }
  }
  for (const key of highPriority) {
    const hit = collected.get(key);
    if (hit && !isLikelyTruncatedTeaser(hit)) return hit;
  }
  for (const key of lowPriority) {
    const hit = collected.get(key);
    if (hit && !isLikelyTruncatedTeaser(hit)) return hit;
  }
  return '';
}

export function jsonLDAbstractFromHTML(html: string): string {
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    try {
      const data = JSON.parse(decodeEntities(m[1]).trim());
      const nodes: any[] = Array.isArray(data) ? data.slice() : [data];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node['@graph'])) {
          nodes.push(...node['@graph']);
        }
        for (const key of ['abstract', 'description']) {
          let value = node[key];
          if (Array.isArray(value)) {
            value = value
              .map((v: any) => (typeof v === 'string' ? v : v?.text))
              .filter(Boolean)
              .join(' ');
          } else if (value && typeof value === 'object') {
            value = value.text || value.value || '';
          }
          const abstract = normalizeAbstract(value);
          if (abstract && !isLikelyTruncatedTeaser(abstract)) return abstract;
        }
      }
    } catch {
      // Ignore malformed publisher JSON-LD.
    }
  }
  return '';
}

function embeddedAdapterAbstractFromHTML(html: string): string {
  for (const raw of extractAdapterEmbeddedAbstracts(html)) {
    const clean = normalizeAbstract(raw);
    if (clean) return clean;
  }
  return '';
}

const GENERIC_ABSTRACT_SELECTORS = [
  '.articleBody_abstractText',
  'section.abstract',
  '[data-test="abstract"]',
  '.NLM_abstract',
  '.article__abstract',
  '.abstract-content',
  'blockquote.abstract',
  '#abstract',
];

const PUBLISHER_ABSTRACT_SELECTORS = Array.from(
  new Set([...getAllAbstractSelectors(), ...GENERIC_ABSTRACT_SELECTORS])
);

export function domAbstractFromHTML(html: string, parser = new DOMParser()): string {
  if (!html || typeof parser === 'undefined') return '';
  try {
    const doc = parser.parseFromString(html, 'text/html');
    for (const sel of PUBLISHER_ABSTRACT_SELECTORS) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const text = normalizeAbstract((el as HTMLElement).innerHTML || el.textContent);
      if (text && !isLikelyTruncatedTeaser(text)) {
        return text;
      }
    }
  } catch {
    // Non-fatal HTML DOM parsing guard
  }
  return '';
}

export function abstractFromHTML(html: string, parser?: DOMParser): string {
  return (
    metaAbstractFromHTML(html) ||
    jsonLDAbstractFromHTML(html) ||
    embeddedAdapterAbstractFromHTML(html) ||
    domAbstractFromHTML(html, parser)
  );
}
