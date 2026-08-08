/**
 * Every place the program has stopped, so a student can step BACKWARDS.
 *
 * ## Why this is nearly free
 *
 * The adapter already sends a complete picture at every pause: the line, the call stack
 * and every local with its rendered value. The debugger drew the newest one and dropped
 * the rest on the floor. Keeping them turns "step back" from a research project into a
 * lookup - the hard part, capturing consistent state at every stop, was already done
 * and tested for all five languages.
 *
 * ## Why it matters more here than in a professional editor
 *
 * A professional wants to know where they are NOW. A student is trying to work out how
 * they got here, and one step too far currently means restarting the program and
 * clicking back to the same place - which inside a loop is twenty clicks and losing
 * their train of thought entirely. Stepping past the interesting moment is the single
 * most common way a beginner's debugging session falls apart.
 *
 * ## Looking at the past is not being in the past
 *
 * The program is still suspended wherever the engine left it. This only changes which
 * recorded moment is DISPLAYED. Nothing here sends a command, and the engine's real
 * position is untouched - which is why stepping forward from a historical view has to
 * return to the present first, and why that is the caller's job rather than this
 * module's.
 */

import type { DebugStop } from './state.ts';

/**
 * How many stops to keep.
 *
 * A loop can pause thousands of times and each entry holds every local, so this is
 * bounded rather than allowed to grow with the run. The OLDEST are dropped: a student
 * looking back is almost always looking at the last few steps, and the alternative -
 * dropping the newest - would make the feature useless exactly when it is used.
 */
const MAX_STOPS = 500;

export interface HistoryView {
  /** The stop to display: a past one while looking back, otherwise the newest. */
  readonly stop: DebugStop | null;
  /** 0-based position of `stop`, or -1 when there is no history. */
  readonly index: number;
  readonly total: number;
  /** True while displaying anything other than the newest stop. */
  readonly viewingPast: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export class StopHistory {
  #stops: DebugStop[] = [];
  /** null means "showing the newest", which is the normal state. */
  #viewing: number | null = null;

  /** Record a new pause. Always snaps the view back to the present. */
  record(stop: DebugStop): void {
    this.#stops.push(stop);
    if (this.#stops.length > MAX_STOPS) this.#stops.shift();
    // The program moved, so looking at the past is over. Staying put would leave the
    // editor showing an old line while the program is somewhere else entirely.
    this.#viewing = null;
  }

  /** Forget everything. A finished session's stops belong to a different execution. */
  reset(): void {
    this.#stops = [];
    this.#viewing = null;
  }

  view(): HistoryView {
    const total = this.#stops.length;
    if (total === 0) {
      return { stop: null, index: -1, total: 0, viewingPast: false, canGoBack: false, canGoForward: false };
    }

    const index = this.#viewing ?? total - 1;
    return {
      stop: this.#stops[index] ?? null,
      index,
      total,
      viewingPast: this.#viewing !== null && this.#viewing < total - 1,
      canGoBack: index > 0,
      canGoForward: index < total - 1,
    };
  }

  /** One step towards the beginning. Returns whether anything moved. */
  back(): boolean {
    const { index, canGoBack } = this.view();
    if (!canGoBack) return false;
    this.#viewing = index - 1;
    return true;
  }

  /** One step towards the present. Returns whether anything moved. */
  forward(): boolean {
    const { index, canGoForward } = this.view();
    if (!canGoForward) return false;

    const next = index + 1;
    // Landing on the newest returns to LIVE rather than pinning the last index, so a
    // stop arriving afterwards is displayed instead of being silently skipped.
    this.#viewing = next >= this.#stops.length - 1 ? null : next;
    return true;
  }

  /** Jump to a recorded moment by position - what clicking the tape does. */
  goTo(index: number): boolean {
    if (index < 0 || index >= this.#stops.length) return false;
    this.#viewing = index >= this.#stops.length - 1 ? null : index;
    return true;
  }

  /** Return to the present. Called before any command that moves the program. */
  toLive(): void {
    this.#viewing = null;
  }

  /**
   * Every value one variable has held, in order.
   *
   * This is the strip under the variables panel: `0 1 2 3` for a loop counter, with the
   * moment being viewed marked. A variable that did not exist yet at some stop is null
   * rather than absent, so the tape's positions line up with the history's.
   */
  tape(name: string): Array<{ index: number; text: string | null }> {
    return this.#stops.map((stop, index) => ({
      index,
      text: stop.locals.find(variable => variable.name === name)?.value.text ?? null,
    }));
  }

  /** Names worth showing a tape for: anything that was ever a local. */
  trackedNames(): string[] {
    const seen = new Set<string>();
    for (const stop of this.#stops) {
      for (const variable of stop.locals) seen.add(variable.name);
    }
    return [...seen];
  }
}
