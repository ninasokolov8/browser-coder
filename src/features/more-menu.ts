/**
 * The one menu holding everything occasional.
 *
 * Exists so the titlebar can be short. Eleven controls competed in one row, with a
 * security-report link the most prominent thing on screen and a button that erases the
 * workspace sitting beside Download; the four a student actually uses were in the
 * middle with the same weight as a theme picker. The occasional ones moved in here.
 *
 * ## Behaviour, and why each part of it
 *
 * A menu that cannot be closed is worse than no menu. Escape closes it and returns
 * focus to the button that opened it, a click anywhere else closes it, and the button
 * reports its state through `aria-expanded` so a screen reader announces "collapsed"
 * rather than leaving the student to guess. Choosing an item closes it too - a menu
 * that stays open after you have used it reads as though the click did not register.
 *
 * The selects inside it do NOT close it: changing the theme and then the language is
 * one errand, and dismissing the menu between them would make it two.
 */

import type { Disposable } from '../workspace/types.ts';

export function initializeMoreMenu(): Disposable {
  const toggle = document.getElementById('more-toggle');
  const menu = document.getElementById('more-menu');
  const closeButton = document.getElementById('more-close');
  if (!toggle || !menu) return { dispose: () => {} };

  const setOpen = (open: boolean): void => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  const close = (returnFocus = false): void => {
    if (menu.hidden) return;
    setOpen(false);
    if (returnFocus) toggle.focus();
  };

  const onToggle = (event: Event): void => {
    event.stopPropagation();
    const open = menu.hidden;
    setOpen(open);
    if (open) {
      // Focus the first item, so the keyboard can drive it without a mouse ever
      // touching the menu.
      menu.querySelector<HTMLElement>('.more-item, select')?.focus();
    }
  };

  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || toggle.contains(target))) return;
    close();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.stopPropagation();
      close(true);
    }
  };

  // Only the ITEMS dismiss. A select is a setting the student may change twice.
  const onMenuClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.more-item')) close();
  };
  const onCloseClick = (): void => close(true);

  toggle.addEventListener('click', onToggle);
  closeButton?.addEventListener('click', onCloseClick);
  menu.addEventListener('click', onMenuClick);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);

  return {
    dispose: () => {
      toggle.removeEventListener('click', onToggle);
      closeButton?.removeEventListener('click', onCloseClick);
      menu.removeEventListener('click', onMenuClick);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
