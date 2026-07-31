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
 *
 * The overlay itself lives in `picker.ts`, shared with quick-open.
 */

import { t } from '../i18n';
import { createPicker, type PickerItem } from './picker.ts';
import type { CommandDefinition, CommandRegistry } from '../commands/registry.ts';
import type { Disposable } from '../workspace/types.ts';

const OVERLAY_ID = 'command-palette';

export function initializeCommandPalette(registry: CommandRegistry): Disposable {
  const labelFor = (command: CommandDefinition): string => {
    // Titles are i18n keys where one exists; t() returns the key unchanged
    // otherwise, so a command that has not been translated still reads sensibly.
    const translated = t(command.title);
    return translated === command.title ? command.title : translated;
  };

  const picker = createPicker({
    overlayId: OVERLAY_ID,
    placeholder: t('palette.placeholder'),
    ariaLabel: t('command.palette'),
    emptyText: t('palette.empty'),
    items: (): PickerItem[] =>
      registry.all().map(command => ({
        id: command.id,
        label: labelFor(command),
        enabled: registry.isEnabled(command.id),
        disabledNote: t('palette.unavailable'),
      })),
    onPick: async item => {
      await registry.execute(item.id, { source: 'palette' });
    },
  });

  // Bound on the document rather than through Monaco, so the palette opens even when
  // focus is in the explorer, the search box or the output panel.
  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      picker.toggle();
    }
  };

  document.addEventListener('keydown', onKeyDown);

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown);
      picker.dispose();
    },
  };
}
