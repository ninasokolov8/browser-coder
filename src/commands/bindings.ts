/**
 * Binding UI to commands.
 *
 * The point of these helpers is that binding a control is the SAME act as reading
 * its enablement. A button wired with `bindButton` cannot be visually disabled but
 * functionally live, because one call sets the click handler and the disabled state
 * from the same declaration, and re-applies both whenever policy changes.
 *
 * That is the structural half of V-17. The registry refuses a disallowed command
 * regardless; this makes the UI stop offering it in the first place, so the two can
 * no longer disagree.
 */

import type { CommandRegistry, CommandContext } from './registry.ts';
import type { Disposable } from '../workspace/types.ts';

/** Applied alongside `disabled` so CSS can style either state consistently. */
const DISABLED_CLASS = 'command-disabled';

export interface BindOptions {
  /** Arguments passed to the command on every invocation. */
  args?: unknown[];
  source?: CommandContext['source'];
  /** Called with the outcome, e.g. to surface a refusal in the status bar. */
  onOutcome?: (outcome: Awaited<ReturnType<CommandRegistry['execute']>>) => void;
}

export function bindButton(
  registry: CommandRegistry,
  element: HTMLElement,
  commandId: string,
  options: BindOptions = {},
): Disposable {
  const source = options.source ?? 'ui';

  const apply = () => {
    const enabled = registry.isEnabled(commandId);
    element.classList.toggle(DISABLED_CLASS, !enabled);
    // `disabled` only exists on form controls; aria-disabled covers the rest and is
    // what a screen reader reads.
    if ('disabled' in element) (element as HTMLButtonElement).disabled = !enabled;
    element.setAttribute('aria-disabled', String(!enabled));
  };

  const onClick = (event: Event) => {
    // Stop the default before the enablement check, so a disabled <button> inside a
    // form cannot submit it on the way to being refused.
    event.preventDefault();
    void registry.execute(commandId, { source }, ...(options.args ?? [])).then(outcome => {
      options.onOutcome?.(outcome);
    });
  };

  element.addEventListener('click', onClick);
  const subscription = registry.onDidChangeEnablement(apply);
  apply();

  return {
    dispose: () => {
      element.removeEventListener('click', onClick);
      subscription.dispose();
    },
  };
}

/**
 * Bind a Monaco keybinding to a command.
 *
 * Monaco's `addCommand` has no enablement concept of its own, so the registry's
 * refusal is the only thing standing between a keystroke and the action. This is
 * where the old code was weakest: the button at least looked disabled, whereas
 * Ctrl+Enter and Ctrl+N had no indication and no check.
 */
export function bindKeybinding(
  registry: CommandRegistry,
  editor: { addCommand: (keybinding: number, handler: () => void) => unknown },
  keybinding: number,
  commandId: string,
  options: BindOptions = {},
): void {
  editor.addCommand(keybinding, () => {
    void registry
      .execute(commandId, { source: options.source ?? 'keybinding' }, ...(options.args ?? []))
      .then(outcome => options.onOutcome?.(outcome));
  });
}
