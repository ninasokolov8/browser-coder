/**
 * The debugger's controls: what they are called, and what the toolbar says.
 *
 * The wording is the feature. A professional editor shows five bare glyphs because a
 * professional already knows that an arrow arcing over a dot means "step over"; a
 * fifteen-year-old sees five identical marks. So the labels and the status sentence are
 * asserted here rather than left as strings nobody checks - if one of them drifts back
 * towards the machine's own vocabulary, this fails.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { debugActions, describeStatus } from '../../src/features/debug/toolbar.ts';
import type { DebugSnapshot } from '../../src/features/debug/state.ts';

const ALL_ALLOWED = {
  canContinue: true,
  canStepOver: true,
  canStepIn: true,
  canStepOut: true,
  canStop: true,
};

const NONE_ALLOWED = {
  canContinue: false,
  canStepOver: false,
  canStepIn: false,
  canStepOut: false,
  canStop: false,
};

/** A snapshot with only the fields the toolbar reads. */
function snapshot(overrides: Partial<DebugSnapshot>): DebugSnapshot {
  return {
    status: 'idle',
    stop: null,
    breakpoints: [],
    conditionedBreakpoints: [],
    logpointLines: [],
    documentId: null,
    lastError: null,
    ...overrides,
  };
}

describe('the controls', () => {
  test('every one carries a name a student can read', () => {
    const actions = debugActions(() => ALL_ALLOWED, () => {});
    assert.deepEqual(
      actions.map(action => action.label),
      ['Continue', 'Step over', 'Step into', 'Step out', 'Stop'],
    );
  });

  test('and the shortcut a real editor uses, so it transfers', () => {
    const byId = new Map(debugActions(() => ALL_ALLOWED, () => {}).map(a => [a.id, a.shortcut]));
    assert.equal(byId.get('debug-continue'), 'F5');
    assert.equal(byId.get('debug-step-over'), 'F10');
    assert.equal(byId.get('debug-step-in'), 'F11');
    assert.equal(byId.get('debug-step-out'), 'Shift+F11');
    assert.equal(byId.get('debug-stop'), 'Shift+F5');
  });

  test('each has an icon drawn rather than borrowed from a font', () => {
    // `⤼` renders as a box on some Windows fonts, so a control whose meaning depended
    // on the machine would not be a control.
    for (const action of debugActions(() => ALL_ALLOWED, () => {})) {
      assert.match(action.icon, /<(path|circle|rect)/, action.label);
    }
  });

  test('only Stop is marked destructive', () => {
    const toned = debugActions(() => ALL_ALLOWED, () => {}).filter(action => action.tone === 'stop');
    assert.deepEqual(toned.map(action => action.label), ['Stop']);
  });

  test('enablement follows the session, and each button sends its own command', () => {
    const sent: string[] = [];
    const actions = debugActions(() => ALL_ALLOWED, command => sent.push(command));

    for (const action of actions) assert.equal(action.enabled(snapshot({})), true, action.label);
    for (const action of actions) action.run();
    assert.deepEqual(sent, ['continue', 'next', 'stepIn', 'stepOut', 'stop']);

    const refused = debugActions(() => NONE_ALLOWED, () => {});
    for (const action of refused) assert.equal(action.enabled(snapshot({})), false, action.label);
  });
});

describe('the status sentence', () => {
  test('paused names the line, which is the thing to act on', () => {
    assert.equal(
      describeStatus(snapshot({ status: 'paused', stop: { line: 4 } as DebugSnapshot['stop'] })),
      'Paused on line 4',
    );
  });

  test('running says what will happen next rather than just "running"', () => {
    assert.match(describeStatus(snapshot({ status: 'running' })), /pause at your next breakpoint/);
  });

  test('an error is described as an error, not as "postMortem"', () => {
    // There is no such thing as postMortem to a fifteen-year-old.
    const text = describeStatus(snapshot({
      status: 'postMortem',
      stop: { line: 7 } as DebugSnapshot['stop'],
    }));
    assert.equal(text, 'Stopped by an error on line 7');
    assert.doesNotMatch(text, /postMortem/i);
  });

  test('it still reads when the adapter reported no position', () => {
    assert.equal(describeStatus(snapshot({ status: 'paused' })), 'Paused');
    assert.equal(describeStatus(snapshot({ status: 'postMortem' })), 'Stopped by an error');
  });

  test('idle says nothing, because the toolbar is hidden then', () => {
    assert.equal(describeStatus(snapshot({ status: 'idle' })), '');
  });

  test('finished is a plain word', () => {
    assert.equal(describeStatus(snapshot({ status: 'ended' })), 'Finished');
  });
});
