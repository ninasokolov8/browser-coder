/**
 * What changed since the last time the program stopped.
 *
 * ## Why this is the most valuable thing the debugger can show
 *
 * A student stepping through a loop is looking at a list of names and numbers and
 * doing a diff in their head against what they saw a second ago. That mental diff is
 * the lesson - it is the moment "a variable is a box whose contents change" stops
 * being a sentence in a textbook.
 *
 * Doing the diff FOR them would take the lesson away. Pointing at where it happened
 * does the opposite: it tells them where to look, and the reasoning is still theirs.
 *
 * ## Scope changes are not changes
 *
 * Diffing is only meaningful within one frame. Stepping into a function replaces every
 * local at once, and marking all of them "new" would be noise on the one step where
 * the student most needs to read carefully. So the frame is part of the comparison,
 * and a different frame means no diff at all rather than a wrong one.
 */

import type { DebugFrame, DebugVariable } from './state.ts';

export type VariableChange = 'new' | 'changed' | 'same';

export interface DiffedVariable {
  readonly variable: DebugVariable;
  readonly change: VariableChange;
  /** The previous value's text, present only when `change` is 'changed'. */
  readonly previousText?: string;
}

/**
 * Identity of the frame a pause happened in.
 *
 * Name and file, not the line: stepping from line 6 to line 7 of the same function is
 * exactly the case diffs are for, so the line must NOT be part of it. Recursion is
 * deliberately treated as the same frame - the values still tell the story, and a
 * student watching a recursive call is watching precisely how they differ.
 */
export function frameKey(stack: readonly DebugFrame[]): string {
  const top = stack[0];
  return top ? `${top.file}::${top.name}` : '';
}

/**
 * Compare this pause's variables with the previous one's.
 *
 * A variable is 'changed' when its rendered text differs. Comparing the text rather
 * than a structural equality is deliberate: the text is exactly what the student is
 * looking at, so anything that changes what they see is a change, and anything that
 * does not is not - including a list mutated in place, whose repr moves when its
 * contents do.
 */
export function diffVariables(
  previous: readonly DebugVariable[] | null,
  current: readonly DebugVariable[],
): DiffedVariable[] {
  if (!previous) return current.map(variable => ({ variable, change: 'same' as const }));

  const before = new Map(previous.map(variable => [variable.name, variable.value.text]));

  return current.map(variable => {
    if (!before.has(variable.name)) return { variable, change: 'new' as const };

    const previousText = before.get(variable.name)!;
    if (previousText === variable.value.text) return { variable, change: 'same' as const };

    return { variable, change: 'changed' as const, previousText };
  });
}

/**
 * One sentence naming what moved, or null when nothing did.
 *
 * The list already highlights the row; this says it in words underneath, because
 * "side went from 2 to 3" is the sentence a student would say out loud, and reading it
 * once is what turns a highlighted row into an understood one.
 *
 * Only for a single change. Two or more and the highlighting is clearer than a
 * sentence listing them, and a step that changed six variables is a step where the
 * student should be reading the list rather than a summary of it.
 */
export function describeChange(diffed: readonly DiffedVariable[]): string | null {
  const moved = diffed.filter(entry => entry.change === 'changed');
  const added = diffed.filter(entry => entry.change === 'new');

  if (moved.length === 1 && added.length === 0) {
    const [entry] = moved;
    return `${entry.variable.name} went from ${entry.previousText} to ${entry.variable.value.text}`;
  }

  if (added.length === 1 && moved.length === 0) {
    const [entry] = added;
    return `${entry.variable.name} was created, and is ${entry.variable.value.text}`;
  }

  return null;
}

/**
 * Remembers the previous pause, so the UI does not have to.
 *
 * Keyed by frame: `record` returns the diff against the last pause IN THE SAME FRAME,
 * and starts fresh whenever the program moves to a different one.
 */
export class VariableHistory {
  #frame: string | null = null;
  #locals: readonly DebugVariable[] | null = null;

  /** Diff these locals against the previous pause, then remember them. */
  record(stack: readonly DebugFrame[], locals: readonly DebugVariable[]): DiffedVariable[] {
    const key = frameKey(stack);
    const previous = key === this.#frame ? this.#locals : null;

    const diffed = diffVariables(previous, locals);

    this.#frame = key;
    this.#locals = locals;
    return diffed;
  }

  /** Forget everything. Called when a session ends, so the next one starts clean. */
  reset(): void {
    this.#frame = null;
    this.#locals = null;
  }
}
