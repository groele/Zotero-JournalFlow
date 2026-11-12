export const FEED_FTL_PREFIX = 'journalflow-feed-';

export function parseFluentFeedMessages(ftlText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(ftlText || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#') || /^\s/.test(rawLine)) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const rawKey = line.slice(0, eq).trim();
    if (!rawKey.startsWith(FEED_FTL_PREFIX)) continue;
    const shortKey = rawKey.slice(FEED_FTL_PREFIX.length);
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/\{\s*\$([A-Za-z0-9_]+)\s*\}/g, '{$1}');
    out[shortKey] = val;
  }
  return out;
}
