/**
 * Debug session state.
 *
 * The reason this is a separate, pure module is that a debugger has a handful of
 * states and a lot of controls that must agree about them - four stepping buttons,
 * the shared Stop control, the glyph margin, the current-line highlight, two panels.
 * Deriving all of it from one
 * place is what stops "Continue" being clickable while nothing is paused.
 *
 * So these tests are mostly about the derivation and about the transitions that are
 * easy to get subtly wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DebugSessionState, capabilitiesFor, isSessionLive } from '../../src/features/debug/state.ts';

describe('what the toolbar may offer', () => {
  test('nothing but Start when idle', () => {
    const can = capabilitiesFor('idle');
    assert.equal(can.canStart, true);
    assert.equal(can.canContinue, false);
    assert.equal(can.canStepOver, false);
    assert.equal(can.canStop, false);
  });

  test('stepping only while paused', () => {
    for (const status of ['starting', 'running', 'ended', 'idle'] as const) {
      const can = capabilitiesFor(status);
      assert.equal(can.canStepOver, false, status);
      assert.equal(can.canStepIn, false, status);
      assert.equal(can.canStepOut, false, status);
      assert.equal(can.canContinue, false, status);
    }

    const paused = capabilitiesFor('paused');
    assert.equal(paused.canStepOver, true);
    assert.equal(paused.canStepIn, true);
    assert.equal(paused.canStepOut, true);
    assert.equal(paused.canContinue, true);
  });

  test('Stop works while RUNNING, not only while paused', () => {
    // A program stuck in a loop is exactly when a student reaches for Stop. Offering
    // it only while paused would make the button useless in the one case it matters.
    assert.equal(capabilitiesFor('running').canStop, true);
    assert.equal(capabilitiesFor('starting').canStop, true);
    assert.equal(capabilitiesFor('paused').canStop, true);
    assert.equal(capabilitiesFor('ended').canStop, false);
    assert.equal(capabilitiesFor('idle').canStop, false);
  });

  test('Start is offered again after a session ends', () => {
    assert.equal(capabilitiesFor('ended').canStart, true);
  });
});

describe('whether the debugger is on screen at all', () => {
  test('a finished run is OFF, exactly like never having run', () => {
    // The bug this answers: `ended` used to count as on, so a run that was over kept
    // its toolbar, its current-line highlight and its "step 1 of 6" sentence until the
    // page was reloaded. A marker that outlives the program says "still paused" about
    // a program that is not there.
    assert.equal(isSessionLive('ended'), false);
    assert.equal(isSessionLive('idle'), false);
  });

  test('everything a student can still act on is ON', () => {
    for (const status of ['starting', 'running', 'paused', 'postMortem'] as const) {
      assert.equal(isSessionLive(status), true, status);
    }
  });

  test('post-mortem stays on screen, because the error is the thing to read', () => {
    // The program has stopped, but the frame is still there and the variables with it.
    // Only `terminated` ends that.
    assert.equal(isSessionLive('postMortem'), true);
  });
});

describe('breakpoints', () => {
  /** A state with a document open, which is the only way a breakpoint can exist. */
  const inDocument = (id = 'a') => {
    const state = new DebugSessionState();
    state.setDocument(id);
    return state;
  };

  test('toggle on and off', () => {
    const state = inDocument();
    assert.equal(state.toggleBreakpoint(5), true);
    assert.equal(state.hasBreakpoint(5), true);
    assert.equal(state.toggleBreakpoint(5), false);
    assert.equal(state.hasBreakpoint(5), false);
  });

  test('a breakpoint with no document open is refused', () => {
    // It would belong to nothing: there is no file to arm it in and no margin to draw
    // it on. Previously it was accepted into a single set and silently attributed to
    // whichever file was debugged next.
    const state = new DebugSessionState();
    assert.equal(state.toggleBreakpoint(5), false);
    assert.deepEqual(state.breakpointLines(), []);
  });

  test('lines are reported ascending', () => {
    const state = inDocument();
    for (const line of [9, 2, 7, 1]) state.toggleBreakpoint(line);
    assert.deepEqual(state.breakpointLines(), [1, 2, 7, 9]);
  });

  test('a non-line is refused', () => {
    const state = inDocument();
    for (const line of [0, -3, 1.5, NaN]) {
      assert.equal(state.toggleBreakpoint(line), false, String(line));
    }
    assert.deepEqual(state.breakpointLines(), []);
  });

  test('switching document KEEPS the other file\'s breakpoints', () => {
    // This test used to assert the opposite, and the reason was a limitation rather
    // than a decision: there was one breakpoint set, so following the student to
    // another file would have shown marks against lines they never chose. Each
    // document has its own set now, which is what makes a breakpoint in an imported
    // module possible at all.
    const state = inDocument('a');
    state.toggleBreakpoint(3);
    state.toggleBreakpoint(8);

    state.setDocument('b');
    assert.deepEqual(state.breakpointLines(), [], 'file b has none of its own');

    state.setDocument('a');
    assert.deepEqual(state.breakpointLines(), [3, 8], 'file a lost its breakpoints');
  });

  test('each file keeps its own, and all of them are sent', () => {
    const state = inDocument('a');
    state.toggleBreakpoint(3);
    state.setDocument('b');
    state.toggleBreakpoint(11);

    const all = state.allBreakpoints();
    assert.deepEqual(all.get('a'), [3]);
    assert.deepEqual(all.get('b'), [11]);
    assert.equal(all.size, 2);
  });

  test('a file with none is not sent at all', () => {
    // The payload stays proportional to what the student set, rather than listing
    // every file they have ever opened.
    const state = inDocument('a');
    state.toggleBreakpoint(3);
    state.setDocument('b');
    state.toggleBreakpoint(1);
    state.toggleBreakpoint(1);

    assert.deepEqual([...state.allBreakpoints().keys()], ['a']);
  });

  test('re-selecting the same document keeps them', () => {
    const state = inDocument('a');
    state.toggleBreakpoint(3);
    state.setDocument('a');
    assert.deepEqual(state.breakpointLines(), [3]);
  });

  test('clearing removes them from every file, not just the open one', () => {
    const state = inDocument('a');
    state.toggleBreakpoint(3);
    state.setDocument('b');
    state.toggleBreakpoint(4);

    state.clearBreakpoints();
    assert.equal(state.allBreakpoints().size, 0);
  });

  test('they survive a finished session, because a student runs again', () => {
    const state = inDocument('a');
    state.toggleBreakpoint(4);
    state.starting();
    state.apply({ type: 'attached' });
    state.finished();
    assert.deepEqual(state.breakpointLines(), [4], 'breakpoints were lost between runs');
  });

  test('the adapter has the final say on which lines armed', () => {
    // It refuses a blank line or a comment. The margin must show what is real, not
    // what was asked for.
    const state = inDocument('a');
    state.toggleBreakpoint(2);
    state.toggleBreakpoint(3);
    state.apply({ type: 'breakpoints', lines: [3] });
    assert.deepEqual(state.breakpointLines(), [3]);
  });

  test('a per-file answer is matched back to the right file', () => {
    // The adapter reports PATHS; the state holds document ids. Without the resolver
    // the answer cannot be attributed at all, and the margin would keep showing what
    // was requested rather than what was armed.
    const state = inDocument('doc-main');
    state.resolvePathsWith(path => (path === 'lib/util.py' ? 'doc-util' : 'doc-main'));
    state.toggleBreakpoint(2);
    state.setDocument('doc-util');
    state.toggleBreakpoint(5);
    state.toggleBreakpoint(6);

    state.apply({ type: 'breakpoints', files: { 'main.py': [2], 'lib/util.py': [5] } });

    assert.deepEqual(state.breakpointLines(), [5], 'line 6 was refused and should be gone');
    state.setDocument('doc-main');
    assert.deepEqual(state.breakpointLines(), [2]);
  });

  test('an answer for a file that is no longer open is ignored, not crashed on', () => {
    const state = inDocument('a');
    state.resolvePathsWith(() => null);
    state.toggleBreakpoint(1);

    assert.doesNotThrow(() => state.apply({ type: 'breakpoints', files: { 'gone.py': [9] } }));
  });
});

describe('the lifecycle', () => {
  const session = () => {
    const state = new DebugSessionState();
    state.setDocument('main');
    return state;
  };

  test('idle to running to paused to ended', () => {
    const state = session();
    assert.equal(state.snapshot().status, 'idle');

    state.starting();
    assert.equal(state.snapshot().status, 'starting');

    state.apply({ type: 'attached', pid: 1 });
    assert.equal(state.snapshot().status, 'running');

    state.apply({ type: 'stopped', line: 4, file: 'main.py', locals: [], globals: [], stack: [] });
    assert.equal(state.snapshot().status, 'paused');

    state.apply({ type: 'terminated', exitCode: 0 });
    assert.equal(state.snapshot().status, 'ended');
  });

  test('a session remembers which single workspace document the adapter renamed', () => {
    const state = session();
    state.starting({ documentId: 'main-2-document', singleFile: true });

    assert.deepEqual(state.snapshot().execution, {
      documentId: 'main-2-document',
      singleFile: true,
    });

    state.reset();
    assert.equal(state.snapshot().execution, null);
  });

  test('a stop carries its variables and stack', () => {
    const state = session();
    state.starting();
    state.apply({
      type: 'stopped',
      line: 7,
      file: 'main.py',
      reason: 'step',
      stack: [{ name: 'add', file: 'main.py', line: 7 }, { name: '(module)', file: 'main.py', line: 2 }],
      locals: [{ name: 'total', value: { text: '42', type: 'int' } }],
      globals: [{ name: 'items', value: { text: 'list(3 items)', type: 'list', length: 3 } }],
    });

    const stop = state.snapshot().stop!;
    assert.equal(stop.line, 7);
    assert.equal(stop.stack.length, 2);
    assert.equal(stop.stack[0].name, 'add');
    assert.equal(stop.locals[0].value.text, '42');
    assert.equal(stop.globals[0].value.length, 3);
  });

  test('post-mortem is its own status, not just paused', () => {
    // The difference is visible in the toolbar: stepping a finished program cannot do
    // anything, and offering it would be a button that silently fails.
    const state = session();
    state.starting();
    state.apply({
      type: 'stopped',
      line: 2,
      file: 'main.py',
      reason: 'exception',
      postMortem: true,
      exception: { type: 'ZeroDivisionError', message: 'division by zero' },
      stack: [],
      locals: [],
      globals: [],
    });

    assert.equal(state.snapshot().status, 'postMortem');
    assert.equal(state.snapshot().stop?.exception?.type, 'ZeroDivisionError');
    assert.equal(state.capabilities().canStepOver, false);
  });

  test('a stray `started` after a pause does not un-pause', () => {
    // Moving back to running would grey out the step buttons while the program is
    // sitting at a breakpoint.
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 1, file: 'main.py', stack: [], locals: [], globals: [] });
    state.apply({ type: 'started' });
    assert.equal(state.snapshot().status, 'paused');
  });

    test('a local resume clears the old stop while the next pause is pending', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 3, file: 'main.py', stack: [], locals: [], globals: [] });

    state.resuming();

    assert.equal(state.snapshot().status, 'running');
    assert.equal(state.snapshot().stop, null);
    assert.equal(state.capabilities().canStepOver, false);
    assert.equal(state.capabilities().canStop, true);
  });

  test('terminated clears the stop, so no stale current-line arrow remains', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 5, file: 'main.py', stack: [], locals: [], globals: [] });
    state.apply({ type: 'terminated', exitCode: 0 });
      assert.equal(state.snapshot().stop, null);
    });

    test('a failed resume restores the pause instead of stranding the toolbar', () => {
      const state = new DebugSessionState();
      state.starting();
      state.apply({ type: 'stopped', file: 'main.py', line: 8, locals: [] });

      state.resuming();
      state.resumeFailed();

      assert.equal(state.snapshot().status, 'paused');
      assert.equal(state.snapshot().stop?.line, 8);
      assert.equal(state.capabilities().canStepOver, true);
    });

    test('a late failed response cannot replace a newer pause', () => {
      const state = new DebugSessionState();
      state.starting();
      state.apply({ type: 'stopped', file: 'main.py', line: 8, locals: [] });
      state.resuming();
      state.apply({ type: 'stopped', file: 'main.py', line: 9, locals: [] });

      state.resumeFailed();

      assert.equal(state.snapshot().stop?.line, 9);
    });

  test('an unsupported language records the message without ending the run', () => {
    // The program still runs, just without a debugger - so calling it ended would
    // grey out Stop while it was still going.
    const state = session();
    state.starting();
    state.apply({ type: 'unsupported', message: 'java cannot be debugged yet.' });
    assert.match(state.snapshot().lastError ?? '', /java cannot be debugged/);
    assert.notEqual(state.snapshot().status, 'ended');
  });

  test('an unknown frame type is ignored rather than breaking the session', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'attached' });
    state.apply({ type: 'somethingFromANewerServer', data: 1 });
    assert.equal(state.snapshot().status, 'running');
  });

  test('reset returns to idle', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 1, file: 'main.py', stack: [], locals: [], globals: [] });
    state.reset();
    assert.equal(state.snapshot().status, 'idle');
    assert.equal(state.snapshot().stop, null);
  });

  test('reset is idempotent, so every exit path may call it', () => {
    // Stop, the adapter's `terminated`, the stream settling and the `finally` all tear
    // the session down without checking whether another of them got there first. A
    // second call must be free rather than another render of the whole surface.
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 1, file: 'main.py', stack: [], locals: [], globals: [] });

    let notifications = 0;
    state.subscribe(() => { notifications += 1; });
    const afterSubscribe = notifications;

    state.reset();
    const afterFirst = notifications;
    assert.equal(afterFirst, afterSubscribe + 1);

    state.reset();
    state.reset();
    assert.equal(notifications, afterFirst, 'a reset with nothing to clear still notified');
  });

  test('reset clears the error, so a dead session cannot keep re-posting it', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'error', message: 'The debugger could not attach.' });
    assert.equal(state.snapshot().lastError, 'The debugger could not attach.');

    state.reset();
    assert.equal(state.snapshot().lastError, null);
  });

  test('reset keeps the breakpoints, because the student put them there', () => {
    // The whole point of ending a session rather than clearing everything: a student
    // fixes something and runs again, and re-placing every mark would cost more than
    // the second run itself.
    const state = session();
    state.toggleBreakpoint(3);
    state.setBreakpointCondition(5, 'i == 2');
    state.setLogpoint(7, 'total');
    state.starting();
    state.reset();

    assert.deepEqual(state.breakpointLines(), [3, 5]);
    assert.deepEqual(state.conditionedLines(), [5]);
    assert.deepEqual(state.logpointLines(), [7]);
  });

  test('the adapter saying `terminated` is the same transition as finishing locally', () => {
    // Two words for one event - the stream's own frame and the run path's call - so
    // they must not be able to drift into two different amounts of teardown.
    const viaAdapter = session();
    viaAdapter.starting();
    viaAdapter.apply({ type: 'stopped', line: 4, file: 'main.py', stack: [], locals: [], globals: [] });
    viaAdapter.apply({ type: 'terminated', exitCode: 0 });

    const viaCaller = session();
    viaCaller.starting();
    viaCaller.apply({ type: 'stopped', line: 4, file: 'main.py', stack: [], locals: [], globals: [] });
    viaCaller.finished();

    assert.equal(viaAdapter.snapshot().status, viaCaller.snapshot().status);
    assert.equal(viaAdapter.snapshot().stop, viaCaller.snapshot().stop);
    assert.equal(isSessionLive(viaAdapter.snapshot().status), false);
  });
});

describe('subscribers', () => {
  test('a subscriber is called immediately with the current snapshot', () => {
    const state = new DebugSessionState();
    let seen: { status: string } | null = null;
    state.subscribe(snapshot => { seen = snapshot; });
    assert.equal((seen as unknown as { status: string } | null)?.status, 'idle');
  });

  test('every change notifies', () => {
    const state = new DebugSessionState();
    let count = 0;
    state.subscribe(() => { count += 1; });
    const initial = count;

    state.setDocument('a');
    state.toggleBreakpoint(1);
    state.starting();
    state.apply({ type: 'attached' });

    assert.ok(count > initial + 3, `only ${count - initial} notifications`);
  });

  test('unsubscribing stops the notifications', () => {
    const state = new DebugSessionState();
    let count = 0;
    const unsubscribe = state.subscribe(() => { count += 1; });
    const afterSubscribe = count;
    unsubscribe();
    state.starting();
    assert.equal(count, afterSubscribe);
  });

  test('a no-op change does not notify', () => {
    // Re-selecting the same document would otherwise clear breakpoints and re-render
    // on every tab click.
    const state = new DebugSessionState();
    state.setDocument('a');
    let count = 0;
    state.subscribe(() => { count += 1; });
    const baseline = count;
    state.setDocument('a');
    assert.equal(count, baseline);
  });
});

describe('breakpoint conditions', () => {
  test('a condition is attached to a line and read back', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.toggleBreakpoint(4);

    assert.equal(state.setBreakpointCondition(4, 'i == 5'), true);
    assert.equal(state.breakpointCondition(4), 'i == 5');
    assert.deepEqual(state.conditionedLines(), [4]);
  });

  test('setting a condition on a bare line also sets the breakpoint', () => {
    // A student who says "stop when i == 5" has said everything needed. Requiring
    // them to place a mark first is a rule with no purpose.
    const state = new DebugSessionState();
    state.setDocument('doc-1');

    state.setBreakpointCondition(9, 'total > 3');
    assert.equal(state.hasBreakpoint(9), true);
    assert.deepEqual(state.breakpointLines(), [9]);
  });

  test('an empty condition removes it and leaves the breakpoint', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');

    state.setBreakpointCondition(4, '');
    assert.equal(state.breakpointCondition(4), null);
    assert.equal(state.hasBreakpoint(4), true, 'the breakpoint itself must survive');
  });

  test('whitespace is not a condition', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');

    state.setBreakpointCondition(4, '   ');
    assert.equal(state.breakpointCondition(4), null);
  });

  test('removing a breakpoint takes its condition with it', () => {
    /*
     * Otherwise a student who removes a mark and puts it back gets a condition they
     * cannot see and did not ask for a second time - and the only symptom is a
     * breakpoint that mysteriously does not stop.
     */
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');

    state.toggleBreakpoint(4);
    assert.equal(state.hasBreakpoint(4), false);
    state.toggleBreakpoint(4);
    assert.equal(state.hasBreakpoint(4), true);
    assert.equal(state.breakpointCondition(4), null);
  });

  test('conditions are per document, like breakpoints', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');

    state.setDocument('doc-2');
    assert.equal(state.breakpointCondition(4), null);
    assert.deepEqual(state.conditionedLines(), []);

    state.setDocument('doc-1');
    assert.equal(state.breakpointCondition(4), 'i == 5');
  });

  test('allConditions omits a condition whose breakpoint is gone', () => {
    // The adapter can only arm a condition on a breakpoint. Sending an orphan would
    // ask the server to hold state the student cannot see.
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');
    state.setBreakpointCondition(7, 'x');
    state.toggleBreakpoint(7);

    assert.deepEqual([...state.allConditions()], [['doc-1', { 4: 'i == 5' }]]);
  });

  test('a condition longer than the channel accepts is refused here', () => {
    // Refused where the student can see it and edit the text, rather than typed,
    // sent, and dropped by the server with nothing shown.
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    assert.equal(state.setBreakpointCondition(4, 'x'.repeat(2001)), false);
    assert.equal(state.breakpointCondition(4), null);
  });

  test('clearing breakpoints clears conditions too', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(4, 'i == 5');

    state.clearBreakpoints();
    assert.deepEqual([...state.allConditions()], []);
    assert.deepEqual(state.conditionedLines(), []);
  });

  test('the snapshot separates conditioned lines from plain ones', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.toggleBreakpoint(2);
    state.setBreakpointCondition(5, 'i == 1');

    const snapshot = state.snapshot();
    assert.deepEqual(snapshot.breakpoints, [2, 5]);
    assert.deepEqual(snapshot.conditionedBreakpoints, [5]);
  });
});

describe('log points', () => {
  test('store an expression per line without adding a stopping breakpoint', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');

    assert.equal(state.setLogpoint(7, 'total'), true);
    assert.equal(state.logpointExpression(7), 'total');
    assert.deepEqual(state.snapshot().logpointLines, [7]);
    assert.deepEqual(state.breakpointLines(), []);
  });

  test('a line has one meaning: log point and breakpoint replace each other', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setBreakpointCondition(7, 'i == 2');

    state.setLogpoint(7, 'i');
    assert.equal(state.hasBreakpoint(7), false);
    assert.equal(state.breakpointCondition(7), null);

    state.toggleBreakpoint(7);
    assert.equal(state.logpointExpression(7), null);
    assert.equal(state.hasBreakpoint(7), true);
  });

  test('they stay with their documents and can all be sent to the adapter', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setLogpoint(2, 'left');
    state.setDocument('doc-2');
    state.setLogpoint(9, 'right');

    assert.deepEqual([...state.allLogpoints()], [
      ['doc-1', { 2: 'left' }],
      ['doc-2', { 9: 'right' }],
    ]);
    assert.deepEqual(state.logpointLines(), [9]);
  });

  test('empty text removes one, and clearing breakpoints removes all', () => {
    const state = new DebugSessionState();
    state.setDocument('doc-1');
    state.setLogpoint(2, 'value');
    assert.equal(state.setLogpoint(2, '   '), true);
    assert.deepEqual(state.logpointLines(), []);

    state.setLogpoint(3, 'value');
    state.clearBreakpoints();
    assert.deepEqual([...state.allLogpoints()], []);
  });
});
