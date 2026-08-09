import { t } from '../i18n/index.ts';

/**
 * Floating popup windows.
 *
 * Program output that is a *picture* — a turtle drawing, an SVG image — opens in
 * its own small draggable window instead of the Output panel, so it never
 * covers or collides with stdout/stderr/prints. Both stay visible at the same
 * time, exactly like a real IDE where graphics open in a separate window.
 *
 * Every window shares this shell (header with title and close button, body,
 * drag behaviour); callers own only what goes inside the body.
 */

const DEFAULT_TOP = '90px';
const DEFAULT_RIGHT = '24px';

export interface PopupWindow {
  windowEl: HTMLElement;
  bodyEl: HTMLElement;
}

/**
 * Resolve a popup window by id, building it on first use.
 *
 * Created lazily so a deployment whose index.html predates a given window still
 * works, and so every run can safely call the matching hide function without
 * crashing. `onClose` is bound once, when the window is built.
 */
export function getPopupWindow(
  id: string,
  title: string,
  onClose: () => void,
): PopupWindow | null {
  let windowEl = document.getElementById(id);

  if (!windowEl) {
    windowEl = document.createElement('div');
    windowEl.id = id;
    windowEl.className = 'popup-window hidden';
    windowEl.innerHTML =
      `<div class="popup-window-header" id="${id}-header">` +
        `<span class="popup-window-title" id="${id}-title"></span>` +
        `<button class="popup-window-close" id="${id}-close" ` +
          `title="${t('common.close')}" aria-label="${t('common.close')}" ` +
          `data-i18n-title="common.close" data-i18n-aria-label="common.close">✕</button>` +
      `</div>` +
      `<div class="popup-window-body" id="${id}-body"></div>`;
    document.body.appendChild(windowEl);
  }

  const bodyEl = windowEl.querySelector('.popup-window-body') as HTMLElement | null;
  if (!bodyEl) return null;

  // Set every time: a title may carry the current file name.
  const titleEl = windowEl.querySelector('.popup-window-title') as HTMLElement | null;
  if (titleEl) titleEl.textContent = title;

  const closeBtn = windowEl.querySelector('.popup-window-close') as HTMLButtonElement | null;
  if (closeBtn) {
    closeBtn.title = t('common.close');
    closeBtn.setAttribute('aria-label', t('common.close'));
  }
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', onClose);
  }

  // Draggable via the header (pointer events cover mouse + touch + pen).
  const header = windowEl.querySelector('.popup-window-header') as HTMLElement | null;
  if (header && !header.dataset.dragBound) {
    header.dataset.dragBound = '1';
    makeDraggable(windowEl, header);
  }

  return { windowEl, bodyEl };
}

/**
 * Reveal a popup window.
 *
 * A window that was hidden snaps back to the default top-right spot so it is
 * always on screen; one that is already open (a re-run) keeps whatever position
 * the user dragged it to.
 */
export function showPopupWindow(windowEl: HTMLElement): void {
  const wasHidden = windowEl.classList.contains('hidden');
  windowEl.classList.remove('hidden');
  if (!wasHidden) return;

  windowEl.style.left   = 'auto';
  windowEl.style.top    = DEFAULT_TOP;
  windowEl.style.right  = DEFAULT_RIGHT;
  windowEl.style.bottom = 'auto';
}

/** Hide a popup window if it exists. Safe to call when it was never built. */
export function hidePopupWindow(id: string): void {
  document.getElementById(id)?.classList.add('hidden');
}

/** Make `win` draggable by dragging `handle`, clamped to the viewport. */
function makeDraggable(win: HTMLElement, handle: HTMLElement): void {
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    // Never start a drag from the close button.
    if ((e.target as HTMLElement).closest('.popup-window-close')) return;
    dragging = true;
    const rect = win.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    // Switch to absolute left/top positioning (drops the default right/top).
    win.style.left = startLeft + 'px';
    win.style.top = startTop + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    try { handle.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    let nl = startLeft + (e.clientX - startX);
    let nt = startTop + (e.clientY - startY);
    // Keep a grabbable strip on screen no matter how far the user drags.
    const maxL = window.innerWidth - 120;
    const maxT = window.innerHeight - 40;
    nl = Math.max(120 - win.offsetWidth, Math.min(nl, maxL));
    nt = Math.max(0, Math.min(nt, maxT));
    win.style.left = nl + 'px';
    win.style.top = nt + 'px';
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}
