/**
 * Zotero JournalFlow - Preferences Model & Configuration Schema
 */

import { PREF_BRANCH, PREF_DEFAULTS } from '../config';

declare const Zotero: any;

export const PREFIX = PREF_BRANCH;

export const DEFAULTS: Record<string, string | number | boolean> = {
  ...PREF_DEFAULTS,
  journals: PREF_DEFAULTS.journals,
  windowMode: PREF_DEFAULTS.windowMode,
  uiLanguage: PREF_DEFAULTS.uiLanguage,
  daysToFetch: PREF_DEFAULTS.daysToFetch,
  articlesPerJournal: PREF_DEFAULTS.articlesPerJournal,
  filterArticleTypes: PREF_DEFAULTS.filterArticleTypes,
  cacheTTLHours: PREF_DEFAULTS.cacheTTLHours,
  loadFigures: PREF_DEFAULTS.loadFigures,
  translateProvider: PREF_DEFAULTS.translateProvider,
  llmEndpoint: PREF_DEFAULTS.llmEndpoint,
  llmApiKey: PREF_DEFAULTS.llmApiKey,
  llmModel: PREF_DEFAULTS.llmModel,
};

export const RESETTABLE_PREF_KEYS = [
  'windowMode',
  'uiLanguage',
  'daysToFetch',
  'articlesPerJournal',
  'filterArticleTypes',
  'cacheTTLHours',
  'loadFigures',
  'translateProvider',
  'llmEndpoint',
  'llmApiKey',
  'llmModel',
] as const;

export interface NumericRange {
  min: number;
  max: number;
}

export interface PreferenceFieldSpec {
  key: string;
  fallbackLabel: string;
  type: 'select' | 'number' | 'check' | 'text' | 'password';
  options?: ReadonlyArray<readonly [value: string, fallbackLabel: string]>;
  range?: NumericRange;
  descL10nId?: string;
  subordinate?: boolean;
}

export const NUMERIC_RANGES: Record<string, NumericRange> = {
  daysToFetch: { min: 1, max: 180 },
  articlesPerJournal: { min: 10, max: 500 },
  cacheTTLHours: { min: 1, max: 168 },
};

export const FIELDS: Record<'workspace' | 'feed' | 'media', PreferenceFieldSpec[]> = {
  workspace: [
    {
      key: 'windowMode',
      fallbackLabel: 'Workbench opening mode',
      type: 'select',
      options: [
        ['tab', 'Zotero Tab (Recommended)'],
        ['window', 'Standalone Window'],
      ],
    },
    {
      key: 'uiLanguage',
      fallbackLabel: 'Feed workbench language',
      type: 'select',
      options: [
        ['auto', 'Follow Zotero'],
        ['zh', '中文'],
        ['en', 'English'],
      ],
    },
  ],
  feed: [
    {
      key: 'daysToFetch',
      fallbackLabel: 'Days to fetch (1–180)',
      type: 'number',
      range: NUMERIC_RANGES.daysToFetch,
    },
    {
      key: 'articlesPerJournal',
      fallbackLabel: 'Max articles per journal (10–500)',
      type: 'number',
      range: NUMERIC_RANGES.articlesPerJournal,
    },
    {
      key: 'cacheTTLHours',
      fallbackLabel: 'Feed cache lifetime in hours (1–168)',
      type: 'number',
      range: NUMERIC_RANGES.cacheTTLHours,
    },
    {
      key: 'filterArticleTypes',
      fallbackLabel: 'Only show research content',
      type: 'check',
      descL10nId: 'journalflow-pref-desc-filterArticleTypes',
    },
  ],
  media: [
    {
      key: 'translateProvider',
      fallbackLabel: 'Primary translation service',
      type: 'select',
      options: [
        ['google', 'Google Translate (with MyMemory fallback)'],
        ['mymemory', 'MyMemory (with Google fallback)'],
        ['openai', 'OpenAI-Compatible LLM (with Google/MyMemory fallback)'],
      ],
    },
    {
      key: 'llmEndpoint',
      fallbackLabel: 'OpenAI-compatible Chat Completions endpoint',
      type: 'text',
      subordinate: true,
    },
    {
      key: 'llmApiKey',
      fallbackLabel: 'API Key',
      type: 'password',
      subordinate: true,
    },
    {
      key: 'llmModel',
      fallbackLabel: 'Model name (e.g. gpt-4o-mini, deepseek-chat)',
      type: 'text',
      subordinate: true,
    },
    {
      key: 'loadFigures',
      fallbackLabel: 'Load body and extended figures',
      type: 'check',
      descL10nId: 'journalflow-pref-desc-loadFigures',
    },
  ],
};

function resolveZotero(zotArg?: any): any {
  if (zotArg?.Prefs) return zotArg;
  if (typeof Zotero !== 'undefined' && Zotero?.Prefs) return Zotero;
  return (globalThis as any).Zotero || null;
}

export function clampNumericPref(key: string, rawValue: unknown): number {
  const fallback = Number(DEFAULTS[key] ?? 0);
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  const range = NUMERIC_RANGES[key];
  if (!Number.isFinite(parsed)) return fallback;
  if (!range) return parsed;
  return Math.max(range.min, Math.min(range.max, parsed));
}

export function getPref(key: string, zotArg?: any): string | number | boolean {
  const zot = resolveZotero(zotArg);
  const def = DEFAULTS[key];
  if (!zot?.Prefs?.get) return def;
  try {
    const val = zot.Prefs.get(PREFIX + key, true);
    if (typeof def === 'boolean') {
      return typeof val === 'boolean' ? val : def;
    }
    if (typeof def === 'number') {
      return clampNumericPref(key, val);
    }
    return val !== undefined && val !== null ? String(val) : def;
  } catch {
    return def;
  }
}

export async function setPrefs(
  values: Record<string, string | number | boolean>,
  zotArg?: any
): Promise<void> {
  const zot = resolveZotero(zotArg);
  if (!zot?.Prefs?.set) {
    throw new Error('Zotero Prefs service unavailable');
  }
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, getPref(k, zot)]));
  const changed: string[] = [];
  try {
    for (const [key, rawVal] of Object.entries(values)) {
      const val = key in NUMERIC_RANGES ? clampNumericPref(key, rawVal) : rawVal;
      zot.Prefs.set(PREFIX + key, val, true);
      changed.push(key);
    }
    if (Object.hasOwn(values, 'uiLanguage')) {
      try {
        const mode = values.uiLanguage === 'en' || values.uiLanguage === 'zh' ? values.uiLanguage : 'auto';
        zot.JournalFlow?.setUILanguage?.(mode);
      } catch {}
    }
    if (Object.hasOwn(values, 'daysToFetch') || Object.hasOwn(values, 'articlesPerJournal') || Object.hasOwn(values, 'filterArticleTypes')) {
      try {
        await zot.JournalFlow?.clearCache?.();
      } catch {}
    }
  } catch (error) {
    for (const key of changed) {
      try {
        zot.Prefs.set(PREFIX + key, previous[key], true);
      } catch {}
    }
    throw error;
  }
}

export function setPref(key: string, val: string | number | boolean, zotArg?: any): Promise<void> {
  return setPrefs({ [key]: val }, zotArg);
}
