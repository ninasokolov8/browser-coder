/**
 * Saying out loud what a sighted student can see.
 *
 * The IDE reports almost everything visually and nothing audibly. A run finishes and
 * the panel fills with text; a screen-reader user gets no signal at all that anything
 * happened, because the panel is deliberately not a live region - a program that prints
 * two hundred lines would read all two hundred aloud, which is worse than silence.
 *
 * So the panel stays quiet and this says one sentence instead: what happened, and what
 * went wrong if anything. That is the difference between "something may have run" and
 * "it failed on line 2 with a ReferenceError".
 */

/** Built once. Absent in a test page that does not include the app shell. */
function region(): HTMLElement | null {
  return document.getElementById('a11y-announcer');
}

/**
 * Announce one short sentence.
 *
 * Repeating the identical string is a real case here - two runs that both succeed - and
 * a live region does NOT re-announce text that did not change. Clearing first, then
 * setting on the next frame, is the standard way to force it.
 */
export function announce(message: string): void {
  const target = region();
  if (!target || !message) return;

  target.textContent = '';
  requestAnimationFrame(() => {
    target.textContent = message;
  });
}

/**
 * The sentence for a finished run.
 *
 * Pure and exported so the wording is testable without a DOM: the whole value of this
 * feature is in what it says.
 */
export function describeRunOutcome(options: {
  exitCode: number;
  errorSummary?: string | null;
  problemCount?: number;
}): string {
  const parts: string[] = [];

  if (options.exitCode === 0) {
    parts.push('Run finished successfully.');
  } else if (options.exitCode < 0) {
    // Negative is the pipeline's own signal for a kill: a timeout, an output cap, or
    // Stop. "Exit code -1" would mean nothing to a student.
    parts.push('Run stopped before it finished.');
  } else {
    parts.push(`Run failed with exit code ${options.exitCode}.`);
  }

  if (options.errorSummary) parts.push(options.errorSummary);

  if (options.problemCount && options.problemCount > 0) {
    parts.push(
      options.problemCount === 1
        ? '1 problem in the Problems panel.'
        : `${options.problemCount} problems in the Problems panel.`,
    );
  }

  return parts.join(' ');
}
