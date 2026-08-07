/**
 * The filtered-list overlay behind the command palette and quick-open.
 *
 * Extracted when quick-open was added, because the alternative was a second copy
 * of the overlay lifecycle, the subsequence matcher, the keyboard navigation and
 * the re-entrant-close fix - and that fix in particular was found by a failing
 * test, so duplicating it means duplicating a bug the day someone edits one copy.
 *
 * The DOM contract (ids and class names) is unchanged from the original palette:
 * `#command-palette`, `.palette-box`, `.palette-input`, `.palette-list`,
 * `.palette-row`, `.palette-label`, `.palette-note`, `.palette-empty`. The
 * stylesheet and the browser assertions both depend on it.
 *
 * `score` is pure and exported so it can be tested in node without a DOM.
 */

import type { Disposable } from '../workspace/types.ts';

/**
 * Subsequence match, the behaviour every palette has: "nf" finds "New file".
 * Returns null when it does not match, so filtering and scoring are one pass.
 */
export function score(query: string, label: string): number | null {
  if (query === '') return 0;

  const haystack = label.toLowerCase();
  const needle = query.toLowerCase();

  let position = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position);
    if (found === -1) return null;
    gaps += found - position;
    position = found + 1;
  }

  // Fewer gaps is a tighter match, and an earlier first hit ranks higher.
  return gaps;
}

/**
 * Score against a primary and a secondary string, preferring the primary.
 *
 * Quick-open needs this: typing "main" should rank the file named `main.py`
 * above one merely sitting in a folder called `main`. Matching only the full
 * path would rank them equally, and matching only the name would make a path
 * fragment unsearchable.
 */
export function scoreItem(query: string, label: string, detail?: string): number | null {
  const primary = score(query, label);
  if (primary !== null) return primary;
  if (!detail) return null;

  const secondary = score(query, detail);
  // A constant worse than any realistic primary gap, so every name match sorts
  // above every path-only match rather than interleaving with them.
  return secondary === null ? null : secondary + 1000;
}

export interface PickerItem {
  readonly id: string;
  /** Primary text, shown first and matched first. */
  readonly label: string;
  /** Secondary text, shown dimmed; also matched, at lower priority. */
  readonly detail?: string;
  readonly enabled?: boolean;
  /** Shown on a disabled row, explaining why it cannot be chosen. */
  readonly disabledNote?: string;
}

export interface PickerOptions {
  /** DOM id for the overlay. */
  readonly overlayId: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly emptyText: string;
  /** Read fresh on every open, so the list is never stale. */
  readonly items: () => readonly PickerItem[];
  readonly onPick: (item: PickerItem) => void | Promise<void>;
  /**
   * Sort key applied before match quality, lower first. Lets quick-open put
   * recently-used files at the top of an empty query without disturbing ranking
   * once the user types.
   */
  readonly initialOrder?: (item: PickerItem) => number;
}

export interface Picker extends Disposable {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

interface Ranked {
  readonly item: PickerItem;
  readonly rank: number;
}

export function createPicker(options: PickerOptions): Picker {
  let overlay: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  let ranked: PickerItem[] = [];
  let selected = 0;

  const close = (): void => {
    // Re-entrant by construction: removing the overlay blurs the input, and the
    // blur handler calls close() again SYNCHRONOUSLY, mid-removal. Clearing the
    // references first makes the second call a no-op. Removing first instead threw
    // "The node to be removed is no longer a child of this node" - found by the
    // app-boot suite, which toggles the palette shut while the input has focus.
    const doomed = overlay;
    overlay = null;
    input = null;
    list = null;
    doomed?.remove();
  };

  const pickSelected = async (): Promise<void> => {
    const item = ranked[selected];
    if (!item || item.enabled === false) return;
    close();
    await options.onPick(item);
  };

  const renderList = (): void => {
    if (!list) return;
    list.textContent = '';

    if (ranked.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = options.emptyText;
      list.appendChild(empty);
      return;
    }

    ranked.forEach((item, index) => {
      const enabled = item.enabled !== false;

      const row = document.createElement('div');
      row.className = 'palette-row';
      row.classList.toggle('selected', index === selected);
      row.classList.toggle('disabled', !enabled);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === selected));
      row.setAttribute('aria-disabled', String(!enabled));

      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = item.label;
      row.appendChild(label);

      if (item.detail) {
        const detail = document.createElement('span');
        detail.className = 'palette-detail';
        detail.textContent = item.detail;
        row.appendChild(detail);
      }

      if (!enabled && item.disabledNote) {
        const note = document.createElement('span');
        note.className = 'palette-note';
        note.textContent = item.disabledNote;
        row.appendChild(note);
      }

      row.addEventListener('mousedown', event => {
        // mousedown, not click: the input's blur would tear the overlay down first.
        event.preventDefault();
        selected = index;
        void pickSelected();
      });

      list!.appendChild(row);
    });
  };

  const refresh = (): void => {
    const query = (input?.value ?? '').trim();

    ranked = options
      .items()
      .map(item => ({ item, rank: scoreItem(query, item.label, item.detail) }))
      .filter((candidate): candidate is Ranked => candidate.rank !== null)
      .sort((a, b) => {
        // Enabled first, then match quality, then the caller's own ordering, then
        // alphabetical for stability - a list that reorders between keystrokes is
        // hard to click.
        const aEnabled = a.item.enabled !== false;
        const bEnabled = b.item.enabled !== false;
        if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (options.initialOrder) {
          const order = options.initialOrder(a.item) - options.initialOrder(b.item);
          if (order !== 0) return order;
        }
        return a.item.label.localeCompare(b.item.label);
      })
      .map(candidate => candidate.item);

    // Land on something usable rather than on a greyed row.
    const firstEnabled = ranked.findIndex(item => item.enabled !== false);
    selected = firstEnabled === -1 ? 0 : firstEnabled;
    renderList();
  };

  const moveSelection = (delta: number): void => {
    if (ranked.length === 0) return;
    // Skips disabled rows: stepping onto something that cannot be chosen and having
    // Enter do nothing reads as a broken palette.
    for (let step = 1; step <= ranked.length; step++) {
      const next = (selected + delta * step + ranked.length * step) % ranked.length;
      if (ranked[next]?.enabled !== false) {
        selected = next;
        renderList();
        return;
      }
    }
  };

  const open = (): void => {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = options.overlayId;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'palette-box';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'palette-input';
    input.placeholder = options.placeholder;
    input.setAttribute('aria-label', options.ariaLabel);
    box.appendChild(input);

    list = document.createElement('div');
    list.className = 'palette-list';
    list.setAttribute('role', 'listbox');
    box.appendChild(list);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input.addEventListener('input', refresh);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', event => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Enter':
          event.preventDefault();
          void pickSelected();
          break;
        default:
          break;
      }
    });

    // Clicking the backdrop dismisses, but clicking inside the box must not.
    overlay.addEventListener('mousedown', event => {
      if (event.target === overlay) close();
    });

    refresh();
    input.focus();
  };

  return {
    open,
    close,
    toggle: () => (overlay ? close() : open()),
    isOpen: () => overlay !== null,
    dispose: close,
  };
}
