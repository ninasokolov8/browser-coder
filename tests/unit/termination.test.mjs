/**
 * Unit tests for termination classification.
 *
 * The whole point of this module is that success is never inferred from missing
 * information, so most of these tests are about what must NOT be reported as 0.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_TERMINATED_EXIT_CODE,
  TerminationReason,
  classifyExit,
  describeTermination,
  toLegacyExitCode,
  toLegacyNote,
} from '../../server/domain/termination.mjs';

describe('classifyExit - normal exits', () => {
  it('classifies a clean exit as success', () => {
    const t = classifyExit({ code: 0, signal: null });
    assert.equal(t.reason, TerminationReason.EXITED);
    assert.equal(t.exitCode, 0);
    assert.equal(t.succeeded, true);
    assert.equal(t.serviceInitiated, false);
  });

  it('classifies a nonzero exit as a failure but not service-initiated', () => {
    const t = classifyExit({ code: 3, signal: null });
    assert.equal(t.reason, TerminationReason.EXITED);
    assert.equal(t.exitCode, 3);
    assert.equal(t.succeeded, false);
    assert.equal(t.serviceInitiated, false);
  });
});

describe('classifyExit - a signal is never success', () => {
  it('classifies a signal death as signaled with a null exit code', () => {
    // Node reports code=null when a process dies from a signal. The old
    // expression `(exitCode || 0)` turned this into 0.
    const t = classifyExit({ code: null, signal: 'SIGSEGV' });
    assert.equal(t.reason, TerminationReason.SIGNALED);
    assert.equal(t.exitCode, null);
    assert.equal(t.signal, 'SIGSEGV');
    assert.equal(t.succeeded, false);
  });

  it('treats an OOM kill as a failure', () => {
    const t = classifyExit({ code: null, signal: 'SIGKILL' });
    assert.equal(t.succeeded, false);
    assert.equal(toLegacyExitCode(t), LEGACY_TERMINATED_EXIT_CODE);
  });

  it('does not report success when neither a code nor a signal is available', () => {
    const t = classifyExit({ code: null, signal: null });
    assert.equal(t.reason, TerminationReason.INFRASTRUCTURE_ERROR);
    assert.equal(t.succeeded, false);
    assert.equal(toLegacyExitCode(t), LEGACY_TERMINATED_EXIT_CODE);
  });

  it('does not report success for a non-numeric code', () => {
    const t = classifyExit({ code: undefined, signal: null });
    assert.equal(t.succeeded, false);
  });
});

describe('classifyExit - a service-initiated stop wins over the OS view', () => {
  it('reports the output cap, not the SIGKILL we sent to enforce it', () => {
    // Blueprint V-20: this is the case that reported exit 0 because `killed` was
    // set only by the wall-clock timer.
    const t = classifyExit({
      code: null,
      signal: 'SIGKILL',
      serviceReason: TerminationReason.OUTPUT_LIMIT,
    });
    assert.equal(t.reason, TerminationReason.OUTPUT_LIMIT);
    assert.equal(t.succeeded, false);
    assert.equal(t.serviceInitiated, true);
    assert.equal(toLegacyExitCode(t), LEGACY_TERMINATED_EXIT_CODE);
  });

  it('never reports success even when the program exited 0 as we stopped it', () => {
    // A program can exit cleanly microseconds after we decide to kill it. The
    // decision stands, because output was already truncated.
    const t = classifyExit({
      code: 0,
      signal: null,
      serviceReason: TerminationReason.OUTPUT_LIMIT,
    });
    assert.equal(t.succeeded, false);
    assert.equal(toLegacyExitCode(t), LEGACY_TERMINATED_EXIT_CODE);
  });

  it('preserves the raw code and signal for diagnosis', () => {
    const t = classifyExit({ code: 7, signal: 'SIGTERM', serviceReason: TerminationReason.TIMEOUT });
    assert.equal(t.exitCode, 7);
    assert.equal(t.signal, 'SIGTERM');
  });

  it('marks a cancellation as service-initiated', () => {
    const t = classifyExit({ code: null, signal: 'SIGKILL', serviceReason: TerminationReason.CANCELLED });
    assert.equal(t.serviceInitiated, true);
  });

  it('does not mark a compile error as service-initiated', () => {
    // Nothing was killed; the program never ran.
    const t = classifyExit({ code: 1, signal: null, serviceReason: TerminationReason.COMPILE_ERROR });
    assert.equal(t.serviceInitiated, false);
    assert.equal(t.succeeded, false);
  });
});

describe('toLegacyExitCode - frozen v1 mapping', () => {
  it('passes a normal exit status through unchanged', () => {
    assert.equal(toLegacyExitCode(classifyExit({ code: 0, signal: null })), 0);
    assert.equal(toLegacyExitCode(classifyExit({ code: 42, signal: null })), 42);
  });

  it('reports -1 for everything the service terminated', () => {
    for (const reason of [
      TerminationReason.TIMEOUT,
      TerminationReason.IDLE_TIMEOUT,
      TerminationReason.LIFETIME_LIMIT,
      TerminationReason.OUTPUT_LIMIT,
      TerminationReason.CANCELLED,
      TerminationReason.STARTUP_ERROR,
    ]) {
      const t = classifyExit({ code: null, signal: 'SIGKILL', serviceReason: reason });
      assert.equal(toLegacyExitCode(t), -1, `${reason} should map to -1`);
    }
  });

  it('never returns 0 for anything other than a real clean exit', () => {
    const notClean = [
      classifyExit({ code: null, signal: 'SIGKILL' }),
      classifyExit({ code: null, signal: null }),
      classifyExit({ code: 0, signal: null, serviceReason: TerminationReason.OUTPUT_LIMIT }),
    ];
    for (const t of notClean) {
      assert.notEqual(toLegacyExitCode(t), 0);
    }
  });
});

describe('toLegacyNote - frozen interactive vocabulary', () => {
  it('maps reasons onto the three note values the console UI understands', () => {
    const note = reason =>
      toLegacyNote(classifyExit({ code: null, signal: 'SIGKILL', serviceReason: reason }));

    assert.equal(note(TerminationReason.IDLE_TIMEOUT), 'idle-timeout');
    assert.equal(note(TerminationReason.OUTPUT_LIMIT), 'output-limit');
    assert.equal(note(TerminationReason.LIFETIME_LIMIT), 'time-limit');
    assert.equal(note(TerminationReason.TIMEOUT), 'time-limit');
  });

  it('returns null for an ordinary exit', () => {
    assert.equal(toLegacyNote(classifyExit({ code: 0, signal: null })), null);
    assert.equal(toLegacyNote(classifyExit({ code: 1, signal: null })), null);
  });

  it('returns null rather than inventing a note for a signal death', () => {
    // The v1 vocabulary has no value for this, and inventing one would reach a
    // console UI that does not recognise it.
    assert.equal(toLegacyNote(classifyExit({ code: null, signal: 'SIGSEGV' })), null);
  });
});

describe('describeTermination', () => {
  it('describes every reason without falling through to the unknown branch', () => {
    for (const reason of Object.values(TerminationReason)) {
      const t = classifyExit({ code: 1, signal: 'SIGKILL', serviceReason: reason });
      const text = describeTermination(t);
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 0);
      assert.doesNotMatch(text, /unknown reason/, `${reason} has no description`);
    }
  });

  it('distinguishes a clean exit from a failing one', () => {
    assert.match(describeTermination(classifyExit({ code: 0, signal: null })), /successfully/);
    assert.match(describeTermination(classifyExit({ code: 2, signal: null })), /code 2/);
  });

  it('names the signal', () => {
    assert.match(
      describeTermination(classifyExit({ code: null, signal: 'SIGSEGV' })),
      /SIGSEGV/,
    );
  });
});
