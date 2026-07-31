/**
 * V-17: run policy enforced at the action, not at one caller.
 *
 * The defect was not a missing `if`. It was that the check lived in `stepup.ts`
 * before it synthesised a button click, while the button's own listener, and three
 * keybindings, had no check at all. Any new caller was a new hole, and the sidebar
 * meanwhile greyed the button with CSS so it *looked* enforced.
 *
 * These tests pin the property that replaces it: enablement and refusal come from
 * one declaration, so they cannot disagree.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CommandRegistry } from '../../src/commands/registry.ts';
import type { Capability } from '../../src/commands/registry.ts';

function makeRegistry(allowed: Partial<Record<Capability, boolean>> = {}) {
  const policy: Record<Capability, boolean> = {
    run: true,
    edit: true,
    structure: true,
    searchReplace: true,
    ...allowed,
  };
  const refusals: Array<{ id: string; capability?: Capability }> = [];

  const registry = new CommandRegistry({
    isAllowed: capability => policy[capability],
    onRefused: (command, outcome) => {
      refusals.push({
        id: command.id,
        capability: outcome.status === 'refused' ? outcome.capability : undefined,
      });
    },
  });

  return { registry, policy, refusals };
}

const UI = { source: 'ui' } as const;

describe('capability enforcement', () => {
  test('a command runs when its capability is granted', async () => {
    const { registry } = makeRegistry();
    let ran = 0;
    registry.register({ id: 'x.run', title: 'Run', capability: 'run', run: () => { ran++; } });

    const outcome = await registry.execute('x.run', UI);

    assert.equal(outcome.status, 'ran');
    assert.equal(ran, 1);
  });

  test('a command is refused when its capability is withheld', async () => {
    const { registry, refusals } = makeRegistry({ run: false });
    let ran = 0;
    registry.register({ id: 'x.run', title: 'Run', capability: 'run', run: () => { ran++; } });

    const outcome = await registry.execute('x.run', UI);

    assert.equal(outcome.status, 'refused');
    assert.equal(ran, 0, 'the handler must not run');
    assert.deepEqual(refusals, [{ id: 'x.run', capability: 'run' }]);
  });

  test('refusal applies to EVERY source, not just the UI', async () => {
    // The heart of V-17: the host path checked, the button did not. Now the source
    // is only recorded, never consulted.
    const { registry } = makeRegistry({ run: false });
    let ran = 0;
    registry.register({ id: 'x.run', title: 'Run', capability: 'run', run: () => { ran++; } });

    for (const source of ['ui', 'keybinding', 'palette', 'host', 'api'] as const) {
      const outcome = await registry.execute('x.run', { source });
      assert.equal(outcome.status, 'refused', `${source} was not refused`);
    }
    assert.equal(ran, 0);
  });

  test('structure-locked refuses file creation and closing', async () => {
    // Ctrl+N and Ctrl+W had no check at all before.
    const { registry } = makeRegistry({ structure: false });
    let created = 0;
    registry.register({
      id: 'workspace.newFile',
      title: 'New file',
      capability: 'structure',
      run: () => { created++; },
    });

    assert.equal((await registry.execute('workspace.newFile', { source: 'keybinding' })).status, 'refused');
    assert.equal(created, 0);
  });

  test('a command with no capability is always allowed', async () => {
    const { registry } = makeRegistry({ run: false, edit: false, structure: false });
    let ran = 0;
    registry.register({ id: 'x.free', title: 'Free', run: () => { ran++; } });

    assert.equal((await registry.execute('x.free', UI)).status, 'ran');
    assert.equal(ran, 1);
  });

  test('an unrecognised capability fails closed', async () => {
    // A typo in a declaration must refuse, not grant.
    const registry = new CommandRegistry({ isAllowed: () => false });
    registry.register({
      id: 'x.typo',
      title: 'Typo',
      capability: 'nonsense' as Capability,
      run: () => {},
    });
    assert.equal((await registry.execute('x.typo', UI)).status, 'refused');
  });
});

describe('enablement and execution agree', () => {
  test('isEnabled matches what execute will do, for every policy', async () => {
    // The invariant that makes a greyed-but-clickable button impossible.
    for (const allowed of [true, false]) {
      const { registry } = makeRegistry({ run: allowed });
      registry.register({ id: 'x.run', title: 'Run', capability: 'run', run: () => {} });

      const enabled = registry.isEnabled('x.run');
      const outcome = await registry.execute('x.run', UI);

      assert.equal(enabled, outcome.status === 'ran', `disagreement when allowed=${allowed}`);
    }
  });

  test('a `when` guard is honoured by both', async () => {
    const { registry } = makeRegistry();
    let hasDocument = false;
    registry.register({
      id: 'x.save',
      title: 'Save',
      when: () => hasDocument,
      run: () => {},
    });

    assert.equal(registry.isEnabled('x.save'), false);
    assert.equal((await registry.execute('x.save', UI)).status, 'refused');

    hasDocument = true;
    assert.equal(registry.isEnabled('x.save'), true);
    assert.equal((await registry.execute('x.save', UI)).status, 'ran');
  });

  test('policy is re-read at execution, not captured at binding', async () => {
    // A control bound while running was allowed must not stay live after the host
    // sends stepup:set-readonly.
    const { registry, policy } = makeRegistry();
    let ran = 0;
    registry.register({ id: 'x.run', title: 'Run', capability: 'run', run: () => { ran++; } });

    assert.equal((await registry.execute('x.run', UI)).status, 'ran');
    policy.run = false;
    assert.equal((await registry.execute('x.run', UI)).status, 'refused');
    assert.equal(ran, 1);
  });
});

describe('registry hygiene', () => {
  test('an unknown command is reported rather than silently ignored', async () => {
    const { registry } = makeRegistry();
    const outcome = await registry.execute('does.not.exist', UI);
    assert.equal(outcome.status, 'unknown');
  });

  test('a duplicate id is rejected', () => {
    // Two actions sharing an id means one keybinding and one palette entry, with
    // the winner decided by import order.
    const { registry } = makeRegistry();
    registry.register({ id: 'x.a', title: 'A', run: () => {} });
    assert.throws(() => registry.register({ id: 'x.a', title: 'A again', run: () => {} }), /already registered/);
  });

  test('a throwing command is reported, not propagated', async () => {
    // A failing action must not take the event handler - or the keybinding - with it.
    const { registry } = makeRegistry();
    registry.register({
      id: 'x.boom',
      title: 'Boom',
      run: () => {
        throw new Error('kaboom');
      },
    });

    const outcome = await registry.execute('x.boom', UI);
    assert.equal(outcome.status, 'failed');
    assert.match((outcome as { error: Error }).error.message, /kaboom/);
  });

  test('policy changes notify bound controls exactly once', () => {
    const { registry } = makeRegistry();
    let notifications = 0;
    registry.onDidChangeEnablement(() => notifications++);

    registry.notifyPolicyChanged();
    assert.equal(notifications, 1);
  });
});
