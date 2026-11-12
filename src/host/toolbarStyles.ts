import { CHROME_ROOT } from '../config';

export const MENU_ID = 'journalflow-menuitem';
export const TOOLBAR_BTN_ID = 'journalflow-toolbarbutton';
export const STYLE_ID = 'journalflow-host-style';
export const TAB_TYPE = 'journalflow';
export const TAB_IFRAME_ID = 'journalflow-tab-iframe';
export const DIALOG_NAME = 'journalflow-feed';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export function injectHostStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS
    ? doc.createElementNS(XHTML_NS, 'style')
    : doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    tab[type="${TAB_TYPE}"] .tab-icon,
    .tab[type="${TAB_TYPE}"] .tab-icon,
    .tab[data-type="${TAB_TYPE}"] .tab-icon,
    .tab .tab-icon[data-item-type="${TAB_TYPE}"] {
      background: url("${CHROME_ROOT}icons/icon.svg") no-repeat center / contain !important;
      list-style-image: none !important;
      width: 16px !important;
      height: 16px !important;
      min-width: 16px !important;
      max-width: 16px !important;
      max-height: 16px !important;
    }
    #${TOOLBAR_BTN_ID},
    toolbarbutton#${TOOLBAR_BTN_ID} {
      cursor: pointer !important;
      width: 28px !important;
      height: 28px !important;
      min-width: 28px !important;
      max-width: 28px !important;
      max-height: 28px !important;
      padding: 0 4px !important;
      margin: 0 3px !important;
      box-sizing: border-box !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: hidden !important;
    }
    #${TOOLBAR_BTN_ID} .toolbarbutton-icon,
    #${TOOLBAR_BTN_ID} image,
    #${TOOLBAR_BTN_ID} img {
      width: 20px !important;
      height: 20px !important;
      min-width: 20px !important;
      max-width: 20px !important;
      min-height: 20px !important;
      max-height: 20px !important;
      object-fit: contain !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      margin: 0 auto !important;
    }
    #${TOOLBAR_BTN_ID} .toolbarbutton-text,
    #${TOOLBAR_BTN_ID} label {
      display: none !important;
    }
    menuitem#${MENU_ID} .menu-iconic-icon {
      width: 16px !important;
      height: 16px !important;
      max-width: 16px !important;
      max-height: 16px !important;
    }
  `;
  (doc.head || doc.documentElement)?.appendChild(style);
}

export function constrainButtonIcon(btn: any): void {
  if (!btn) return;
  try {
    const img =
      btn.querySelector?.('.toolbarbutton-icon') ||
      btn.querySelector?.('image') ||
      btn.querySelector?.('img');
    if (img) {
      img.style.width = '20px';
      img.style.height = '20px';
      img.style.maxWidth = '20px';
      img.style.maxHeight = '20px';
      img.setAttribute('width', '20');
      img.setAttribute('height', '20');
    }
    const textEls = btn.querySelectorAll?.('.toolbarbutton-text, label, text');
    textEls?.forEach?.((el: any) => {
      el.textContent = '';
      if (el.style) el.style.display = 'none';
    });
  } catch {
    // Non-fatal DOM constraint guard
  }
}
