/**
 * The command registry - one enforcement point for everything the user can do.
 *
 * V-17, as recorded, was "the run button and Ctrl+Enter never consult
 * `policyState.allowRun`". Reading the code showed it is wider than that:
 *
 *   runBtn.addEventListener('click', () => runCode(editor.getValue()));
 *   editor.addCommand(CtrlCmd | Enter, () => runBtn.click());
 *   editor.addCommand(CtrlCmd | KeyN, async () => tabManager.createNewFile(...));
 *   editor.addCommand(CtrlCmd | KeyW, async () => tabManager.closeTab(...));
 *
 * None of them checks anything. The sidebar meanwhile does:
 *
 *   document.body.classList.toggle('run-disabled', !policyState.allowRun);
 *
 * which greys the button with CSS. So a read-only embed *looked* locked and was
 * not: clicking the greyed button ran the code, and Ctrl+N created files in a
 * structure-locked workspace. `stepup.ts` did check `allowRun` before synthesising
 * a click - which is the tell. Enforcement lived at one caller instead of at the
 * action, so every other caller was a hole.
 *
 * The fix is structural rather than four added `if`s: an action is declared once,
 * with the capability it needs, and **both** the enablement of its UI and the
 * refusal of its execution derive from that single declaration. A new button
 * cannot forget the check, because binding a button is what reads it.
 *
 * No DOM and no policy import here - policy arrives as a function - so the
 * enforcement logic is testable in node.
 */

import { Emitter } from '../workspace/emitter.ts';
import type { Disposable } from '../workspace/types.ts';

/**
 * What a command needs permission to do.
 *
 * Deliberately coarse. These are the four axes Step-Up actually negotiates over
 * postMessage; inventing a finer-grained permission model than the host can express
 * would produce capabilities nothing ever sets.
 */
export type Capability = 'run' | 'edit' | 'structure' | 'searchReplace';

export interface CommandContext {
  /** Where the invocation came from. Recorded so a refusal can be explained. */
  readonly source: 'ui' | 'keybinding' | 'palette' | 'host' | 'api';
}

export interface CommandDefinition<A extends unknown[] = unknown[]> {
  readonly id: string;
  /** i18n key or literal title, for the palette and for tooltips. */
  readonly title: string;
  readonly capability?: Capability;
  /** Extra enablement beyond capability, e.g. "a document is open". */
  readonly when?: () => boolean;
  readonly run: (context: CommandContext, ...args: A) => void | Promise<void>;
}

export type CommandOutcome =
  | { readonly status: 'ran' }
  | { readonly status: 'unknown'; readonly id: string }
  | { readonly status: 'refused'; readonly reason: 'capability' | 'disabled'; readonly capability?: Capability }
  | { readonly status: 'failed'; readonly error: Error };

export interface CommandRegistryOptions {
  /** Answers whether the current policy grants a capability. */
  isAllowed: (capability: Capability) => boolean;
  /** Reports a refusal to the user. Optional so tests stay silent. */
  onRefused?: (command: CommandDefinition, outcome: CommandOutcome) => void;
}

export class CommandRegistry {
  // Stored with a permissive argument type: the registry dispatches arguments it
  // cannot know the shape of, and the type safety that matters is at register()
  // where the definition and its handler are written together.
  #commands = new Map<string, CommandDefinition<any[]>>();
  #isAllowed: (capability: Capability) => boolean;
  #onRefused?: (command: CommandDefinition, outcome: CommandOutcome) => void;
  #onDidChangeEnablement = new Emitter<void>();

  constructor(options: CommandRegistryOptions) {
    this.#isAllowed = options.isAllowed;
    this.#onRefused = options.onRefused;
  }

  /**
   * Fired when policy changes. Bound UI re-reads enablement rather than each call
   * site remembering to update itself - the omission that left a "disabled" button
   * clickable.
   */
  readonly onDidChangeEnablement = (listener: () => void): Disposable =>
    this.#onDidChangeEnablement.event(listener);

  /** Call after policy changes, e.g. on stepup:set-readonly. */
  notifyPolicyChanged(): void {
    this.#onDidChangeEnablement.fire();
  }

  /** Re-evaluate dynamic `when` clauses after the active model/language changes. */
  notifyEnablementChanged(): void {
    this.#onDidChangeEnablement.fire();
  }

  register<A extends unknown[]>(command: CommandDefinition<A>): Disposable {
    if (this.#commands.has(command.id)) {
      // A duplicate id means two actions silently share one keybinding and one
      // palette entry, and which wins depends on import order.
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.#commands.set(command.id, command as CommandDefinition<unknown[]>);
    return { dispose: () => this.#commands.delete(command.id) };
  }

  get(id: string): CommandDefinition | null {
    return this.#commands.get(id) ?? null;
  }

  all(): CommandDefinition[] {
    return [...this.#commands.values()];
  }

  /** True when the command may run right now. Drives both UI state and execution. */
  isEnabled(id: string): boolean {
    const command = this.#commands.get(id);
    if (!command) return false;
    if (command.capability && !this.#isAllowed(command.capability)) return false;
    if (command.when && !command.when()) return false;
    return true;
  }

  /**
   * The only way to invoke a command.
   *
   * Re-checks enablement rather than trusting that the caller checked: a
   * keybinding, a stale button, and a host message all arrive here, and the
   * intervening policy change is exactly the case a caller-side check misses.
   */
  async execute(id: string, context: CommandContext, ...args: unknown[]): Promise<CommandOutcome> {
    const command = this.#commands.get(id);
    if (!command) return { status: 'unknown', id };

    if (command.capability && !this.#isAllowed(command.capability)) {
      const outcome: CommandOutcome = {
        status: 'refused',
        reason: 'capability',
        capability: command.capability,
      };
      this.#onRefused?.(command, outcome);
      return outcome;
    }

    if (command.when && !command.when()) {
      const outcome: CommandOutcome = { status: 'refused', reason: 'disabled' };
      this.#onRefused?.(command, outcome);
      return outcome;
    }

    try {
      await command.run(context, ...args);
      return { status: 'ran' };
    } catch (error) {
      // A failing command must not take the UI event handler with it.
      const failure = error instanceof Error ? error : new Error(String(error));
      console.error(`[commands] "${id}" failed`, failure);
      return { status: 'failed', error: failure };
    }
  }
}
