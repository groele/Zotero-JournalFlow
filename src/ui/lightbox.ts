import { dedupeFigures, figureCaptionText } from '../services/figures';
import type { ArticleFigure } from '../types';
import type { LightboxState } from './feedState';

function updateLightboxGeometry(doc: Document): void {
  const stage = doc.getElementById('lightbox-stage');
  const img = doc.getElementById('lightbox-img') as HTMLImageElement | null;
  const caption = doc.getElementById('lightbox-caption');
  if (!stage || !img || !caption || !img.complete) return;

  const stageRect = stage.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  if (!stageRect.width || !imgRect.width) return;

  const visibleLeft = Math.max(imgRect.left, stageRect.left);
  const visibleRight = Math.min(imgRect.right, stageRect.right);
  const visibleTop = Math.max(imgRect.top, stageRect.top);
  const visibleBottom = Math.min(imgRect.bottom, stageRect.bottom);
  const visibleWidth = Math.max(260, visibleRight - visibleLeft);
  const centerY = Math.max(
    36,
    Math.min(stageRect.height - 36, (visibleTop + visibleBottom) / 2 - stageRect.top)
  );
  stage.style.setProperty('--nav-top', `${centerY}px`);
  stage.style.setProperty('--nav-left', `${Math.max(8, visibleLeft - stageRect.left + 8)}px`);
  stage.style.setProperty('--nav-right', `${Math.max(8, stageRect.right - visibleRight + 8)}px`);
  caption.style.setProperty(
    '--caption-width',
    `${Math.round(Math.min(visibleWidth, stageRect.width))}px`
  );
}

function updateLightboxTransform(doc: Document, state: LightboxState): void {
  const img = doc.getElementById('lightbox-img') as HTMLImageElement | null;
  const resetBtn = doc.getElementById('lightbox-zoom-reset');
  if (!img) return;
  const zoom = state.lightboxZoom;
  img.style.transform = `translate(${state.lightboxPanX}px, ${state.lightboxPanY}px) scale(${zoom})`;
  img.classList.toggle('zoomed', zoom > 1.01);
  if (resetBtn) {
    resetBtn.textContent = `${Math.round(zoom * 100)}%`;
  }
  updateLightboxGeometry(doc);
}

function setLightboxZoom(doc: Document, state: LightboxState, zoom: number): void {
  state.lightboxZoom = Math.max(0.25, Math.min(6, zoom));
  if (state.lightboxZoom <= 1.01) {
    state.lightboxPanX = 0;
    state.lightboxPanY = 0;
  }
  updateLightboxTransform(doc, state);
}

function resetLightboxView(doc: Document, state: LightboxState): void {
  state.lightboxZoom = 1;
  state.lightboxPanX = 0;
  state.lightboxPanY = 0;
  updateLightboxTransform(doc, state);
}

function renderLightboxFigure(doc: Document, state: LightboxState): void {
  const stage = doc.getElementById('lightbox-stage');
  const img = doc.getElementById('lightbox-img') as HTMLImageElement | null;
  const caption = doc.getElementById('lightbox-caption');
  const figure = state.lightboxFigures[state.lightboxIndex];
  if (!stage || !img || !caption || !figure) return;

  let index = 0;
  img.onerror = () => {
    index++;
    if (index < figure.urls.length) {
      img.src = figure.urls[index];
    }
  };
  img.onload = () => updateLightboxGeometry(doc);
  img.src = figure.urls[0];
  caption.textContent = figureCaptionText(figure);
  resetLightboxView(doc, state);

  const single = state.lightboxFigures.length < 2;
  const prev = doc.getElementById('lightbox-prev') as HTMLButtonElement | null;
  const next = doc.getElementById('lightbox-next') as HTMLButtonElement | null;
  const navPrev = doc.getElementById('lightbox-nav-prev');
  const navNext = doc.getElementById('lightbox-nav-next');
  if (prev) prev.disabled = single;
  if (next) next.disabled = single;
  if (navPrev) navPrev.hidden = single;
  if (navNext) navNext.hidden = single;

  (doc.defaultView || globalThis).requestAnimationFrame?.(() => {
    updateLightboxGeometry(doc);
    stage.scrollTop = 0;
  });
}

function applyCanvasBackdrop(doc: Document, state: LightboxState): void {
  const stage = doc.getElementById('lightbox-stage');
  const img = doc.getElementById('lightbox-img');
  const canvasBtn = doc.getElementById('lightbox-canvas-btn');
  stage?.classList.toggle('light-canvas', state.lightboxLightCanvas);
  img?.classList.toggle('light-canvas', state.lightboxLightCanvas);
  if (canvasBtn) {
    canvasBtn.textContent = state.lightboxLightCanvas ? '☀' : '🌙';
    canvasBtn.setAttribute('aria-pressed', state.lightboxLightCanvas ? 'true' : 'false');
  }
}

export function openLightbox(
  doc: Document,
  state: LightboxState,
  figures: ArticleFigure | ArticleFigure[],
  index = 0
): void {
  state.lightboxFigures = dedupeFigures(Array.isArray(figures) ? figures : [figures]);
  if (!state.lightboxFigures.length) return;
  state.lightboxIndex = Math.max(0, Math.min(index, state.lightboxFigures.length - 1));
  const lightbox = doc.getElementById('lightbox');
  if (!lightbox) return;
  applyCanvasBackdrop(doc, state);
  renderLightboxFigure(doc, state);
  lightbox.hidden = false;
}

export function stepLightbox(doc: Document, state: LightboxState, delta: number): void {
  if (state.lightboxFigures.length < 2) return;
  state.lightboxIndex =
    (state.lightboxIndex + delta + state.lightboxFigures.length) % state.lightboxFigures.length;
  renderLightboxFigure(doc, state);
}

export function initLightbox(doc: Document, state: LightboxState, signal: AbortSignal): void {
  const lightbox = doc.getElementById('lightbox');
  const stage = doc.getElementById('lightbox-stage');
  const img = doc.getElementById('lightbox-img');
  if (!lightbox || !stage || !img) return;

  const win = doc.defaultView || globalThis;
  doc.getElementById('lightbox-close')?.addEventListener(
    'click',
    () => {
      lightbox.hidden = true;
    },
    { signal }
  );
  doc.getElementById('lightbox-prev')?.addEventListener('click', () => stepLightbox(doc, state, -1), {
    signal,
  });
  doc.getElementById('lightbox-next')?.addEventListener('click', () => stepLightbox(doc, state, 1), {
    signal,
  });
  doc.getElementById('lightbox-nav-prev')?.addEventListener(
    'click',
    (e) => {
      e.stopPropagation();
      stepLightbox(doc, state, -1);
    },
    { signal }
  );
  doc.getElementById('lightbox-nav-next')?.addEventListener(
    'click',
    (e) => {
      e.stopPropagation();
      stepLightbox(doc, state, 1);
    },
    { signal }
  );
  doc.getElementById('lightbox-zoom-in')?.addEventListener(
    'click',
    () => setLightboxZoom(doc, state, state.lightboxZoom * 1.25),
    { signal }
  );
  doc.getElementById('lightbox-zoom-out')?.addEventListener(
    'click',
    () => setLightboxZoom(doc, state, state.lightboxZoom / 1.25),
    { signal }
  );
  doc.getElementById('lightbox-zoom-reset')?.addEventListener(
    'click',
    () => resetLightboxView(doc, state),
    { signal }
  );
  doc.getElementById('lightbox-canvas-btn')?.addEventListener(
    'click',
    () => {
      state.lightboxLightCanvas = !state.lightboxLightCanvas;
      applyCanvasBackdrop(doc, state);
    },
    { signal }
  );

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      setLightboxZoom(doc, state, state.lightboxZoom * (e.deltaY < 0 ? 1.12 : 0.88));
    },
    { signal }
  );
  img.addEventListener(
    'dblclick',
    () => setLightboxZoom(doc, state, state.lightboxZoom > 1.01 ? 1 : 2),
    { signal }
  );
  img.addEventListener(
    'mousedown',
    (e) => {
      if (state.lightboxZoom <= 1.01) return;
      e.preventDefault();
      state.lightboxDrag = {
        x: e.clientX,
        y: e.clientY,
        panX: state.lightboxPanX,
        panY: state.lightboxPanY,
      };
      img.classList.add('dragging');
    },
    { signal }
  );

  win.addEventListener(
    'mousemove',
    (e: MouseEvent) => {
      if (!state.lightboxDrag) return;
      state.lightboxPanX = state.lightboxDrag.panX + e.clientX - state.lightboxDrag.x;
      state.lightboxPanY = state.lightboxDrag.panY + e.clientY - state.lightboxDrag.y;
      updateLightboxTransform(doc, state);
    },
    { signal }
  );
  win.addEventListener(
    'mouseup',
    () => {
      state.lightboxDrag = null;
      img.classList.remove('dragging');
    },
    { signal }
  );
  lightbox.addEventListener(
    'click',
    (e) => {
      if (e.target === lightbox) lightbox.hidden = true;
    },
    { signal }
  );
  win.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        lightbox.hidden = true;
      }
      if (lightbox.hidden) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepLightbox(doc, state, -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepLightbox(doc, state, 1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setLightboxZoom(doc, state, state.lightboxZoom * 1.25);
      } else if (e.key === '-') {
        e.preventDefault();
        setLightboxZoom(doc, state, state.lightboxZoom / 1.25);
      } else if (e.key === '0') {
        e.preventDefault();
        resetLightboxView(doc, state);
      }
    },
    { signal }
  );
}
