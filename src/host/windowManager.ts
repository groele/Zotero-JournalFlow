import { CHROME_ROOT } from '../config';
import type { JournalFlowService, WindowOpenMode, WorkbenchLaunchState } from '../types';
import {
  MENU_ID,
  STYLE_ID,
  TOOLBAR_BTN_ID,
  constrainButtonIcon,
  injectHostStyles,
} from './toolbarStyles';
import { WorkbenchLauncher } from './workbenchLauncher';

declare const Zotero: any;
declare const Services: any;

export class WindowHostManager {
  private windowControllers = new WeakMap<any, AbortController>();
  private launcher: WorkbenchLauncher;
  private windowListener: any = null;
  private lastOpenTriggerAt = 0;

  constructor(
    private readonly service: JournalFlowService,
    private readonly _getRootURI: () => string
  ) {
    this.launcher = new WorkbenchLauncher(service);
  }

  initWindowListener(): void {
    if (this.windowListener || typeof Services === 'undefined' || !Services?.wm) return;
    this.windowListener = {
      onOpenWindow: () => {},
      onCloseWindow: () => {},
      onWindowTitleChange: () => {},
    };
  }

  private isLibraryWindow(win: any, doc: any): boolean {
    const winType = doc.documentElement?.getAttribute?.('windowtype');
    if (winType && winType !== 'navigator:browser') return false;
    return Boolean(
      win?.ZoteroPane ||
        (typeof Zotero !== 'undefined' && Zotero?.getMainWindow?.() === win) ||
        doc.getElementById?.('zotero-pane') ||
        doc.getElementById?.('zotero-items-pane') ||
        doc.getElementById?.('zotero-items-toolbar') ||
        doc.getElementById?.('zotero-items-tree')
    );
  }

  addToWindow(win: any): void {
    const doc = win?.document;
    if (!doc) return;
    if (!this.isLibraryWindow(win, doc)) {
      this.cleanupDetachedIds(doc, [MENU_ID, TOOLBAR_BTN_ID, STYLE_ID]);
      return;
    }

    const existingController = this.windowControllers.get(win);
    if (existingController) {
      this.relabelWindow(win);
      if (!doc.getElementById(TOOLBAR_BTN_ID)) {
        this.ensureToolbarButton(win, doc, existingController.signal, 0);
      } else {
        this.positionToolbarButton(win, doc);
      }
      return;
    }

    const AC =
      win?.AbortController ||
      (typeof AbortController !== 'undefined' ? AbortController : null);
    const controller = AC
      ? new AC()
      : (() => {
          const listeners = new Set<() => void>();
          const sig: any = {
            aborted: false,
            addEventListener: (_t: string, fn: () => void) => listeners.add(fn),
            removeEventListener: (_t: string, fn: () => void) => listeners.delete(fn),
          };
          return {
            signal: sig as AbortSignal,
            abort: () => {
              sig.aborted = true;
              for (const fn of listeners) {
                try { fn(); } catch {}
              }
              listeners.clear();
            },
          } as AbortController;
        })();
    this.windowControllers.set(win, controller);
    const { signal } = controller;

    injectHostStyles(doc);
    this.ensureMenuItem(win, doc, signal);
    this.ensureToolbarButton(win, doc, signal, 0);

    win.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'j') {
          event.preventDefault();
          this.triggerOpen(win);
        }
      },
      { signal }
    );
  }

  private triggerOpen(win: any): void {
    const now = Date.now();
    if (now - this.lastOpenTriggerAt < 200) return;
    this.lastOpenTriggerAt = now;
    this.openWorkbench(win);
  }

  private cleanupDetachedIds(doc: Document, ids: string[]): void {
    for (const id of ids) {
      try {
        doc.getElementById(id)?.remove();
      } catch {}
    }
  }

  private ensureMenuItem(win: any, doc: any, signal: AbortSignal): void {
    if (doc.getElementById(MENU_ID)) return;
    const menuitem = doc.createXULElement
      ? doc.createXULElement('menuitem')
      : doc.createElement('menuitem');
    menuitem.id = MENU_ID;
    menuitem.setAttribute('class', 'menuitem-iconic');
    menuitem.setAttribute('image', `${CHROME_ROOT}icons/toolbar.svg`);
    menuitem.setAttribute('label', this.service.getString('menuitem'));
    menuitem.addEventListener('command', () => this.triggerOpen(win), { signal });
    const toolsPopup = doc.getElementById('menu_ToolsPopup');
    if (toolsPopup) {
      toolsPopup.appendChild(menuitem);
    }
  }

  private resolvePrimaryToolbar(doc: any): any {
    const toolbarLocator =
      doc.getElementById('zotero-tb-attachment') ||
      doc.getElementById('zotero-tb-note') ||
      doc.getElementById('zotero-tb-lookup') ||
      doc.getElementById('zotero-tb-add') ||
      doc.getElementById('zotero-tb-note-add');
    return (
      (toolbarLocator && toolbarLocator.parentNode) ||
      doc.getElementById('zotero-items-toolbar') ||
      doc.getElementById('zotero-tb') ||
      doc.getElementById('zotero-toolbar') ||
      doc.querySelector?.('#zotero-items-pane toolbar') ||
      doc.querySelector?.('.zotero-items-toolbar') ||
      doc.getElementById('zotero-item-toolbar')
    );
  }

  private ensureToolbarButton(win: any, doc: any, signal: AbortSignal, retryCount: number): void {
    if (signal.aborted) return;
    const toolbar = this.resolvePrimaryToolbar(doc);
    if (!toolbar) {
      if (retryCount < 12 && typeof win?.setTimeout === 'function') {
        const timer = win.setTimeout(() => {
          this.ensureToolbarButton(win, doc, signal, retryCount + 1);
        }, 300);
        signal.addEventListener('abort', () => win.clearTimeout?.(timer), { once: true });
      }
      return;
    }

    let btn = doc.getElementById(TOOLBAR_BTN_ID);
    if (!btn) {
      btn = doc.createXULElement
        ? doc.createXULElement('toolbarbutton')
        : doc.createElement('toolbarbutton');
      btn.id = TOOLBAR_BTN_ID;
      btn.setAttribute('class', 'zotero-tb-button toolbarbutton-1 chromeclass-toolbar-additional');
      btn.setAttribute('aria-label', 'Zotero JournalFlow');
      btn.setAttribute('tooltiptext', this.service.getString('toolbar-tip'));
      const iconURL = `${CHROME_ROOT}icons/toolbar.svg`;
      btn.setAttribute('image', iconURL);
      btn.style.listStyleImage = `url("${iconURL}")`;
      btn.removeAttribute('label');

      const onActivate = (event: any) => {
        if (event?.type === 'click' && event.button !== 0) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        this.triggerOpen(win);
      };
      btn.addEventListener('command', onActivate, { signal });
      btn.addEventListener('click', onActivate, { signal });
    }

    this.positionToolbarButton(win, doc, toolbar, btn);
    constrainButtonIcon(btn);

    if (retryCount === 0 && typeof win?.setTimeout === 'function') {
      for (const delay of [150, 450, 1200, 2500]) {
        const t = win.setTimeout(() => {
          if (signal.aborted || win.closed) return;
          this.positionToolbarButton(win, doc);
          constrainButtonIcon(doc.getElementById(TOOLBAR_BTN_ID));
        }, delay);
        signal.addEventListener('abort', () => win.clearTimeout?.(t), { once: true });
      }
    }
  }

  private positionToolbarButton(win: any, doc: any, targetToolbar?: any, existingBtn?: any): void {
    const toolbar = targetToolbar || this.resolvePrimaryToolbar(doc);
    const btn = existingBtn || doc.getElementById(TOOLBAR_BTN_ID);
    if (!toolbar || !btn) return;

    const children = Array.from(toolbar.children || []) as any[];
    const spacerIdx = children.findIndex((child) => {
      const tag = String(child.localName || child.tagName || '').toLowerCase();
      return (
        tag === 'toolbarspring' ||
        (tag === 'spacer' && Number(child.getAttribute?.('flex') || 0) > 0) ||
        child.id === 'zotero-tb-search' ||
        child.id === 'zotero-tb-search-textbox' ||
        child.classList?.contains?.('zotero-search-box') ||
        child.classList?.contains?.('search-box')
      );
    });

    const leadingItems = spacerIdx >= 0 ? children.slice(0, spacerIdx) : children;
    const leadingButtons = leadingItems.filter(
      (child) =>
        String(child.localName || child.tagName || '').toLowerCase() === 'toolbarbutton' &&
        child.id !== TOOLBAR_BTN_ID &&
        !child.hidden &&
        child.getAttribute?.('hidden') !== 'true' &&
        child.getAttribute?.('collapsed') !== 'true'
    );

    const anchor =
      leadingButtons.reverse().find((child) => {
        try {
          const style = win.getComputedStyle?.(child);
          return !style || (style.display !== 'none' && style.visibility !== 'collapse');
        } catch {
          return true;
        }
      }) || null;

    if (anchor && anchor.parentNode === toolbar) {
      if (anchor.nextSibling !== btn) {
        toolbar.insertBefore(btn, anchor.nextSibling);
      }
      return;
    }

    const searchAnchor = spacerIdx >= 0 ? children[spacerIdx] : null;
    if (searchAnchor && searchAnchor.parentNode === toolbar) {
      if (btn.nextSibling !== searchAnchor || btn.parentNode !== toolbar) {
        toolbar.insertBefore(btn, searchAnchor);
      }
    } else if (btn.parentNode !== toolbar) {
      toolbar.appendChild(btn);
    }
  }

  relabelWindow(win: any): void {
    const doc = win?.document;
    if (!doc) return;
    const mi = doc.getElementById(MENU_ID);
    if (mi) {
      mi.setAttribute('label', this.service.getString('menuitem'));
    }
    const tb = doc.getElementById(TOOLBAR_BTN_ID);
    if (tb) {
      tb.setAttribute('tooltiptext', this.service.getString('toolbar-tip'));
    }
  }

  relabelAllWindows(): void {
    for (const win of Zotero?.getMainWindows?.() || []) {
      this.relabelWindow(win);
    }
  }

  removeFromWindow(win: any): void {
    const controller = this.windowControllers.get(win);
    if (controller) {
      controller.abort();
      this.windowControllers.delete(win);
    }
    const doc = win?.document;
    if (doc) {
      this.cleanupDetachedIds(doc, [MENU_ID, TOOLBAR_BTN_ID, STYLE_ID]);
    }
  }

  getWindowMode(): WindowOpenMode {
    return this.launcher.getWindowMode();
  }

  switchWindowMode(mode: WindowOpenMode, sourceWindow?: any, launchState?: WorkbenchLaunchState): void {
    this.launcher.switchMode(mode, sourceWindow, launchState);
  }

  openWorkbench(targetWindow?: any, launchState?: WorkbenchLaunchState): void {
    this.launcher.open(targetWindow, launchState);
  }

  closeAllWorkbenches(): void {
    this.launcher.closeAll();
    const windows = typeof Zotero !== 'undefined' ? Zotero?.getMainWindows?.() || [] : [];
    for (const win of windows) {
      this.removeFromWindow(win);
    }
  }
}
