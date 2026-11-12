import { JOURNAL_PRESET_PACKS, type JournalPresetPack } from '../presets';
import { normalizeISSN } from '../services/openalex';
import { uniqueURLs } from '../services/http';
import { canonicalizePublisher } from '../services/publisherNormalize';
import type { JournalSubscription } from '../types';

export function sanitizeSubscription(raw: unknown): JournalSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const issn = normalizeISSN(typeof obj.issn === 'string' ? obj.issn : '');
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!issn || !title) return null;
  const entry: JournalSubscription = { issn, title };
  if (typeof obj.publisher === 'string' && obj.publisher.trim()) {
    entry.publisher = canonicalizePublisher(obj.publisher);
  }
  if (Array.isArray(obj.altIssns)) {
    const alts = uniqueURLs(obj.altIssns.map((v) => normalizeISSN(String(v || ''))));
    if (alts.length) entry.altIssns = alts;
  }
  return entry;
}

export function mergeSubscriptions(
  current: JournalSubscription[],
  incoming: JournalSubscription[]
): { next: JournalSubscription[]; added: number } {
  const map = new Map<string, JournalSubscription>();
  for (const item of current) {
    const clean = sanitizeSubscription(item);
    if (clean) map.set(clean.issn, clean);
  }
  let added = 0;
  for (const item of incoming) {
    const clean = sanitizeSubscription(item);
    if (!clean) continue;
    const prev = map.get(clean.issn);
    if (!prev) {
      map.set(clean.issn, clean);
      added++;
    } else if ((!prev.altIssns?.length && clean.altIssns?.length) || (!prev.publisher && clean.publisher)) {
      map.set(clean.issn, {
        ...prev,
        publisher: prev.publisher || clean.publisher,
        altIssns: clean.altIssns?.length ? uniqueURLs([...(prev.altIssns || []), ...clean.altIssns]) : prev.altIssns,
      });
    }
  }
  return { next: Array.from(map.values()), added };
}

export function applyPresetPack(
  current: JournalSubscription[],
  packId: JournalPresetPack['id']
): JournalSubscription[] {
  const pack = JOURNAL_PRESET_PACKS.find((p) => p.id === packId);
  if (!pack) return current;
  return mergeSubscriptions(current, pack.journals).next;
}

export function parseSubscriptionsImport(raw: string): JournalSubscription[] {
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.journals)
      ? parsed.journals
      : null;
  if (!list) {
    throw new Error('Invalid subscriptions JSON format');
  }
  return list
    .map((item: unknown) => sanitizeSubscription(item))
    .filter((item: JournalSubscription | null): item is JournalSubscription => Boolean(item));
}

export async function backfillSubscriptions(
  current: JournalSubscription[],
  lookupByISSN: (issn: string) => Promise<JournalSubscription>
): Promise<JournalSubscription[] | null> {
  const targets = current.filter((j) => !j.altIssns?.length).slice(0, 6);
  if (!targets.length) return null;

  let changed = false;
  const updated = [...current];
  for (const target of targets) {
    try {
      const info = await lookupByISSN(target.issn);
      if (info.altIssns?.length || info.publisher) {
        const idx = updated.findIndex((j) => j.issn === target.issn);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            publisher: updated[idx].publisher || info.publisher,
            altIssns: info.altIssns?.length
              ? uniqueURLs([updated[idx].issn, ...info.altIssns])
              : updated[idx].altIssns,
          };
          changed = true;
        }
      }
    } catch {
      // Non-fatal metadata backfill failure
    }
  }
  return changed ? updated : null;
}
