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

interface ActiveRun {
  readonly token: number;
  readonly stop: () => void;
  /**
   * The document Run was pressed on, so closing that tab can end the run.
   *
   * Recorded here rather than in the debugger because an ordinary run needs it too: a
   * program left going against a file the student has closed is a sandbox nobody can
   * see, reach or stop except by reloading the page.
   */
  readonly documentId: string | null;
}

let active: ActiveRun | null = null;
let nextToken = 1;

/** Restored when the run ends. Captured per-run so a UI language switch survives. */
let idleRunLabel = runBtn.innerHTML;

/** Whether a program is running right now. */
export function isRunActive(): boolean {
  return active !== null;
}

/** The document the running program was launched from, or null when nothing runs. */
export function activeRunDocument(): string | null {
  return active?.documentId ?? null;
}

/**
 * A run has begun.
 *
 * `stop` is passed in rather than imported so this module depends on neither the
 * console nor the debugger - the same injection the run console uses for
 * `resolveImage`, and what lets the rule be tested without either.
 */
export function runStarted(stop: () => void, documentId: string | null = null): number | null {
  // A second click while the first request is compiling must not replace its Stop
  // handler. The command registry disables Run and Debug too, but this guard is the
  // last line of defence for keyboard events and programmatic command calls already
  // queued before the buttons repainted.
  if (active) return null;

  idleRunLabel = runBtn.innerHTML;
  const token = nextToken++;
  active = { token, stop, documentId };

  // Run stays visible but inert: a second Run would kill the first and start again,
  // which is a confusing way to discover that Stop exists.
  runBtn.disabled = true;
  runBtn.innerHTML = `<span class="btn-spinner"></span>${t('titlebar.running')}`;

  stopBtn.hidden = false;
  stopBtn.disabled = false;
  window.dispatchEvent(new Event('runStateChanged'));
  return token;
}

/** The run ended - normally, by error, or because Stop was pressed. */
export function runEnded(token: number): void {
  // A delayed completion from an older request must never hide Stop for the request
  // that currently owns the controls.
  if (!active || active.token !== token) return;
  active = null;
  runBtn.disabled = false;
  runBtn.innerHTML = idleRunLabel;
  stopBtn.hidden = true;
  window.dispatchEvent(new Event('runStateChanged'));
}

/**
 * Stop whatever is running. Safe to call when nothing is.
 *
 * The button is disabled immediately rather than on the way back, because stopping a
 * compile can take a moment and a student who sees nothing happen presses it again.
 * `runEnded(token)` is NOT called here: the run's own settle path calls it, so the console
 * and the buttons cannot disagree about whether the program is still going.
 */
export function requestStop(): void {
  if (!active) return;
  stopBtn.disabled = true;
  active.stop();
}
