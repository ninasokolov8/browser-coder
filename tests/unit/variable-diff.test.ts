/**
 * "What changed since the last stop" - the debugger's teaching feature.
 *
 * The rules worth pinning are the ones about NOT highlighting: a diff that marks
 * everything is exactly as useless as one that marks nothing, and the moment a student
 * most needs to read carefully - stepping into a function - is the moment a naive diff
 * would light up every row at once.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeChange,
  diffVariables,
  frameKey,
  VariableHistory,
} from '../../src/features/debug/variable-diff.ts';
import type { DebugFrame, DebugVariable } from '../../src/features/debug/state.ts';

const v = (name: string, text: string, type = 'int'): DebugVariable => ({
  name,
  value: { text, type },
});

const frame = (name: string, file = 'main.py', line = 1): DebugFrame => ({ name, file, line });

describe('diffing one pause against the last', () => {
  test('a value that moved is marked, with what it was', () => {
    const diffed = diffVariables([v('side', '2')], [v('side', '3')]);
    assert.deepEqual(diffed, [
      { variable: v('side', '3'), change: 'changed', previousText: '2' },
    ]);
  });

  test('a value that did not move is left alone', () => {
    const diffed = diffVariables([v('total', '10')], [v('total', '10')]);
    assert.equal(diffed[0].change, 'same');
    assert.equal(diffed[0].previousText, undefined);
  });

  test('a variable that did not exist before is new, not changed', () => {
    // The distinction matters: "created" and "changed" are different events, and a
    // struck-through previous value would be a lie for a variable that had none.
    const diffed = diffVariables([v('a', '1')], [v('a', '1'), v('b', '5')]);
    assert.equal(diffed[1].change, 'new');
    assert.equal(diffed[1].previousText, undefined);
  });

  test('the FIRST stop marks nothing', () => {
    // Everything is new when the program first pauses, and marking all of it is noise
    // on the one stop where the student is orienting themselves.
    const diffed = diffVariables(null, [v('a', '1'), v('b', '2')]);
    assert.deepEqual(diffed.map(entry => entry.change), ['same', 'same']);
  });

  test('a list mutated in place counts as changed', () => {
    // Its repr moves when its contents do, and the repr is what the student sees.
    const before = [{ name: 'xs', value: { text: '[1, 2]', type: 'list' } }];
    const after = [{ name: 'xs', value: { text: '[1, 2, 3]', type: 'list' } }];
    assert.equal(diffVariables(before, after)[0].change, 'changed');
  });
});

describe('scope changes are not value changes', () => {
  test('stepping into a function marks nothing', () => {
    const history = new VariableHistory();
    history.record([frame('<module>')], [v('side', '1'), v('total', '9')]);

    // Different frame: every local is different because the SCOPE is, not because
    // anything the student did changed a value.
    const inside = history.record([frame('area')], [v('w', '3'), v('h', '4')]);
    assert.deepEqual(inside.map(entry => entry.change), ['same', 'same']);
  });

  test('stepping within one function does mark', () => {
    const history = new VariableHistory();
    history.record([frame('area')], [v('w', '3')]);
    const next = history.record([frame('area')], [v('w', '5')]);
    assert.equal(next[0].change, 'changed');
    assert.equal(next[0].previousText, '3');
  });

  test('returning to a frame does not diff against the call inside it', () => {
    const history = new VariableHistory();
    history.record([frame('<module>')], [v('n', '1')]);
    history.record([frame('helper')], [v('n', '99')]);

    // Back at module level. `n` is still 1 there - the helper's `n` was a different
    // variable entirely, and comparing them would report a change that never happened.
    const back = history.record([frame('<module>')], [v('n', '1')]);
    assert.equal(back[0].change, 'same');
  });

  test('the frame is name and file, never the line', () => {
    // Line 6 to line 7 of one function is precisely the case diffs exist for.
    assert.equal(frameKey([frame('area', 'main.py', 6)]), frameKey([frame('area', 'main.py', 7)]));
    assert.notEqual(frameKey([frame('area')]), frameKey([frame('other')]));
    assert.notEqual(frameKey([frame('area', 'a.py')]), frameKey([frame('area', 'b.py')]));
  });

  test('an empty stack does not throw', () => {
    assert.equal(frameKey([]), '');
    assert.deepEqual(new VariableHistory().record([], [v('a', '1')]), [
      { variable: v('a', '1'), change: 'same' },
    ]);
  });

  test('reset makes the next session start clean', () => {
    const history = new VariableHistory();
    history.record([frame('<module>')], [v('a', '1')]);
    history.reset();

    // A finished run's values belong to a different execution.
    const fresh = history.record([frame('<module>')], [v('a', '2')]);
    assert.equal(fresh[0].change, 'same');
  });
});

describe('saying it in words', () => {
  test('one value moved', () => {
    const diffed = diffVariables([v('side', '2')], [v('side', '3')]);
    assert.equal(describeChange(diffed), 'side went from 2 to 3');
  });

  test('one variable was created', () => {
    const diffed = diffVariables([v('a', '1')], [v('a', '1'), v('total', '0')]);
    assert.equal(describeChange(diffed), 'total was created, and is 0');
  });

  test('several changes are left to the list', () => {
    // Highlighting two rows is clearer than a sentence enumerating them.
    const diffed = diffVariables([v('a', '1'), v('b', '1')], [v('a', '2'), v('b', '2')]);
    assert.equal(describeChange(diffed), null);
  });

  test('nothing changed says nothing', () => {
    assert.equal(describeChange(diffVariables([v('a', '1')], [v('a', '1')])), null);
    assert.equal(describeChange(diffVariables(null, [v('a', '1')])), null);
  });
});
