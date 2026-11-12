import { CHROME_ROOT } from '../config';
import type { JournalFlowService, WindowOpenMode, WorkbenchLaunchState } from '../types';
import {
  applyTabIcon,
  buildTabAddOptions,
  ensureTabData,
  findOpenTab,
  findTabIframe,
  mountTabIframe,
  resolveTabContainer,
  resolveTabId,
} from './tabEmbed';
import { DIALOG_NAME, TAB_TYPE } from './toolbarStyles';

declare const Zotero: any;
declare const Services: any;

const STANDALONE_FEATURES =
  'chrome,dialog=no,all,centerscreen,resizable=yes,minimizable=yes,close=yes,titlebar=yes,width=1200,height=800';

export class WorkbenchLauncher {
  private feedWindow: any = null;

  constructor(private readonly service: JournalFlowService) {}

  getWindowMode(): WindowOpenMode {
    const raw = String(this.service.getPref('windowMode') || 'tab').toLowerCase();
    return raw === 'window' ? 'window' : 'tab';
  }

  open(targetWindow?: any, launchState?: WorkbenchLaunchState): void {
    const mode = this.getWindowMode();
    const mainWin = this.resolveMainWindow(targetWindow);
    if (mode === 'window') {
      if (this.openStandaloneWindow(mainWin, launchState)) {
        this.closeTabs(mainWin);
      }
      return;
    }
    if (this.openInTab(mainWin, launchState)) {
      this.closeStandaloneWindows();
      return;
    }
    this.openStandaloneWindow(mainWin, launchState);
  }

  switchMode(
    mode: WindowOpenMode,
    sourceWindow?: any,
    launchState?: WorkbenchLaunchState
  ): void {
    const nextMode: WindowOpenMode = mode === 'window' ? 'window' : 'tab';
    this.service.setPref('windowMode', nextMode);
    const mainWin = this.resolveMainWindow(sourceWindow);
    const deferClose = (fn: () => void) => {
      if (typeof mainWin?.setTimeout === 'function') {
        mainWin.setTimeout(fn, 0);
      } else {
        fn();
      }
    };

    if (nextMode === 'window') {
      const opened = this.openStandaloneWindow(mainWin, launchState);
      if (opened) {
        deferClose(() => this.closeTabs(mainWin));
      }
      return;
    }

    if (this.openInTab(mainWin, launchState)) {
      deferClose(() => this.closeStandaloneWindows(sourceWindow));
    } else {
      this.openStandaloneWindow(mainWin, launchState);
    }
  }

  private resolveMainWindow(targetWindow?: any): any {
    if (targetWindow?.Zotero_Tabs) return targetWindow;
    if (targetWindow?.parent?.Zotero_Tabs) return targetWindow.parent;
    if (targetWindow?.top?.Zotero_Tabs) return targetWindow.top;
    if (targetWindow?.opener?.Zotero_Tabs) return targetWindow.opener;
    return (
      (typeof Zotero !== 'undefined' && Zotero?.getMainWindow?.()) ||
      (typeof Services !== 'undefined' && Services?.wm?.getMostRecentWindow?.('navigator:browser')) ||
      null
    );
  }

  private buildContext(mode: WindowOpenMode, launchState?: WorkbenchLaunchState, mainWin?: any) {
    return {
      Zotero: typeof Zotero !== 'undefined' ? Zotero : mainWin?.Zotero,
      JournalFlow: this.service,
      windowMode: mode,
      initialState: launchState,
    };
  }

  private injectWindowContext(
    win: any,
    mode: WindowOpenMode,
    launchState?: WorkbenchLaunchState,
    mainWin?: any
  ): void {
    if (!win) return;
    const context = this.buildContext(mode, launchState, mainWin);
    for (const target of [win, win.wrappedJSObject]) {
      if (!target) continue;
      try {
        target.Zotero = context.Zotero;
        target.__JournalFlowContext = context;
      } catch {}
    }
  }

  private deliverState(win: any, launchState?: WorkbenchLaunchState): void {
    if (!win || !launchState) return;
    try {
      win.postMessage?.({ type: 'JOURNALFLOW_STATE', state: launchState }, '*');
    } catch {}
  }

  private openInTab(targetWindow?: any, launchState?: WorkbenchLaunchState): boolean {
    const mainWin = this.resolveMainWindow(targetWindow);
    const tabs = mainWin?.Zotero_Tabs;
    if (!mainWin || !tabs || typeof tabs.add !== 'function') return false;

    try {
      const existing = findOpenTab(tabs);
      if (existing) {
        ensureTabData(existing);
        tabs.select(existing.id);
        applyTabIcon(mainWin, existing.id);
        const existingContainer = resolveTabContainer(tabs, existing, mainWin);
        const existingIframe = findTabIframe(existingContainer, mainWin);
        if (existingIframe) {
          if (existingIframe.contentWindow) {
            this.injectWindowContext(existingIframe.contentWindow, 'tab', launchState, mainWin);
            this.deliverState(existingIframe.contentWindow, launchState);
          }
          mainWin.focus?.();
          return true;
        }
        if (existingContainer) {
          mountTabIframe({
            container: existingContainer,
            mainWin,
            attach: (win) => this.injectWindowContext(win, 'tab', launchState, mainWin),
            onLoaded: (win) => this.deliverState(win, launchState),
          });
          mainWin.focus?.();
          return true;
        }
      }

      const tabResult = tabs.add(
        buildTabAddOptions(launchState, () => {
          try {
            if (typeof Zotero !== 'undefined') Zotero?.debug?.('[JournalFlow] Tab closed');
          } catch {}
        })
      );

      const tabId = resolveTabId(tabResult);
      applyTabIcon(mainWin, tabId);

      const container = resolveTabContainer(tabs, tabResult, mainWin);
      if (!container) return false;

      mountTabIframe({
        container,
        mainWin,
        attach: (win) => this.injectWindowContext(win, 'tab', launchState, mainWin),
        onLoaded: (win) => this.deliverState(win, launchState),
      });
      mainWin.focus?.();
      return true;
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero?.logError?.(`[JournalFlow] Failed to open tab: ${error}`);
      }
      return false;
    }
  }

  private findStandaloneWindow(): any {
    if (this.feedWindow && !this.feedWindow.closed) {
      return this.feedWindow;
    }
    try {
      const enumerator = Services?.wm?.getEnumerator?.(null);
      while (enumerator?.hasMoreElements?.()) {
        const win = enumerator.getNext();
        if (!win || win.closed) continue;
        const href = String(win.location?.href || '');
        if (win.name === DIALOG_NAME || href.startsWith(`${CHROME_ROOT}feed.xhtml`)) {
          this.feedWindow = win;
          return win;
        }
      }
    } catch {}
    return null;
  }

  private openStandaloneWindow(targetWindow?: any, launchState?: WorkbenchLaunchState): boolean {
    const mainWin = this.resolveMainWindow(targetWindow);
    const existing = this.findStandaloneWindow();
    if (existing) {
      this.injectWindowContext(existing, 'window', launchState, mainWin);
      this.deliverState(existing, launchState);
      existing.focus?.();
      return true;
    }

    const url = `${CHROME_ROOT}feed.xhtml`;
    const contextPayload = this.buildContext('window', launchState, mainWin);
    let win: any = null;

    try {
      if (typeof Services !== 'undefined' && Services?.ww?.openWindow) {
        win = Services.ww.openWindow(null, url, DIALOG_NAME, STANDALONE_FEATURES, null);
      } else if (mainWin?.openDialog) {
        win = mainWin.openDialog(url, DIALOG_NAME, STANDALONE_FEATURES, contextPayload);
      }
    } catch (error) {
      if (typeof Zotero !== 'undefined') {
        Zotero?.logError?.(`[JournalFlow] Failed to open standalone window: ${error}`);
      }
      return false;
    }

    if (!win) return false;
    this.feedWindow = win;

    const attach = () => {
      this.injectWindowContext(win, 'window', launchState, mainWin);
      try {
        if (win.document && win.document.title !== 'Zotero JournalFlow') {
          win.document.title = 'Zotero JournalFlow';
        }
      } catch {}
    };

    attach();
    win.addEventListener?.('DOMContentLoaded', attach, { once: true, capture: true });
    win.addEventListener?.(
      'load',
      () => {
        attach();
        this.deliverState(win, launchState);
      },
      { once: true }
    );
    win.addEventListener?.('unload', (event: any) => {
      const targetURI = String(event?.target?.documentURI || '');
      if (targetURI === 'about:blank') return;
      if (this.feedWindow === win) {
        this.feedWindow = null;
      }
    });
    win.focus?.();
    return true;
  }

  private closeTabs(targetWindow?: any): void {
    const windows = new Set<any>();
    if (targetWindow?.Zotero_Tabs) windows.add(targetWindow);
    for (const win of (typeof Zotero !== 'undefined' ? Zotero?.getMainWindows?.() : []) || []) {
      windows.add(win);
    }
    for (const win of windows) {
      const tabs = win?.Zotero_Tabs;
      if (tabs?._tabs && tabs?.close) {
        const toClose = tabs._tabs.filter((t: any) => t?.type === TAB_TYPE);
        for (const t of toClose) {
          ensureTabData(t);
          try {
            tabs.close(t.id);
          } catch {}
        }
      }
    }
  }

  private closeStandaloneWindows(extraWindow?: any): void {
    const targets = new Set<any>();
    if (this.feedWindow && !this.feedWindow.closed) targets.add(this.feedWindow);
    if (extraWindow && !extraWindow.Zotero_Tabs && !extraWindow.closed && extraWindow !== this.resolveMainWindow()) {
      const href = String(extraWindow.location?.href || '');
      if (extraWindow.name === DIALOG_NAME || href.startsWith(`${CHROME_ROOT}feed.xhtml`)) {
        targets.add(extraWindow);
      }
    }
    try {
      const enumerator = Services?.wm?.getEnumerator?.(null);
      while (enumerator?.hasMoreElements?.()) {
        const win = enumerator.getNext();
        if (!win || win.closed) continue;
        const href = String(win.location?.href || '');
        if (win.name === DIALOG_NAME || href.startsWith(`${CHROME_ROOT}feed.xhtml`)) {
          targets.add(win);
        }
      }
    } catch {}
    for (const win of targets) {
      try {
        win.close?.();
      } catch {}
    }
    this.feedWindow = null;
  }

  closeAll(): void {
    this.closeStandaloneWindows();
    this.closeTabs();
  }
}
