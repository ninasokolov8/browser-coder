/**
 * Image popup window.
 *
 * Running an SVG file shows the picture itself, in the same kind of small
 * floating window a turtle drawing opens in, so the Output panel stays free for
 * the hints/text and the image can be dragged out of the way or kept open next
 * to the code while editing it.
 */

import { getPopupWindow, hidePopupWindow, showPopupWindow } from './popup-window';
import { svgToDataUrl } from './svg-assets';

const IMAGE_WINDOW_ID = 'image-window';

/**
 * Show SVG source in the image window, titled with its file name.
 *
 * The picture is loaded through an <img src="data:..."> and never as inline
 * markup: an <img> cannot run scripts, so a hand-written <script> inside an SVG
 * can never reach the IDE's own DOM.
 */
export function showImageWindow(fileName: string, svgSource: string): void {
  const popup = getPopupWindow(IMAGE_WINDOW_ID, `🖼️ ${fileName}`, hideImageWindow);
  if (!popup) return;

  let picture = popup.bodyEl.querySelector('img') as HTMLImageElement | null;
  if (!picture) {
    picture = document.createElement('img');
    picture.id = 'image-window-picture';
    popup.bodyEl.appendChild(picture);
  }

  picture.alt = fileName;
  picture.src = svgToDataUrl(svgSource);

  showPopupWindow(popup.windowEl);
}

/** Hide the image window. Safe to call when it was never opened. */
export function hideImageWindow(): void {
  hidePopupWindow(IMAGE_WINDOW_ID);
}
