import type { FeedScopeState } from './feedState';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLLAPSED_PUBS_STORAGE_KEY = 'journalflow.collapsedPublishers';

export type SidebarIconName =
  | 'chevron-down'
  | 'collapse-all'
  | 'expand-all'
  | 'panel-collapse'
  | 'panel-expand'
  | 'all-journals';

const ICON_PATHS: Record<SidebarIconName, string[]> = {
  'chevron-down': ['M4 6l4 4 4-4'],
  'collapse-all': ['M4.5 11.5L8 8l3.5 3.5', 'M4.5 6.5L8 3l3.5 3.5'],
  'expand-all': ['M4.5 4.5L8 8l3.5-3.5', 'M4.5 9.5L8 13l3.5-3.5'],
  'panel-collapse': ['M2.5 3.5h11v9h-11z', 'M6.2 3.5v9', 'M10.5 6l-2 2 2 2'],
  'panel-expand': ['M2.5 3.5h11v9h-11z', 'M6.2 3.5v9', 'M8.8 6l2 2-2 2'],
  'all-journals': ['M2.8 3.2h4.2v4.2H2.8z', 'M9 3.2h4.2v4.2H9z', 'M2.8 9h4.2v4.2H2.8z', 'M9 9h4.2v4.2H9z'],
};

export function createSidebarSvg(doc: Document, name: SidebarIconName, className = 'jf-icon'): Element {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of ICON_PATHS[name]) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}

export function setButtonSvgIcon(
  doc: Document,
  button: HTMLButtonElement | null,
  name: SidebarIconName,
  className = 'jf-tool-icon'
): void {
  if (!button) return;
  button.replaceChildren(createSidebarSvg(doc, name, className));
}

export function loadCollapsedPublishers(doc: Document, state: FeedScopeState): void {
  try {
    const raw = doc.defaultView?.sessionStorage?.getItem(COLLAPSED_PUBS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.collapsedPublishers = new Set(parsed.filter((v) => typeof v === 'string' && v.trim()));
    }
  } catch {
    // sessionStorage unavailable
  }
}

export function saveCollapsedPublishers(doc: Document, state: FeedScopeState): void {
  try {
    doc.defaultView?.sessionStorage?.setItem(
      COLLAPSED_PUBS_STORAGE_KEY,
      JSON.stringify([...state.collapsedPublishers])
    );
  } catch {
    // sessionStorage unavailable
  }
}
