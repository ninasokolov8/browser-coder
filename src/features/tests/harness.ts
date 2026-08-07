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

/**
 * What a harness file is called.
 *
 * `X_HIDDEN_` is the visibility rule and `test` is the intent, so the name states both
 * and neither has to be inferred. Matched case-insensitively on the BASENAME, because
 * a teacher on Windows will type `X_Hidden_Tests.py` at some point.
 */
const HARNESS_NAME = /^x_hidden_.*test.*\.[a-z0-9]+$/i;

function basename(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  return normalised.slice(normalised.lastIndexOf('/') + 1);
}

/** Is this the marking harness? */
export function isHarnessFile(path: string): boolean {
  // Hidden AND named as a test. The hidden check looks at every ancestor segment, so
  // a harness inside an X_HIDDEN_ folder counts even if its own name does not start
  // with the prefix.
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

/**
 * A suggested harness file name for a language, for the teacher-facing documentation
 * and for any future "create a harness" affordance.
 */
export function suggestedHarnessName(extension: string): string {
  return `X_HIDDEN_tests.${extension}`;
}

/** The name pattern, exported so the docs and the tests cannot drift from the code. */
export const HARNESS_NAME_PATTERN = HARNESS_NAME;
