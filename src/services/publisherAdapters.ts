export interface PublisherAdapter {
  id: string;
  canonicalName: string;
  matchesHost?: (hostname: string, pathname: string) => boolean;
  abstractSelectors?: readonly string[];
  extractEmbeddedAbstract?: (html: string) => string;
  expandHighResImageURLs?: (url: URL) => string[];
}

export const PUBLISHER_ADAPTERS: readonly PublisherAdapter[] = [
  {
    id: 'springer',
    canonicalName: 'Springer Nature',
    matchesHost: (host, path) =>
      /(?:^|\.)(?:nature\.com|springer\.com|springernature\.com)$/i.test(host) || /springer-static/i.test(path),
    abstractSelectors: [
      '#Abs1-content',
      '#Abs2-content',
      '[data-title="Abstract"] .c-article-section__content',
      'section[aria-labelledby="Abs1"] p',
    ],
    expandHighResImageURLs: (u) => {
      if (!/media\.springernature\.com/i.test(u.hostname) && !/springer-static/i.test(u.pathname)) return [];
      const full = new URL(u.href);
      full.pathname = u.pathname.replace(/\/(?:lw\d+|m\d+|w\d+|small|medium)\//gi, '/full/');
      return full.pathname !== u.pathname ? [full.href] : [];
    },
  },
  {
    id: 'aps',
    canonicalName: 'American Physical Society (APS)',
    matchesHost: (host) => /journals\.aps\.org/i.test(host),
    abstractSelectors: ['.article.open.abstract .content', 'section.abstract .content'],
    expandHighResImageURLs: (u) => {
      if (!/\/figures\/[^/]+\/(?:thumbnail|medium|small)\/?$/i.test(u.pathname)) return [];
      const aps = new URL(u.href);
      aps.pathname = u.pathname.replace(/\/(?:thumbnail|medium|small)\/?$/i, '/large');
      return [aps.href];
    },
  },
  {
    id: 'acs',
    canonicalName: 'American Chemical Society (ACS)',
    matchesHost: (host) => /pubs\.acs\.org/i.test(host),
    abstractSelectors: ['.article_abstract-content', '.hlFld-Abstract'],
  },
  {
    id: 'wiley',
    canonicalName: 'Wiley',
    matchesHost: (host) => /onlinelibrary\.wiley\.com/i.test(host),
    abstractSelectors: ['section.article-section__abstract .article-section__content', '.abstract-group'],
    expandHighResImageURLs: (u) => {
      if (!/[-_](?:t|m)\.(?:gif|jpe?g|png)$/i.test(u.pathname)) return [];
      const wf = new URL(u.href);
      wf.pathname = u.pathname.replace(/[-_](?:t|m)\.(gif|jpe?g|png)$/i, '-f.jpg');
      const wl = new URL(u.href);
      wl.pathname = u.pathname.replace(/[-_](?:t|m)\.(gif|jpe?g|png)$/i, '-lrg.$1');
      const wiPlain = new URL(u.href);
      wiPlain.pathname = u.pathname.replace(/[-_](?:t|m)\.(gif|jpe?g|png)$/i, '.jpg');
      return [wf.href, wl.href, wiPlain.href];
    },
  },
  {
    id: 'elsevier',
    canonicalName: 'Elsevier',
    matchesHost: (host) => /(?:sciencedirect\.com|cell\.com|ars\.els-cdn\.com|sciencedirectassets\.com)$/i.test(host),
    abstractSelectors: ['#abstracts .abstractInFull', '.abstract.author div', '#abs0010', '#abss0001'],
    expandHighResImageURLs: (u) => {
      if (!/(?:ars\.els-cdn\.com|sciencedirectassets\.com)/i.test(u.hostname)) return [];
      const lrg = new URL(u.href);
      lrg.pathname = u.pathname.replace(/([-/_](?:gr|fx|sc)\d+)(\.(?:jpe?g|png|gif))$/i, '$1_lrg$2');
      return lrg.pathname !== u.pathname ? [lrg.href] : [];
    },
  },
  {
    id: 'rsc',
    canonicalName: 'Royal Society of Chemistry (RSC)',
    matchesHost: (host) => /pubs\.rsc\.org/i.test(host),
    abstractSelectors: ['.capsule__text', 'section.abstract', '#abstract'],
  },
  {
    id: 'ieee',
    canonicalName: 'IEEE',
    matchesHost: (host) => /ieeexplore\.ieee\.org/i.test(host),
    abstractSelectors: ['.abstract-text', 'div.abstract-desktop-div'],
    extractEmbeddedAbstract: (html) => {
      const m = (html || '').match(/xplGlobal\.document\.metadata\s*=\s*(\{[\s\S]*?\});/);
      if (!m) return '';
      try {
        const meta = JSON.parse(m[1]);
        return typeof meta?.abstract === 'string' ? meta.abstract : '';
      } catch {
        return '';
      }
    },
    expandHighResImageURLs: (u) => {
      if (!/-(?:thumb|small)\.(?:gif|jpe?g|png)$/i.test(u.pathname)) return [];
      const ieee = new URL(u.href);
      ieee.pathname = u.pathname.replace(/-(?:thumb|small)(\.(?:gif|jpe?g|png))$/i, '-large$1');
      return [ieee.href];
    },
  },
  {
    id: 'plos',
    canonicalName: 'PLOS',
    matchesHost: (host) => /plos\.org/i.test(host),
    abstractSelectors: ['.abstract-content', '#abstract'],
    expandHighResImageURLs: (u) => {
      if (!u.searchParams.has('id')) return [];
      return ['large', 'original'].map((size) => {
        const plos = new URL(u.href);
        plos.searchParams.set('size', size);
        return plos.href;
      });
    },
  },
  {
    id: 'elife',
    canonicalName: 'eLife Sciences',
    matchesHost: (host) => /elifesciences\.org/i.test(host),
    abstractSelectors: ['section#abstract [role="paragraph"]', 'section.abstract'],
    expandHighResImageURLs: (u) => {
      if (!/\/full\/\d+,\//i.test(u.pathname)) return [];
      return ['max', '1500,'].map((res) => {
        const iiif = new URL(u.href);
        iiif.pathname = u.pathname.replace(/\/full\/\d+,\//i, `/full/${res}/`);
        return iiif.href;
      });
    },
  },
  {
    id: 'frontiers',
    canonicalName: 'Frontiers',
    matchesHost: (host) => /frontiersin\.org/i.test(host),
    abstractSelectors: ['.JournalAbstract', 'section.abstract'],
    expandHighResImageURLs: (u) => {
      if (!/\/image_[ms]\//i.test(u.pathname)) return [];
      const fr = new URL(u.href);
      fr.pathname = u.pathname.replace(/\/image_[ms]\//i, '/image_l/');
      return [fr.href];
    },
  },
  {
    id: 'mdpi',
    canonicalName: 'MDPI',
    matchesHost: (host) => /mdpi\.com/i.test(host),
    abstractSelectors: ['section.html-abstract', '.art-abstract'],
    expandHighResImageURLs: (u) => {
      if (!/-g\d+-\d+\.(?:jpe?g|png)$/i.test(u.pathname)) return [];
      const mdpi = new URL(u.href);
      mdpi.pathname = u.pathname.replace(/(-g\d+)-\d+(\.(?:jpe?g|png))$/i, '$1$2');
      return [mdpi.href];
    },
  },
  {
    id: 'highwire-atypon',
    canonicalName: 'HighWire / Atypon',
    matchesHost: (_host, path) => /\/images\/(?:small|medium)\//i.test(path),
    abstractSelectors: ['section.abstract .section-paragraph', '.article-abstract', '#abstractBox'],
    expandHighResImageURLs: (u) => {
      if (!/\/images\/(?:small|medium)\//i.test(u.pathname)) return [];
      const large = new URL(u.href);
      large.pathname = u.pathname.replace(/\/images\/(?:small|medium)\//i, '/images/large/');
      if (/\.gif$/i.test(large.pathname)) {
        const jpegVariant = new URL(large.href);
        jpegVariant.pathname = large.pathname.replace(/\.gif$/i, '.jpeg');
        return [jpegVariant.href, large.href];
      }
      return [large.href];
    },
  },
];

export function resolvePublisherAdapter(url: string | null | undefined): PublisherAdapter | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return PUBLISHER_ADAPTERS.find((a) => a.matchesHost?.(u.hostname.toLowerCase(), u.pathname)) || null;
  } catch {
    return null;
  }
}

export function getAllAbstractSelectors(): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const adapter of PUBLISHER_ADAPTERS) {
    for (const sel of adapter.abstractSelectors || []) {
      if (!seen.has(sel)) {
        seen.add(sel);
        ordered.push(sel);
      }
    }
  }
  return ordered;
}

export function extractAdapterEmbeddedAbstracts(html: string): string[] {
  const out: string[] = [];
  for (const adapter of PUBLISHER_ADAPTERS) {
    const raw = adapter.extractEmbeddedAbstract?.(html);
    if (raw) out.push(raw);
  }
  return out;
}

export function expandAdapterHighResImageURLs(u: URL): string[] {
  const host = u.hostname.toLowerCase();
  const candidates: string[] = [];
  for (const adapter of PUBLISHER_ADAPTERS) {
    if (!adapter.expandHighResImageURLs || !adapter.matchesHost?.(host, u.pathname)) continue;
    candidates.push(...adapter.expandHighResImageURLs(u));
  }
  return candidates;
}
