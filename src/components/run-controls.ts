/**
 * One owner for "is something running", and the Run/Stop pair that shows it.
 *
 * ## What this replaces
 *
 * Three modules were writing to the Run button and none of them owned it:
 *
 *   - `run-loader.ts` disabled it and swapped in a spinner,
 *   - `interactive-console.ts` set `runBtn.disabled = true` when a stream opened and
 *     `false` when it settled,
 *   - `execution.ts` called the loader's start/stop around all of it.
 *
 * The net effect was that Run stayed disabled for the whole run and there was no Stop
 * anywhere. A student whose program had an endless loop, or was blocked on input that
 * never came, had no way to end it: the only exits were the server-side timeout or
 * reloading the page, which throws away the console and the session with it.
 *
 * That is the worst version of this bug for a teaching tool. Writing an accidental
 * infinite loop is not an edge case, it is a lesson - and the IDE's answer to it was
 * to take the controls away.
 *
 * ## The rule
 *
 * There is exactly one piece of state, `active`, and the buttons are a function of it.
 * Nothing else may touch either button's `disabled` or `hidden`.
 */

import { runBtn, stopBtn } from './dom';
import { t } from '../i18n/index.ts';

/** How the program is being run, so Stop can end the right thing. */
export type RunKind = 'run' | 'debug';

interface ActiveRun {
  readonly kind: RunKind;
  readonly stop: () => void;
}

let active: ActiveRun | null = null;

/** Restored when the run ends. Captured per-run so a UI language switch survives. */
let idleRunLabel = runBtn.innerHTML;

/** Whether a program is running right now. */
export function isRunActive(): boolean {
  return active !== null;
}

/**
 * A run has begun.
 *
 * `stop` is passed in rather than imported so this module depends on neither the
 * console nor the debugger - the same injection the run console uses for
 * `resolveImage`, and what lets the rule be tested without either.
 */
export function runStarted(kind: RunKind, stop: () => void): void {
  idleRunLabel = active ? idleRunLabel : runBtn.innerHTML;
  active = { kind, stop };

  // Run stays visible but inert: a second Run would kill the first and start again,
  // which is a confusing way to discover that Stop exists.
  runBtn.disabled = true;
  runBtn.innerHTML = `<span class="btn-spinner"></span>${t('titlebar.running')}`;

  stopBtn.hidden = false;
  stopBtn.disabled = false;
}

/** The run ended - normally, by error, or because Stop was pressed. */
export function runEnded(): void {
  active = null;
  runBtn.disabled = false;
  runBtn.innerHTML = idleRunLabel;
  stopBtn.hidden = true;
}

/**
 * Stop whatever is running. Safe to call when nothing is.
 *
 * The button is disabled immediately rather than on the way back, because stopping a
 * compile can take a moment and a student who sees nothing happen presses it again.
 * `runEnded()` is NOT called here: the run's own settle path calls it, so the console
 * and the buttons cannot disagree about whether the program is still going.
 */
export function requestStop(): void {
  if (!active) return;
  stopBtn.disabled = true;
  active.stop();
}
