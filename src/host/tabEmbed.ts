import { CHROME_ROOT } from '../config';
import type { WorkbenchLaunchState } from '../types';
import { TAB_IFRAME_ID, TAB_TYPE } from './toolbarStyles';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export function resolveTabId(tabOrResult: any): string | undefined {
  if (typeof tabOrResult === 'string' && tabOrResult.trim()) {
    return tabOrResult;
  }
  const id = tabOrResult?.id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

export function ensureTabData(tab: any): void {
  if (!tab || typeof tab !== 'object') return;
  if (!tab.data || typeof tab.data !== 'object') {
    tab.data = { icon: TAB_TYPE };
  } else if (!tab.data.icon) {
    tab.data.icon = TAB_TYPE;
  }
}

export function buildTabAddOptions(
  launchState?: WorkbenchLaunchState,
  onClose?: () => void
): Record<string, any> {
  return {
    type: TAB_TYPE,
    title: 'Zotero JournalFlow',
    select: true,
    data: {
      icon: TAB_TYPE,
      ...(launchState ? { launchState } : {}),
    },
    ...(onClose ? { onClose } : {}),
  };
}

export function resolveTabContainer(tabs: any, tabOrResult: any, mainWin: any): any {
  if (tabOrResult && typeof tabOrResult === 'object' && tabOrResult.container) {
    return tabOrResult.container;
  }
  const tabId = resolveTabId(tabOrResult);
  if (!tabId) return null;

  return (
    tabs?.getTabContent?.(tabId) ||
    tabs?.getTabContainer?.(tabId) ||
    tabs?.getTab?.(tabId)?.container ||
    tabs?._getTab?.(tabId)?.tab?.container ||
    tabs?._tabs?.find?.((t: any) => t?.id === tabId)?.container ||
    mainWin?.document?.getElementById?.(tabId) ||
    null
  );
}

export function findOpenTab(tabs: any): any {
  return (
    tabs?._tabs?.find?.((t: any) => t?.type === TAB_TYPE) ||
    tabs?._tabs?.find?.((t: any) => String(t?.title || '').includes('Zotero JournalFlow')) ||
    null
  );
}

export function findTabIframe(container: any, mainWin: any): any {
  const byContainer =
    container?.querySelector?.(`#${TAB_IFRAME_ID}`) ||
    container?.querySelector?.('iframe');
  if (byContainer) return byContainer;
  const byDoc = mainWin?.document?.getElementById?.(TAB_IFRAME_ID);
  if (!byDoc) return null;
  if (!container || byDoc.parentNode === container) return byDoc;
  return null;
}

export function applyTabIcon(mainWin: any, tabId: string | undefined): void {
  if (!mainWin?.document || !tabId) return;
  const apply = () => {
    try {
      const tabEl = mainWin.document.querySelector?.(`.tab[data-id="${tabId}"]`);
      if (!tabEl) return;
      tabEl.setAttribute('data-type', TAB_TYPE);
      const iconEl = tabEl.querySelector?.('.tab-icon');
      if (iconEl?.style?.setProperty) {
        iconEl.style.setProperty('background-image', `url("${CHROME_ROOT}icons/icon.svg")`, 'important');
        iconEl.style.setProperty('background-repeat', 'no-repeat', 'important');
        iconEl.style.setProperty('background-position', 'center', 'important');
        iconEl.style.setProperty('background-size', 'contain', 'important');
      }
    } catch {}
  };
  apply();
  mainWin.setTimeout?.(apply, 50);
  mainWin.setTimeout?.(apply, 300);
}

export function styleTabContainer(container: any): void {
  if (!container?.style) return;
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.flex = '1';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.minHeight = '0';
  container.style.overflow = 'hidden';
}

export function mountTabIframe(options: {
  container: any;
  mainWin: any;
  attach: (win: any) => void;
  onLoaded: (win: any) => void;
}): any {
  const { container, mainWin, attach, onLoaded } = options;
  styleTabContainer(container);

  const doc = container.ownerDocument || mainWin.document;
  const isXulRoot = doc.documentElement?.namespaceURI === 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
  const iframe =
    isXulRoot && typeof doc.createElementNS === 'function'
      ? doc.createElementNS(XHTML_NS, 'iframe')
      : doc.createElement('iframe');

  iframe.id = TAB_IFRAME_ID;
  iframe.className = 'journalflow-tab-iframe';
  iframe.setAttribute('src', `${CHROME_ROOT}feed.xhtml`);
  iframe.setAttribute(
    'style',
    'width: 100%; height: 100%; min-height: 0; border: none; flex: 1 1 auto; display: block;'
  );
  iframe.setAttribute('flex', '1');

  const attachCurrent = () => {
    if (iframe.contentWindow) {
      attach(iframe.contentWindow);
    }
  };

  iframe.addEventListener?.(
    'load',
    () => {
      attachCurrent();
      if (iframe.contentWindow) {
        onLoaded(iframe.contentWindow);
      }
    },
    { once: true }
  );

  container.appendChild(iframe);
  attachCurrent();
  return iframe;
}
