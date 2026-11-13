import { type FeedHostContext, type FeedUIState, getString } from './feedState';

const SHORTCUT_ITEMS: ReadonlyArray<{ keys: string; labelKey: string }> = [
  { keys: 'j / k', labelKey: 'kbd-nav' },
  { keys: '/', labelKey: 'kbd-search' },
  { keys: 'o / Enter', labelKey: 'kbd-open' },
  { keys: 'a', labelKey: 'kbd-import' },
  { keys: 't', labelKey: 'kbd-translate' },
  { keys: 's', labelKey: 'kbd-star' },
  { keys: 'r', labelKey: 'kbd-read' },
  { keys: 'x', labelKey: 'kbd-select' },
  { keys: 'Esc', labelKey: 'kbd-esc' },
];

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
}

export function renderKeyboardHelpModal(doc: Document, ctx: FeedHostContext): void {
  const S = (id: string) => getString(ctx, id);
  const titleEl = doc.getElementById('kbd-help-title');
  if (titleEl) titleEl.textContent = S('kbd-title');
  const helpBtn = doc.getElementById('kbd-help-btn') as HTMLButtonElement | null;
  if (helpBtn) helpBtn.title = S('kbd-help-tip');
  const list = doc.getElementById('kbd-help-list');
  if (!list) return;
  list.replaceChildren();
  for (const item of SHORTCUT_ITEMS) {
    const li = doc.createElement('li');
    const kbd = doc.createElement('kbd');
    kbd.textContent = item.keys;
    const desc = doc.createElement('span');
    desc.textContent = S(item.labelKey);
    li.append(kbd, desc);
    list.appendChild(li);
  }
}

export function setKeyboardHelpOpen(doc: Document, ctx: FeedHostContext, open: boolean): void {
  const modal = doc.getElementById('kbd-help-modal');
  if (!modal) return;
  if (open) renderKeyboardHelpModal(doc, ctx);
  modal.hidden = !open;
}

function getVisibleCards(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll('#cards .card:not(.card-skeleton)')) as HTMLElement[];
}

export function syncFocusedCardClass(doc: Document, state: FeedUIState): HTMLElement | null {
  const cards = getVisibleCards(doc);
  let active: HTMLElement | null = null;
  for (const card of cards) {
    const matched = Boolean(state.focusedArticleKey && card.dataset.selKey === state.focusedArticleKey);
    card.classList.toggle('is-keyboard-focus', matched);
    if (matched) active = card;
  }
  return active;
}

export function advanceFocusBeforeRemoval(doc: Document, state: FeedUIState, removedKey: string): void {
  if (!state.focusedArticleKey || state.focusedArticleKey !== removedKey) return;
  const cards = getVisibleCards(doc);
  const idx = cards.findIndex((c) => c.dataset.selKey === removedKey);
  if (idx < 0) return;
  const nextCard = cards[idx + 1] || cards[idx - 1] || null;
  state.focusedArticleKey = nextCard?.dataset.selKey || null;
}

function moveCardFocus(doc: Document, state: FeedUIState, delta: 1 | -1): void {
  const cards = getVisibleCards(doc);
  if (!cards.length) return;
  const currentIdx = cards.findIndex((c) => c.dataset.selKey === state.focusedArticleKey);
  const nextIdx =
    currentIdx < 0
      ? delta > 0
        ? 0
        : cards.length - 1
      : Math.max(0, Math.min(cards.length - 1, currentIdx + delta));
  const nextCard = cards[nextIdx];
  state.focusedArticleKey = nextCard.dataset.selKey || null;
  syncFocusedCardClass(doc, state);
  nextCard.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

export function initKeyboardNav(
  doc: Document,
  ctx: FeedHostContext,
  state: FeedUIState,
  signal: AbortSignal
): void {
  const win = doc.defaultView || globalThis;
  const modal = doc.getElementById('kbd-help-modal');
  const helpBtn = doc.getElementById('kbd-help-btn');
  const closeBtn = doc.getElementById('kbd-help-close');

  renderKeyboardHelpModal(doc, ctx);
  helpBtn?.addEventListener(
    'click',
    () => setKeyboardHelpOpen(doc, ctx, Boolean(modal?.hidden)),
    { signal }
  );
  closeBtn?.addEventListener('click', () => setKeyboardHelpOpen(doc, ctx, false), { signal });
  modal?.addEventListener(
    'click',
    (e) => {
      if (e.target === modal) setKeyboardHelpOpen(doc, ctx, false);
    },
    { signal }
  );

  win.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const lightbox = doc.getElementById('lightbox');
      if (lightbox && !lightbox.hidden) return;

      if (e.key === 'Escape') {
        if (modal && !modal.hidden) {
          setKeyboardHelpOpen(doc, ctx, false);
          return;
        }
        if (state.focusedArticleKey) {
          state.focusedArticleKey = null;
          syncFocusedCardClass(doc, state);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setKeyboardHelpOpen(doc, ctx, Boolean(modal?.hidden));
        return;
      }

      if (modal && !modal.hidden) return;

      if (e.key === '/') {
        e.preventDefault();
        const search = doc.getElementById('article-search-input') as HTMLInputElement | null;
        search?.focus();
        search?.select?.();
        return;
      }

      if (e.key === 'j') {
        e.preventDefault();
        moveCardFocus(doc, state, 1);
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        moveCardFocus(doc, state, -1);
        return;
      }

      const activeCard = syncFocusedCardClass(doc, state);
      if (!activeCard) return;

      if (e.key === 'o' || (e.key === 'Enter' && !isEditableTarget(e.target))) {
        const tag = ((e.target as HTMLElement | null)?.tagName || '').toUpperCase();
        if (e.key === 'Enter' && (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT')) return;
        e.preventDefault();
        (activeCard.querySelector('.card-title') as HTMLElement | null)?.click();
      } else if (e.key === 'a') {
        e.preventDefault();
        (activeCard.querySelector('.card-actions button.primary') as HTMLButtonElement | null)?.click();
      } else if (e.key === 't') {
        e.preventDefault();
        (activeCard.querySelector('.card-actions button[data-action="translate"]') as HTMLButtonElement | null)?.click();
      } else if (e.key === 's') {
        e.preventDefault();
        (activeCard.querySelector('.card-actions button.star-btn') as HTMLButtonElement | null)?.click();
      } else if (e.key === 'r') {
        e.preventDefault();
        (activeCard.querySelector('.card-actions button[data-action="read"]') as HTMLButtonElement | null)?.click();
      } else if (e.key === 'x') {
        e.preventDefault();
        const check = activeCard.querySelector('input.card-select') as HTMLInputElement | null;
        if (check) {
          check.checked = !check.checked;
          check.dispatchEvent(new (doc.defaultView || globalThis).Event('change'));
        }
      }
    },
    { signal }
  );
}
