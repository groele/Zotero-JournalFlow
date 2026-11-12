import type { JournalSubscription } from '../types';

export interface CanonicalPublisherEntry {
  readonly canonical: string;
  readonly aliases: readonly string[];
}

export const CANONICAL_PUBLISHERS: readonly CanonicalPublisherEntry[] = [
  {
    canonical: 'Springer Nature',
    aliases: [
      'Springer Nature',
      'Springer Science and Business Media LLC',
      'Springer Science and Business Media',
      'Nature Publishing Group',
      'NPG',
      'Springer',
    ],
  },
  {
    canonical: 'Elsevier',
    aliases: ['Elsevier', 'Elsevier BV', 'Cell Press', 'Relx', 'RELX'],
  },
  {
    canonical: 'AAAS',
    aliases: ['AAAS', 'American Association for the Advancement of Science'],
  },
  {
    canonical: 'American Physical Society (APS)',
    aliases: ['American Physical Society (APS)', 'American Physical Society', 'APS'],
  },
  {
    canonical: 'American Chemical Society (ACS)',
    aliases: ['American Chemical Society (ACS)', 'American Chemical Society', 'ACS'],
  },
  {
    canonical: 'Wiley',
    aliases: ['Wiley', 'John Wiley & Sons', 'John Wiley and Sons', 'Wiley-VCH', 'Wiley-Blackwell'],
  },
  { canonical: 'IEEE', aliases: ['IEEE', 'Institute of Electrical and Electronics Engineers'] },
  { canonical: 'ACM', aliases: ['ACM', 'Association for Computing Machinery'] },
  { canonical: 'PLOS', aliases: ['PLOS', 'Public Library of Science', 'PLoS'] },
  { canonical: 'eLife', aliases: ['eLife', 'eLife Sciences Publications'] },
  { canonical: 'Frontiers', aliases: ['Frontiers', 'Frontiers Media'] },
  { canonical: 'MDPI', aliases: ['MDPI', 'Multidisciplinary Digital Publishing Institute'] },
  { canonical: 'RSC', aliases: ['RSC', 'Royal Society of Chemistry', 'Royal Society of Chemistry (RSC)'] },
  { canonical: 'IOP Publishing', aliases: ['IOP Publishing', 'Institute of Physics Publishing', 'IOP'] },
  {
    canonical: 'Taylor & Francis',
    aliases: ['Taylor & Francis', 'Taylor and Francis', 'T&F'],
  },
  {
    canonical: 'Oxford University Press',
    aliases: ['Oxford University Press', 'OUP'],
  },
  {
    canonical: 'Cambridge University Press',
    aliases: ['Cambridge University Press', 'CUP'],
  },
  {
    canonical: 'PNAS',
    aliases: ['PNAS', 'Proceedings of the National Academy of Sciences', 'National Academy of Sciences'],
  },
  { canonical: 'NEJM Group', aliases: ['NEJM Group', 'New England Journal of Medicine', 'NEJM'] },
] as const;

function normalizePublisherKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ');
}

function aliasSupportsContainsMatch(aliasNorm: string): boolean {
  return aliasNorm.length >= 5 || aliasNorm.includes(' ');
}

const SORTED_ALIAS_ENTRIES: Array<{ canonical: string; aliasNorm: string }> = [];

for (const entry of CANONICAL_PUBLISHERS) {
  for (const alias of entry.aliases) {
    SORTED_ALIAS_ENTRIES.push({ canonical: entry.canonical, aliasNorm: normalizePublisherKey(alias) });
  }
}

SORTED_ALIAS_ENTRIES.sort((a, b) => b.aliasNorm.length - a.aliasNorm.length);

export function canonicalizePublisher(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) {
    return 'Other';
  }

  const trimmed = String(raw).trim();
  const norm = normalizePublisherKey(trimmed);

  for (const { canonical, aliasNorm } of SORTED_ALIAS_ENTRIES) {
    if (norm === aliasNorm) {
      return canonical;
    }
  }

  for (const { canonical, aliasNorm } of SORTED_ALIAS_ENTRIES) {
    if (aliasSupportsContainsMatch(aliasNorm) && norm.includes(aliasNorm)) {
      return canonical;
    }
  }

  return trimmed;
}

export function publisherSortKey(name: string): string {
  return name.trim().toLowerCase();
}

export function withCanonicalPublisher(journal: JournalSubscription): JournalSubscription {
  return {
    ...journal,
    publisher: canonicalizePublisher(journal.publisher),
  };
}

export function groupJournalsByPublisher(
  journals: JournalSubscription[]
): Array<{ publisher: string; journals: JournalSubscription[] }> {
  const byPublisher = new Map<string, JournalSubscription[]>();

  for (const journal of journals) {
    const publisher = canonicalizePublisher(journal.publisher);
    const list = byPublisher.get(publisher);
    if (list) {
      list.push(journal);
    } else {
      byPublisher.set(publisher, [journal]);
    }
  }

  const groups = [...byPublisher.entries()].map(([publisher, groupJournals]) => ({
    publisher,
    journals: [...groupJournals].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
  }));

  groups.sort((a, b) => publisherSortKey(a.publisher).localeCompare(publisherSortKey(b.publisher), undefined, {
    sensitivity: 'base',
  }));

  return groups;
}
