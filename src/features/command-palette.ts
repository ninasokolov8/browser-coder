/**
 * The command palette (Ctrl/Cmd+Shift+P).
 *
 * Almost free now that Phase D exists: a palette is the registry's command list,
 * filtered, with `isEnabled` deciding what can be picked. That is the point of
 * having built the registry first - without it, a palette would have been a second
 * list of actions to keep in step with the buttons and the keybindings, and a third
 * place to forget the policy check.
 *
 * Disabled commands are SHOWN, greyed and unselectable, rather than hidden. A
 * student in a read-only task who cannot find "Run" concludes the IDE is broken; one
 * who sees it greyed learns the task is locked.
 */

import { t } from '../i18n';
import type { CommandDefinition, CommandRegistry } from '../commands/registry.ts';
import type { Disposable } from '../workspace/types.ts';

const OVERLAY_ID = 'command-palette';

interface PaletteEntry {
  readonly command: CommandDefinition;
  readonly enabled: boolean;
  readonly label: string;
}

/**
 * Subsequence match, the behaviour every palette has: "nf" finds "New file".
 * Returns null when it does not match, so filtering and scoring are one pass.
 */
function score(query: string, label: string): number | null {
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

export function initializeCommandPalette(registry: CommandRegistry): Disposable {
  let overlay: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;
  let entries: PaletteEntry[] = [];
  let selected = 0;

  const labelFor = (command: CommandDefinition): string => {
    // Titles are i18n keys where one exists; t() returns the key unchanged
    // otherwise, so a command that has not been translated still reads sensibly.
    const translated = t(command.title);
    return translated === command.title ? command.title : translated;
  };

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

  const runSelected = async (): Promise<void> => {
    const entry = entries[selected];
    if (!entry || !entry.enabled) return;
    close();
    await registry.execute(entry.command.id, { source: 'palette' });
  };

  const renderList = (): void => {
    if (!list) return;
    list.textContent = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = t('palette.empty');
      list.appendChild(empty);
      return;
    }

    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'palette-row';
      row.classList.toggle('selected', index === selected);
      row.classList.toggle('disabled', !entry.enabled);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === selected));
      row.setAttribute('aria-disabled', String(!entry.enabled));

      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = entry.label;
      row.appendChild(label);

      if (!entry.enabled) {
        const note = document.createElement('span');
        note.className = 'palette-note';
        note.textContent = t('palette.unavailable');
        row.appendChild(note);
      }

      row.addEventListener('mousedown', event => {
        // mousedown, not click: the input's blur would tear the overlay down first.
        event.preventDefault();
        selected = index;
        void runSelected();
      });

      list!.appendChild(row);
    });
  };

  const refresh = (): void => {
    const query = (input?.value ?? '').trim();

    entries = registry
      .all()
      .map(command => ({ command, enabled: registry.isEnabled(command.id), label: labelFor(command) }))
      .map(entry => ({ entry, rank: score(query, entry.label) }))
      .filter((candidate): candidate is { entry: PaletteEntry; rank: number } => candidate.rank !== null)
      .sort((a, b) => {
        // Enabled first, then match quality, then alphabetical for stability -
        // a list that reorders between keystrokes is hard to click.
        if (a.entry.enabled !== b.entry.enabled) return a.entry.enabled ? -1 : 1;
        if (a.rank !== b.rank) return a.rank - b.rank;
        return a.entry.label.localeCompare(b.entry.label);
      })
      .map(candidate => candidate.entry);

    // Land on something usable rather than on a greyed row.
    const firstEnabled = entries.findIndex(entry => entry.enabled);
    selected = firstEnabled === -1 ? 0 : firstEnabled;
    renderList();
  };

  const moveSelection = (delta: number): void => {
    if (entries.length === 0) return;
    // Skips disabled rows: stepping onto something that cannot be chosen and having
    // Enter do nothing reads as a broken palette.
    for (let step = 1; step <= entries.length; step++) {
      const next = (selected + delta * step + entries.length * step) % entries.length;
      if (entries[next]?.enabled) {
        selected = next;
        renderList();
        return;
      }
    }
  };

  const open = (): void => {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const box = document.createElement('div');
    box.className = 'palette-box';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'palette-input';
    input.placeholder = t('palette.placeholder');
    input.setAttribute('aria-label', t('command.palette'));
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
          void runSelected();
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

  // Bound on the document rather than through Monaco, so the palette opens even when
  // focus is in the explorer, the search box or the output panel.
  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (overlay) close();
      else open();
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown);
      close();
    },
  };
}
