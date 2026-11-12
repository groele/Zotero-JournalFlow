/**
 * Zotero JournalFlow - Preferences UI Binding & Interactive Controls
 */

import { setStatusL10n, syncControlsFromPrefs, updateDependencies, updateFollowedSummary } from './dependencies';
import {
  DEFAULTS,
  FIELDS,
  type PreferenceFieldSpec,
  RESETTABLE_PREF_KEYS,
  clampNumericPref,
  getPref,
  setPref,
  setPrefs,
} from './model';

export const HTML = 'http://www.w3.org/1999/xhtml';

export function resolveZotero(win: any, doc: Document): any {
  return (
    win?.Zotero ||
    (doc?.defaultView as any)?.Zotero ||
    (globalThis as any).Zotero ||
    null
  );
}

export function reportOperationError(
  zot: any,
  doc: Document,
  action: string,
  error: unknown
): void {
  const msg = String((error as any)?.message || error || 'Unknown error');
  zot?.logError?.(`[JournalFlow] ${action}: ${msg}`);
  const status = doc.getElementById('jf-pref-status');
  setStatusL10n(status, 'journalflow-pref-status-op-error', `${action} failed: ${msg}`, {
    action,
    message: msg,
  }, true);
}

async function saveControl(
  doc: Document,
  zot: any,
  field: PreferenceFieldSpec,
  control: HTMLInputElement | HTMLSelectElement,
  rawValue: string | number | boolean
): Promise<void> {
  const value = field.type === 'number' ? clampNumericPref(field.key, rawValue) : rawValue;
  control.disabled = true;
  updateDependencies(doc, zot);
  try {
    await setPref(field.key, value, zot);
    const status = doc.getElementById('jf-pref-status');
    setStatusL10n(status, 'journalflow-pref-status-saved', 'Settings saved.');
  } catch (error) {
    reportOperationError(zot, doc, 'Save settings', error);
  } finally {
    control.disabled = false;
    const latest = getPref(field.key, zot);
    if (control.type === 'checkbox') {
      (control as HTMLInputElement).checked = Boolean(latest);
    } else {
      control.value = String(latest ?? '');
    }
    updateDependencies(doc, zot);
  }
}

export function renderGroup(
  doc: Document,
  containerId: string,
  items: PreferenceFieldSpec[],
  signal: AbortSignal,
  zot: any
): void {
  const container = doc.getElementById(containerId);
  if (!container) return;
  container.replaceChildren();

  for (const field of items) {
    const currentVal = getPref(field.key, zot);

    if (field.type === 'check') {
      const row = doc.createElementNS(HTML, 'label') as HTMLLabelElement;
      row.className = 'jf-check-row';

      const input = doc.createElementNS(HTML, 'input') as HTMLInputElement;
      input.type = 'checkbox';
      input.id = `pref-${field.key}`;
      input.className = 'jf-control';
      input.checked = Boolean(currentVal);
      input.addEventListener(
        'change',
        () => {
          void saveControl(doc, zot, field, input, input.checked);
        },
        { signal }
      );

      const span = doc.createElementNS(HTML, 'span');
      span.className = 'jf-control-label';
      span.setAttribute('data-l10n-id', `journalflow-pref-field-${field.key}`);
      if (!(doc as any).l10n) span.textContent = field.fallbackLabel;

      row.appendChild(input);
      row.appendChild(span);
      container.appendChild(row);

      if (field.descL10nId) {
        const desc = doc.createElementNS(HTML, 'p');
        desc.className = 'jf-pref-desc jf-subordinate';
        desc.setAttribute('data-l10n-id', field.descL10nId);
        container.appendChild(desc);
      }
      continue;
    }

    const row = doc.createElementNS(HTML, 'div');
    row.className = field.subordinate ? 'jf-control-row jf-subordinate-row' : 'jf-control-row';

    const label = doc.createElementNS(HTML, 'label') as HTMLLabelElement;
    label.className = 'jf-control-label';
    label.htmlFor = `pref-${field.key}`;
    label.setAttribute('data-l10n-id', `journalflow-pref-field-${field.key}`);
    if (!(doc as any).l10n) label.textContent = field.fallbackLabel;

    if (field.type === 'select') {
      const select = doc.createElementNS(HTML, 'select') as HTMLSelectElement;
      select.className = 'jf-control';
      select.id = `pref-${field.key}`;

      for (const [optVal, optFallback] of field.options || []) {
        const option = doc.createElementNS(HTML, 'option') as HTMLOptionElement;
        option.value = optVal;
        option.setAttribute('data-l10n-id', `journalflow-pref-opt-${field.key}-${optVal}`);
        if (!(doc as any).l10n) option.textContent = optFallback;
        if (String(currentVal) === String(optVal)) option.selected = true;
        select.appendChild(option);
      }

      select.addEventListener(
        'change',
        () => {
          void saveControl(doc, zot, field, select, select.value);
        },
        { signal }
      );

      row.appendChild(label);
      row.appendChild(select);
      container.appendChild(row);
    } else if (field.type === 'number') {
      const input = doc.createElementNS(HTML, 'input') as HTMLInputElement;
      input.type = 'number';
      input.className = 'jf-control';
      input.id = `pref-${field.key}`;
      if (field.range) {
        input.min = String(field.range.min);
        input.max = String(field.range.max);
      }
      input.value = String(currentVal);
      input.addEventListener(
        'change',
        () => {
          void saveControl(doc, zot, field, input, input.value);
        },
        { signal }
      );

      row.appendChild(label);
      row.appendChild(input);
      container.appendChild(row);
    } else if (field.type === 'text' || field.type === 'password') {
      const input = doc.createElementNS(HTML, 'input') as HTMLInputElement;
      input.type = field.type;
      input.className = 'jf-control';
      input.id = `pref-${field.key}`;
      input.value = String(currentVal ?? '');
      if (field.type === 'password') input.autocomplete = 'off';
      input.addEventListener(
        'change',
        () => {
          void saveControl(doc, zot, field, input, input.value.trim());
        },
        { signal }
      );

      row.appendChild(label);
      row.appendChild(input);
      container.appendChild(row);
    }
  }
  updateDependencies(doc, zot);
}

export function bindActions(
  doc: Document,
  win: any,
  signal: AbortSignal,
  zot: any
): void {
  const statusEl = doc.getElementById('jf-pref-status');

  const openBtn = doc.getElementById('jf-btn-open-workbench') as HTMLButtonElement | null;
  openBtn?.addEventListener(
    'click',
    () => {
      try {
        zot?.JournalFlow?.openWorkbench?.(win);
      } catch (error) {
        reportOperationError(zot, doc, 'Open workbench', error);
      }
    },
    { signal }
  );

  const clearBtn = doc.getElementById('jf-btn-clear-cache') as HTMLButtonElement | null;
  clearBtn?.addEventListener(
    'click',
    async () => {
      if (clearBtn.disabled) return;
      clearBtn.disabled = true;
      try {
        await zot?.JournalFlow?.clearCache?.();
        setStatusL10n(statusEl, 'journalflow-pref-status-cache-cleared', 'Daily feed cache cleared.');
      } catch (error) {
        reportOperationError(zot, doc, 'Clear cache', error);
      } finally {
        clearBtn.disabled = false;
      }
    },
    { signal }
  );

  const resetBtn = doc.getElementById('jf-btn-reset-defaults') as HTMLButtonElement | null;
  resetBtn?.addEventListener(
    'click',
    async () => {
      if (resetBtn.disabled) return;
      resetBtn.disabled = true;
      try {
        const defaultsToApply: Record<string, string | number | boolean> = {};
        for (const key of RESETTABLE_PREF_KEYS) {
          defaultsToApply[key] = DEFAULTS[key];
        }
        await setPrefs(defaultsToApply, zot);
        syncControlsFromPrefs(doc, zot);
        setStatusL10n(statusEl, 'journalflow-pref-status-reset', 'Default settings restored.');
      } catch (error) {
        reportOperationError(zot, doc, 'Restore defaults', error);
      } finally {
        resetBtn.disabled = false;
      }
    },
    { signal }
  );

  updateFollowedSummary(doc, zot);
}
