/**
 * Finding the marking harness in a workspace.
 *
 * A teacher ships one alongside the task. It has to be a file the student cannot open
 * - otherwise "check my work" is "read the answers" - which is what the `X_HIDDEN_`
 * prefix already provides: hidden from the tree, the tabs and every export, but fully
 * present in storage and in the payload that runs.
 *
 * Pure: no DOM, no Monaco, no workspace service. It is given a list of files and
 * answers which one to run, so the decision can be tested without a browser.
 */

import { isWorkspacePathHidden } from '../workspace-visibility.ts';

export interface HarnessCandidate {
  readonly path: string;
  readonly languageId: string;
}

export type HarnessResult =
  /** Exactly one harness. */
  | { readonly kind: 'found'; readonly path: string }
  /** None - the task has no checks, which is not an error. */
  | { readonly kind: 'none' }
  /** Several. Refused rather than guessed; the paths are named so it can be fixed. */
  | { readonly kind: 'ambiguous'; readonly paths: readonly string[] };

function basename(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  return normalised.slice(normalised.lastIndexOf('/') + 1);
}

/**
 * Is this the marking harness?
 *
 * Two conditions, and they are checked against different things on purpose. HIDDEN is a
 * property of the whole path - `isWorkspacePathHidden` looks at every ancestor segment,
 * so a harness inside an `X_HIDDEN_` folder counts even though its own name carries no
 * prefix. NAMED AS A TEST is a property of the basename only, so a file called
 * `main.py` inside `X_HIDDEN_tests/` is not mistaken for the harness.
 *
 * There is deliberately no single regex for this. One existed and was wrong: it
 * required the FILENAME to begin with `x_hidden_`, which contradicts the folder case
 * above - so the exported "pattern" described a rule the function did not apply.
 * Nothing used it, which is the only reason it never misled anybody.
 */
export function isHarnessFile(path: string): boolean {
  return isWorkspacePathHidden(path) && /test/i.test(basename(path));
}

/**
 * The harness to run for a language, or why there is not exactly one.
 *
 * Ambiguity is refused rather than resolved by picking the first. A task with two
 * harnesses is a mistake in the task, and running an arbitrary one of them would mark
 * the student against something the teacher did not intend - silently, and differently
 * depending on file order.
 */
export function findHarness(
  files: readonly HarnessCandidate[],
  languageId: string,
): HarnessResult {
  const matches = files
    .filter(file => file.languageId === languageId && isHarnessFile(file.path))
    .map(file => file.path)
    .sort();

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'ambiguous', paths: matches };
  return { kind: 'found', path: matches[0] };
}
