/**
 * Zotero JournalFlow - Preferences Controller (TypeScript Source)
 * Single Source of Truth for chrome/content/preferences.xhtml
 */

import {
  registerPreferenceObserver,
  setStatusL10n,
  updateDependencies,
} from './preferences/dependencies';
import { DEFAULTS, FIELDS, PREFIX, clampNumericPref, getPref, setPref, setPrefs } from './preferences/model';
import { bindActions, renderGroup, resolveZotero } from './preferences/uiBinding';

export { DEFAULTS, FIELDS, PREFIX, clampNumericPref, getPref, setPref, setPrefs };

interface PaneElement extends Element {
  _journalFlowInited?: boolean;
  _journalFlowAbort?: AbortController;
}

export function initPreferencesPane(win: any): void {
  const doc: Document | undefined = win?.document || globalThis.document;
  if (!doc) return;
  const pane = doc.getElementById('journalflow-preferences-pane') as PaneElement | null;
  if (!pane || pane._journalFlowInited) return;
  pane._journalFlowInited = true;

  const controller = new AbortController();
  pane._journalFlowAbort = controller;
  const { signal } = controller;

  const cleanup = () => {
    controller.abort();
    pane._journalFlowInited = false;
    pane._journalFlowAbort = undefined;
  };
  win?.addEventListener?.('pagehide', cleanup, { once: true });
  win?.addEventListener?.('unload', cleanup, { once: true });

  const statusEl = doc.getElementById('jf-pref-status');
  const zot = resolveZotero(win, doc);

  try {
    renderGroup(doc, 'jf-pref-workspace', FIELDS.workspace, signal, zot);
    renderGroup(doc, 'jf-pref-feed', FIELDS.feed, signal, zot);
    renderGroup(doc, 'jf-pref-media', FIELDS.media, signal, zot);
    bindActions(doc, win, signal, zot);
    updateDependencies(doc, zot);
    registerPreferenceObserver(doc, win, signal, zot);
    setStatusL10n(statusEl, 'journalflow-pref-status-loaded', 'Settings ready; changes are saved automatically.');
  } catch (err) {
    const message = String((err as any)?.message || err);
    setStatusL10n(
      statusEl,
      'journalflow-pref-status-load-error',
      `Failed to load settings: ${message}`,
      { message },
      true
    );
  }
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).JournalFlow_Preferences = { init: initPreferencesPane };
}

if (typeof document !== 'undefined') {
  const tryInitExistingPane = () => {
    const pane = document.getElementById('journalflow-preferences-pane') as PaneElement | null;
    if (pane && !pane._journalFlowInited) {
      initPreferencesPane((document.defaultView || globalThis) as any);
    }
  };

  document.addEventListener(
    'load',
    (event: Event) => {
      const target = event.target as Element | null;
      if (target?.id === 'journalflow-preferences-pane') {
        initPreferencesPane((target.ownerDocument?.defaultView || globalThis) as any);
      }
    },
    true
  );

  document.addEventListener('DOMContentLoaded', tryInitExistingPane, { once: true });

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive' ||
    document.getElementById('journalflow-preferences-pane')
  ) {
    queueMicrotask(tryInitExistingPane);
  }
}
