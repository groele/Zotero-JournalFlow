/**
 * Zotero JournalFlow - Preferences Dependency Rules, Prefs Observer & L10n Status Helper
 */

import { FIELDS, PREFIX, getPref } from './model';

export interface DependencyRule {
  parent: string;
  matchValue?: string;
  children: string[];
}

export const DEPENDENCY_RULES: DependencyRule[] = [
  {
    parent: 'translateProvider',
    matchValue: 'openai',
    children: ['llmEndpoint', 'llmApiKey', 'llmModel'],
  },
];

export function setStatusL10n(
  statusEl: Element | null,
  l10nId: string | null,
  fallbackText: string,
  l10nArgs?: Record<string, unknown>,
  isError = false
): void {
  if (!statusEl) return;
  if (l10nId) {
    statusEl.setAttribute('data-l10n-id', l10nId);
    if (l10nArgs) {
      statusEl.setAttribute('data-l10n-args', JSON.stringify(l10nArgs));
    } else {
      statusEl.removeAttribute('data-l10n-args');
    }
  } else {
    statusEl.removeAttribute('data-l10n-id');
    statusEl.removeAttribute('data-l10n-args');
  }
  statusEl.className = isError ? 'jf-pref-status jf-pref-error' : 'jf-pref-status';
  if (!(statusEl.ownerDocument as any)?.l10n) {
    statusEl.textContent = fallbackText;
  }
}

export function updateDependencies(doc: Document, zotArg?: any): void {
  if (!doc) return;
  for (const rule of DEPENDENCY_RULES) {
    const parentCtrl = doc.getElementById(`pref-${rule.parent}`) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    const enabled =
      rule.matchValue !== undefined
        ? (parentCtrl ? parentCtrl.value : String(getPref(rule.parent, zotArg))) === rule.matchValue
        : parentCtrl && 'checked' in parentCtrl
          ? Boolean(parentCtrl.checked)
          : Boolean(getPref(rule.parent, zotArg));
    for (const childKey of rule.children) {
      const childCtrl = doc.getElementById(`pref-${childKey}`) as HTMLInputElement | null;
      if (!childCtrl) continue;
      childCtrl.disabled = !enabled;
      const row = childCtrl.closest('.jf-check-row, .jf-control-row');
      if (row) {
        row.classList.toggle('is-disabled', !enabled);
        row.setAttribute('aria-disabled', String(!enabled));
      }
    }
  }
}

export function syncControlsFromPrefs(doc: Document, zotArg?: any): void {
  if (!doc) return;
  for (const fields of Object.values(FIELDS)) {
    for (const field of fields) {
      const ctrl = doc.getElementById(`pref-${field.key}`) as HTMLInputElement | HTMLSelectElement | null;
      if (!ctrl) continue;
      const val = getPref(field.key, zotArg);
      if (field.type === 'check') {
        (ctrl as HTMLInputElement).checked = Boolean(val);
      } else {
        ctrl.value = String(val ?? '');
      }
    }
  }
  updateFollowedSummary(doc, zotArg);
  updateDependencies(doc, zotArg);
}

export function updateFollowedSummary(doc: Document, zotArg?: any): void {
  const zot = zotArg || (doc.defaultView as any)?.Zotero || (globalThis as any).Zotero;
  const summaryEl = doc.getElementById('jf-followed-summary');
  if (summaryEl) {
    let count = 0;
    try {
      const journals = zot?.JournalFlow?.getJournals?.() || JSON.parse(String(getPref('journals', zot) || '[]'));
      count = Array.isArray(journals) ? journals.length : 0;
    } catch {
      count = 0;
    }
    summaryEl.setAttribute('data-l10n-args', JSON.stringify({ count }));
    if (!(doc as any).l10n) {
      summaryEl.textContent = `Currently following ${count} journal(s).`;
    }
  }
  const cachePathEl = doc.getElementById('jf-cache-path-code');
  if (cachePathEl) {
    const path = zot?.JournalFlow?.getCacheFilePath?.();
    if (path) {
      cachePathEl.textContent = path;
    }
  }
}

export function registerPreferenceObserver(
  doc: Document,
  win: any,
  signal: AbortSignal,
  zotArg?: any
): void {
  const zot = zotArg || win?.Zotero || (doc.defaultView as any)?.Zotero || (globalThis as any).Zotero;
  if (typeof zot?.Prefs?.registerObserver !== 'function') return;

  try {
    const token = zot.Prefs.registerObserver(
      PREFIX,
      () => {
        if (!signal.aborted) {
          syncControlsFromPrefs(doc, zot);
        }
      },
      true
    );
    if (token !== undefined) {
      signal.addEventListener(
        'abort',
        () => {
          try {
            zot.Prefs.unregisterObserver?.(token);
          } catch {}
        },
        { once: true }
      );
    }
  } catch {}
}
