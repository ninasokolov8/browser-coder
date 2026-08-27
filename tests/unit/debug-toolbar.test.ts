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

import { debugActions, describeStatus, renderToolbar } from '../../src/features/debug/toolbar.ts';
import type { DebugSnapshot, DebugStatus } from '../../src/features/debug/state.ts';

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
      ['Continue', 'Step over', 'Step into', 'Step out'],
    );
  });

  test('and the shortcut a real editor uses, so it transfers', () => {
    const byId = new Map(debugActions(() => ALL_ALLOWED, () => {}).map(a => [a.id, a.shortcut]));
    assert.equal(byId.get('debug-continue'), 'F5');
    assert.equal(byId.get('debug-step-over'), 'F10');
    assert.equal(byId.get('debug-step-in'), 'F11');
    assert.equal(byId.get('debug-step-out'), 'Shift+F11');
  });

  test('each has an icon drawn rather than borrowed from a font', () => {
    // `⤼` renders as a box on some Windows fonts, so a control whose meaning depended
    // on the machine would not be a control.
    for (const action of debugActions(() => ALL_ALLOWED, () => {})) {
      assert.match(action.icon, /<(path|circle|rect)/, action.label);
    }
  });

  test('enablement follows the session, and each button sends its own command', () => {
    const sent: string[] = [];
    const actions = debugActions(() => ALL_ALLOWED, command => sent.push(command));

    for (const action of actions) assert.equal(action.enabled(snapshot({})), true, action.label);
    for (const action of actions) action.run();
    assert.deepEqual(sent, ['continue', 'next', 'stepIn', 'stepOut']);

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

/**
 * Whether the bar is on screen at all.
 *
 * This is the assertion the bug needed and did not have. `renderToolbar` writes
 * `host.hidden` and nothing else in the codebase writes it, so the whole question of
 * "does the debugger disappear when the program does" is one line - and it was wrong,
 * hiding only on `idle`, a status that nothing in the app ever reached. So the toolbar
 * survived every run and stayed clickable over a program that had exited.
 *
 * A three-property stand-in rather than a DOM library: `renderToolbar` reads
 * `document.getElementById` and writes `hidden`, `disabled` and `textContent`, and
 * asserting against a fake that provides exactly those says more about the contract
 * than a full document would.
 */
describe('whether the bar is on screen', () => {
  interface FakeHost { hidden: boolean }

  /** Render one snapshot against a stand-in document and report `host.hidden`. */
  function hiddenFor(status: DebugStatus): boolean {
    const statusElement = { textContent: '', dataset: {} as Record<string, string> };
    const realDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => (id === 'debug-status' ? statusElement : null),
    };
    try {
      const host: FakeHost = { hidden: false };
      renderToolbar(host as unknown as HTMLElement, [], snapshot({ status }));
      return host.hidden;
    } finally {
      (globalThis as { document?: unknown }).document = realDocument;
    }
  }

  test('hidden before anything has run', () => {
    assert.equal(hiddenFor('idle'), true);
  });

  test('hidden again once the run is over', () => {
    // The reported bug: a finished run kept the whole bar - four greyed-out stepping
    // buttons and a live Back/Forward - over a program that no longer existed.
    assert.equal(hiddenFor('ended'), true);
  });

  test('shown for every state a student can act on', () => {
    for (const status of ['starting', 'running', 'paused', 'postMortem'] as const) {
      assert.equal(hiddenFor(status), false, status);
    }
  });
});
