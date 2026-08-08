/**
 * Stepping backwards through a program's recorded pauses.
 *
 * The rules that matter are about not lying. Looking at the past must never be confused
 * with the program having moved there, a new pause must never be hidden behind an old
 * view, and the history of a finished run must never be shown against the next one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { historyValueLabel, StopHistory } from '../../src/features/debug/history.ts';
import type { DebugStop, DebugVariable } from '../../src/features/debug/state.ts';

const v = (name: string, text: string): DebugVariable => ({ name, value: { text, type: 'int' } });

/** A pause on `line`, with the given locals. */
const stopAt = (line: number, ...locals: DebugVariable[]): DebugStop => ({
  reason: 'step',
  file: 'main.py',
  line,
  stack: [{ name: '<module>', file: 'main.py', line }],
  locals,
  globals: [],
});

function recorded(...stops: DebugStop[]): StopHistory {
  const history = new StopHistory();
  for (const stop of stops) history.record(stop);
  return history;
}

describe('an empty history', () => {
  test('shows nothing and refuses to move', () => {
    const history = new StopHistory();
    const view = history.view();

    assert.equal(view.stop, null);
    assert.equal(view.total, 0);
    assert.equal(view.index, -1);
    assert.equal(view.canGoBack, false);
    assert.equal(view.canGoForward, false);
    assert.equal(history.back(), false);
    assert.equal(history.forward(), false);
  });
});

describe('moving through it', () => {
  test('the newest stop is shown by default', () => {
    const view = recorded(stopAt(1), stopAt(2), stopAt(3)).view();
    assert.equal(view.stop?.line, 3);
    assert.equal(view.viewingPast, false);
    assert.equal(view.canGoForward, false);
  });

  test('back walks towards the beginning and stops there', () => {
    const history = recorded(stopAt(1), stopAt(2), stopAt(3));

    assert.equal(history.back(), true);
    assert.equal(history.view().stop?.line, 2);
    assert.equal(history.view().viewingPast, true);

    assert.equal(history.back(), true);
    assert.equal(history.view().stop?.line, 1);

    // The first stop is the beginning. There is nothing before it.
    assert.equal(history.back(), false);
    assert.equal(history.view().stop?.line, 1);
  });

  test('forward walks back to the present', () => {
    const history = recorded(stopAt(1), stopAt(2), stopAt(3));
    history.back();
    history.back();

    history.forward();
    assert.equal(history.view().stop?.line, 2);

    history.forward();
    assert.equal(history.view().stop?.line, 3);
    assert.equal(history.view().viewingPast, false, 'arriving at the newest is being live again');
    assert.equal(history.forward(), false);
  });

  test('goTo jumps straight to a moment, which is what clicking the tape does', () => {
    const history = recorded(stopAt(10), stopAt(20), stopAt(30), stopAt(40));

    assert.equal(history.goTo(1), true);
    assert.equal(history.view().stop?.line, 20);
    assert.equal(history.view().index, 1);

    assert.equal(history.goTo(99), false, 'out of range refuses rather than clamping');
    assert.equal(history.view().stop?.line, 20, 'and changes nothing');
  });

  test('toLive returns to the present from anywhere', () => {
    const history = recorded(stopAt(1), stopAt(2), stopAt(3));
    history.back();
    history.back();
    history.toLive();

    assert.equal(history.view().stop?.line, 3);
    assert.equal(history.view().viewingPast, false);
  });
});

describe('a new pause while looking back', () => {
  test('snaps the view to the present', () => {
    /*
     * The alternative would leave the editor highlighting an old line while the program
     * is somewhere else entirely - the debugger showing one thing and meaning another,
     * which is worse than not having the feature.
     */
    const history = recorded(stopAt(1), stopAt(2), stopAt(3));
    history.back();
    history.back();
    assert.equal(history.view().viewingPast, true);

    history.record(stopAt(4));

    assert.equal(history.view().stop?.line, 4);
    assert.equal(history.view().viewingPast, false);
  });

  test('and arriving at the newest by walking forward stays live afterwards', () => {
    // If `forward` pinned the last index instead of returning to live, the NEXT stop
    // would be recorded and never shown.
    const history = recorded(stopAt(1), stopAt(2));
    history.back();
    history.forward();

    history.record(stopAt(3));
    assert.equal(history.view().stop?.line, 3);
  });
});

describe('the variable tape', () => {
  test('every value one name has held, in order', () => {
    const history = recorded(
      stopAt(1, v('side', '0')),
      stopAt(2, v('side', '1')),
      stopAt(3, v('side', '2')),
    );

    assert.deepEqual(
      history.tape('side').map(cell => cell.text),
      ['0', '1', '2'],
    );
  });

  test('a variable that did not exist yet is null, not missing', () => {
    // The tape's positions have to line up with the history's, or clicking a cell
    // would jump to the wrong moment.
    const history = recorded(
      stopAt(1),
      stopAt(2, v('total', '5')),
      stopAt(3, v('total', '9')),
    );

    const tape = history.tape('total');
    assert.equal(tape.length, 3);
    assert.deepEqual(tape.map(cell => cell.text), [null, '5', '9']);
    assert.deepEqual(tape.map(cell => cell.index), [0, 1, 2]);
  });

  test('an unknown name gives an all-null tape rather than throwing', () => {
    const history = recorded(stopAt(1, v('a', '1')));
    assert.deepEqual(history.tape('nope').map(cell => cell.text), [null]);
  });

  test('tracked names are everything that was ever a local', () => {
    const history = recorded(stopAt(1, v('a', '1')), stopAt(2, v('a', '1'), v('b', '2')));
    assert.deepEqual(history.trackedNames().sort(), ['a', 'b']);
  });
});

describe('labels for values in the tape', () => {
  test('turns a Python object address into a useful class label', () => {
    assert.equal(
      historyValueLabel('<bc_turtle.<locals>._Turtle object at 0x7f116858ee10>', '_Turtle'),
      'Turtle object',
    );
  });

  test('truncates a long collection without losing the full stored value', () => {
    assert.equal(historyValueLabel('[1, 2, 3, 4, 5, 6]', 'list', 12), '[1, 2, 3, 4…');
  });
});

describe('bounds and lifecycle', () => {
  test('the history is capped, and it is the OLDEST that go', () => {
    // A loop can pause thousands of times and each entry holds every local. Dropping
    // the newest would break the feature exactly where it is used.
    const history = new StopHistory();
    for (let line = 1; line <= 600; line++) history.record(stopAt(line));

    const view = history.view();
    assert.equal(view.total, 500);
    assert.equal(view.stop?.line, 600, 'the newest is still there');

    history.goTo(0);
    assert.equal(history.view().stop?.line, 101, 'and the oldest 100 are gone');
  });

  test('reset clears it, so one run is never shown against the next', () => {
    const history = recorded(stopAt(1), stopAt(2));
    history.back();
    history.reset();

    const view = history.view();
    assert.equal(view.total, 0);
    assert.equal(view.stop, null);
    assert.equal(view.viewingPast, false);
  });
});
