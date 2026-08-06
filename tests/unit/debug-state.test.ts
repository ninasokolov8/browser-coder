/**
 * Debug session state.
 *
 * The reason this is a separate, pure module is that a debugger has a handful of
 * states and a lot of controls that must agree about them - five toolbar buttons, the
 * glyph margin, the current-line highlight, two panels. Deriving all of it from one
 * place is what stops "Continue" being clickable while nothing is paused.
 *
 * So these tests are mostly about the derivation and about the transitions that are
 * easy to get subtly wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DebugSessionState, capabilitiesFor } from '../../src/features/debug/state.ts';

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

  test('evaluation is allowed post-mortem', () => {
    // The frame is gone from the program's point of view, but the traceback keeps it
    // alive - which is the whole value of stopping where it broke.
    assert.equal(capabilitiesFor('postMortem').canEvaluate, true);
    assert.equal(capabilitiesFor('postMortem').canStepOver, false, 'stepping a finished program');
    assert.equal(capabilitiesFor('running').canEvaluate, false);
  });

  test('Start is offered again after a session ends', () => {
    assert.equal(capabilitiesFor('ended').canStart, true);
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
    assert.equal(state.capabilities().canEvaluate, true);
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

  test('terminated clears the stop, so no stale current-line arrow remains', () => {
    const state = session();
    state.starting();
    state.apply({ type: 'stopped', line: 5, file: 'main.py', stack: [], locals: [], globals: [] });
    state.apply({ type: 'terminated', exitCode: 0 });
    assert.equal(state.snapshot().stop, null);
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
});

describe('evaluation results', () => {
  test('a value is recorded', () => {
    const state = new DebugSessionState();
    state.apply({ type: 'evaluated', expression: 'x * 2', value: { text: '84', type: 'int' } });
    assert.deepEqual(state.snapshot().evaluated, { expression: 'x * 2', text: '84', error: null });
  });

  test('an error is recorded rather than discarded', () => {
    // A failed expression is information - usually a typo - and hiding it would leave
    // the student wondering whether the debugger even received it.
    const state = new DebugSessionState();
    state.apply({ type: 'evaluated', expression: 'nope', error: "NameError: name 'nope' is not defined" });
    assert.match(state.snapshot().evaluated?.error ?? '', /NameError/);
    assert.equal(state.snapshot().evaluated?.text, null);
  });

  test('starting a new session clears the previous result', () => {
    const state = new DebugSessionState();
    state.apply({ type: 'evaluated', expression: 'x', value: { text: '1', type: 'int' } });
    state.starting();
    assert.equal(state.snapshot().evaluated, null);
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

describe('watch expressions', () => {
  const paused = () => {
    const state = new DebugSessionState();
    state.setDocument('main');
    state.starting();
    state.apply({ type: 'attached' });
    state.apply({
      type: 'stopped', line: 4, file: 'main.py', locals: [], globals: [], stack: [],
    });
    return state;
  };

  test('an expression can be watched', () => {
    const state = paused();
    assert.equal(state.addWatch('total'), true);
    assert.deepEqual(state.snapshot().watches, ['total']);
  });

  test('a blank one is refused, so the list cannot fill with empty rows', () => {
    const state = paused();
    assert.equal(state.addWatch('   '), false);
    assert.deepEqual(state.snapshot().watches, []);
  });

  test('a duplicate is refused, because it would be evaluated twice per stop', () => {
    const state = paused();
    state.addWatch('total');
    assert.equal(state.addWatch('total'), false);
    assert.equal(state.snapshot().watches.length, 1);
  });

  test('one longer than the channel accepts is refused here, not silently dropped', () => {
    // buildDebugCommand caps an expression at 2000 characters. Without this the
    // student would type it, see nothing happen, and have no idea why.
    const state = paused();
    assert.equal(state.addWatch('x'.repeat(2001)), false);
    assert.equal(state.addWatch('x'.repeat(2000)), true);
  });

  test('a result lands against its expression', () => {
    const state = paused();
    state.addWatch('total');
    state.apply({ type: 'evaluated', expression: 'total', value: { text: '42' } });

    assert.equal(state.snapshot().watchValues.get('total')?.text, '42');
  });

  test('an error is kept as an error, not as a value', () => {
    const state = paused();
    state.addWatch('nope');
    state.apply({ type: 'evaluated', expression: 'nope', error: "name 'nope' is not defined" });

    const result = state.snapshot().watchValues.get('nope');
    assert.equal(result?.text, null);
    assert.match(result?.error ?? '', /not defined/);
  });

  test('an ad-hoc evaluation does not add a row nobody asked for', () => {
    const state = paused();
    state.apply({ type: 'evaluated', expression: 'something', value: { text: '1' } });

    assert.deepEqual(state.snapshot().watches, []);
    assert.equal(state.snapshot().watchValues.size, 0);
  });

  test('values are cleared on the next stop, because a stale one looks current', () => {
    // The most misleading thing a debugger can show: last line's value, presented as
    // this line's.
    const state = paused();
    state.addWatch('total');
    state.apply({ type: 'evaluated', expression: 'total', value: { text: '42' } });
    assert.equal(state.snapshot().watchValues.get('total')?.text, '42');

    state.apply({
      type: 'stopped', line: 5, file: 'main.py', locals: [], globals: [], stack: [],
    });

    assert.equal(state.snapshot().watchValues.has('total'), false);
    assert.deepEqual(state.snapshot().watches, ['total'], 'the watch itself was lost');
  });

  test('removing one drops its value too', () => {
    const state = paused();
    state.addWatch('total');
    state.apply({ type: 'evaluated', expression: 'total', value: { text: '42' } });

    state.removeWatch('total');

    assert.deepEqual(state.snapshot().watches, []);
    assert.equal(state.snapshot().watchValues.has('total'), false);
  });

  test('removing one that is not there is harmless', () => {
    const state = paused();
    state.addWatch('a');
    state.removeWatch('b');
    assert.deepEqual(state.snapshot().watches, ['a']);
  });

  test('watches survive the session ending, because a student runs again', () => {
    const state = paused();
    state.addWatch('total');
    state.apply({ type: 'terminated', exitCode: 0 });

    assert.deepEqual(state.snapshot().watches, ['total']);
  });

  test('the snapshot is a copy, so a caller cannot mutate the list', () => {
    const state = paused();
    state.addWatch('total');
    (state.snapshot().watches as string[]).push('injected');

    assert.deepEqual(state.snapshot().watches, ['total']);
  });
});
