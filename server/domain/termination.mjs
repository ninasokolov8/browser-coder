/**
 * Typed process-termination reasons and the mapping to the legacy wire format.
 *
 * The defect this replaces (blueprint V-20) was one expression:
 *
 *     exitCode: killed ? -1 : (exitCode || 0)
 *
 * It has two failure modes. `killed` was set only by the wall-clock timer, so
 * the output-cap path called proc.kill() and then reported **exit 0** for a
 * program that was forcibly stopped. And `(exitCode || 0)` coerces `null` - the
 * value Node reports when a process dies from a signal - to success, so a
 * segfault or an OOM kill also looked like a clean run.
 *
 * Both are the same underlying mistake: deriving success from the absence of
 * information. Here the reason is always established explicitly at the point the
 * decision is made, and the legacy code is derived from it.
 *
 * Pure module: no fs, no child_process, no express.
 */

/**
 * Why a process stopped. A superset is defined in the blueprint for the eventual
 * session protocol; these are the reasons this deployment can actually
 * distinguish today.
 */
export const TerminationReason = Object.freeze({
  /** Ran to completion and returned an exit status, zero or not. */
  EXITED: 'exited',
  /** Died from a signal that was not one we sent deliberately. */
  SIGNALED: 'signaled',
  /** Wall-clock budget for the whole run was exhausted. */
  TIMEOUT: 'timeout',
  /** No output and no input for the configured idle window (interactive only). */
  IDLE_TIMEOUT: 'idle_timeout',
  /** Absolute session lifetime ceiling reached (interactive only). */
  LIFETIME_LIMIT: 'lifetime_limit',
  /** Produced more stdout/stderr than the budget allows. */
  OUTPUT_LIMIT: 'output_limit',
  /** Stopped because the client disconnected or asked to stop. */
  CANCELLED: 'cancelled',
  /** Could not be started at all (missing binary, spawn failure). */
  STARTUP_ERROR: 'startup_error',
  /** A build or lint step failed before the program ran. */
  COMPILE_ERROR: 'compile_error',
  /** Rejected by policy before execution. */
  POLICY_DENIED: 'policy_denied',
  /** The service failed, not the program. */
  INFRASTRUCTURE_ERROR: 'infrastructure_error',
});

/** Reasons that mean the service stopped the program on purpose. */
const SERVICE_INITIATED = new Set([
  TerminationReason.TIMEOUT,
  TerminationReason.IDLE_TIMEOUT,
  TerminationReason.LIFETIME_LIMIT,
  TerminationReason.OUTPUT_LIMIT,
  TerminationReason.CANCELLED,
]);

/**
 * The exit code the v1 API reports.
 *
 * Frozen contract: a normal exit reports its own status, and anything the
 * service terminated reports -1. Step-Up treats a nonzero code as "the student's
 * program failed", which is the correct reading for every case here.
 */
export const LEGACY_TERMINATED_EXIT_CODE = -1;

/**
 * Establish the termination from what the process actually reported.
 *
 * @param {object} input
 * @param {number|null} input.code   exit status from the 'close'/'exit' event
 * @param {string|null} input.signal signal name, when the OS killed it
 * @param {string|null} [input.serviceReason] reason we stopped it, if we did.
 *   Takes precedence: when the service sends SIGKILL for an output overflow the
 *   OS-level view is "died from SIGKILL", but the meaningful reason is the cap.
 * @returns {{reason: string, exitCode: number|null, signal: string|null, succeeded: boolean, serviceInitiated: boolean}}
 */
export function classifyExit({ code, signal, serviceReason = null }) {
  if (serviceReason) {
    return {
      reason: serviceReason,
      // Deliberately preserved, not discarded: a run killed for exceeding the
      // output cap may still have exited on its own microseconds earlier, and
      // the raw values are what makes that diagnosable.
      exitCode: typeof code === 'number' ? code : null,
      signal: signal ?? null,
      succeeded: false,
      serviceInitiated: SERVICE_INITIATED.has(serviceReason),
    };
  }

  if (signal) {
    return {
      reason: TerminationReason.SIGNALED,
      exitCode: null,
      signal,
      succeeded: false,
      serviceInitiated: false,
    };
  }

  if (typeof code !== 'number') {
    // Neither an exit status nor a signal. Never guess success from this.
    return {
      reason: TerminationReason.INFRASTRUCTURE_ERROR,
      exitCode: null,
      signal: null,
      succeeded: false,
      serviceInitiated: false,
    };
  }

  return {
    reason: TerminationReason.EXITED,
    exitCode: code,
    signal: null,
    succeeded: code === 0,
    serviceInitiated: false,
  };
}

/**
 * Collapse a termination into the single integer the v1 API exposes.
 *
 * @param {ReturnType<typeof classifyExit>} termination
 * @returns {number}
 */
export function toLegacyExitCode(termination) {
  if (termination.reason === TerminationReason.EXITED) {
    return termination.exitCode;
  }
  return LEGACY_TERMINATED_EXIT_CODE;
}

/**
 * Short human note for the interactive `exit` event's `note` field.
 *
 * The frozen v1 vocabulary is 'idle-timeout' | 'output-limit' | 'time-limit' |
 * null, so new reasons map onto those rather than introducing values the
 * existing console UI does not recognise.
 */
export function toLegacyNote(termination) {
  switch (termination.reason) {
    case TerminationReason.IDLE_TIMEOUT:
      return 'idle-timeout';
    case TerminationReason.OUTPUT_LIMIT:
      return 'output-limit';
    case TerminationReason.LIFETIME_LIMIT:
    case TerminationReason.TIMEOUT:
      return 'time-limit';
    default:
      return null;
  }
}

/**
 * A sentence for the user explaining why their program stopped.
 *
 * Kept here rather than in the HTTP layer so buffered, interactive and future
 * transports cannot describe the same reason differently.
 */
export function describeTermination(termination) {
  switch (termination.reason) {
    case TerminationReason.EXITED:
      return termination.exitCode === 0
        ? 'Program finished successfully.'
        : `Program exited with code ${termination.exitCode}.`;
    case TerminationReason.SIGNALED:
      return `Program was terminated by ${termination.signal}. This usually means it ran out of memory or crashed.`;
    case TerminationReason.TIMEOUT:
      return 'Program was stopped because it exceeded the time limit.';
    case TerminationReason.IDLE_TIMEOUT:
      return 'Session was stopped after too long with no output and no input.';
    case TerminationReason.LIFETIME_LIMIT:
      return 'Session was stopped because it reached the maximum session length.';
    case TerminationReason.OUTPUT_LIMIT:
      return 'Program was stopped because it produced too much output.';
    case TerminationReason.CANCELLED:
      return 'Program was stopped.';
    case TerminationReason.STARTUP_ERROR:
      return 'Program could not be started.';
    case TerminationReason.COMPILE_ERROR:
      return 'Program was not run because it failed to compile.';
    case TerminationReason.POLICY_DENIED:
      return 'Program was not run because it was refused by policy.';
    case TerminationReason.INFRASTRUCTURE_ERROR:
      // Deliberately says the service failed rather than blaming the program:
      // this reason is reached when the process reported neither an exit status
      // nor a signal, which is never something the user's code did.
      return 'Program stopped because of a service error, not a problem in your code. Please try again.';
    default:
      return 'Program stopped for an unknown reason.';
  }
}
