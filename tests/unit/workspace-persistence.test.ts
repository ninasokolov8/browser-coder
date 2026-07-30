/**
 * PersistenceCoordinator - the autosave defects, reproduced and closed.
 *
 * Each test names the defect it pins. They are written so that they FAIL against
 * the behaviour being replaced, not merely pass against the new code: the shared
 * timer, the post-await assignment, and the unconditional dirty clear each have a
 * test that the old implementation cannot satisfy.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { PersistenceCoordinator } from '../../src/workspace/persistence.ts';
import { MemoryWorkspaceStore } from '../../src/workspace/store.ts';
import {
  FakeClock,
  GatedStore,
  makeDocument,
  persisted,
  settle,
} from './support/workspace-fixtures.ts';

describe('V-09: content typed during a save', () => {
  test('the working copy is never overwritten by the write that is landing', async () => {
    const store = new GatedStore({ files: [persisted({ id: 'doc-1', content: 'a' })] });
    const document = makeDocument('a');
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    coordinator.register(document);

    document.setContent('ab');

    const writeStarted = store.whenNextWriteStarts();
    const flushing = coordinator.flush('doc-1');
    await writeStarted;

    // The keystroke that the old implementation discarded.
    document.setContent('abc');

    store.openGate();
    const outcome = await flushing;

    assert.equal(document.getContent(), 'abc', 'the working copy must be untouched');
    assert.equal(store.peekContent('doc-1'), 'abc', 'the newer text must be what persists');
    assert.equal(document.isDirty, false);
    assert.equal(outcome.status, 'saved');
  });

  test('the revision guard forces a second write rather than claiming success', async () => {
    const store = new GatedStore({ files: [persisted({ id: 'doc-1', content: 'a' })] });
    const document = makeDocument('a');
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    coordinator.register(document);

    document.setContent('ab');
    const writeStarted = store.whenNextWriteStarts();
    const flushing = coordinator.flush('doc-1');
    await writeStarted;

    document.setContent('abc');
    store.openGate();
    await flushing;

    // Exactly the observable difference: the old code wrote once and asserted
    // clean. The guard notices revision moved and writes the newer content.
    assert.equal(store.writeCount, 2);
  });

  test('several edits during one write coalesce into a single follow-up write', async () => {
    const store = new GatedStore({ files: [persisted({ id: 'doc-1', content: '' })] });
    const document = makeDocument('');
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    coordinator.register(document);

    document.setContent('1');
    const writeStarted = store.whenNextWriteStarts();
    const flushing = coordinator.flush('doc-1');
    await writeStarted;

    document.setContent('12');
    document.setContent('123');
    document.setContent('1234');

    store.openGate();
    await flushing;

    assert.equal(store.writeCount, 2, 'four keystrokes must not mean four writes');
    assert.equal(store.peekContent('doc-1'), '1234');
  });
});

describe('N-04: one timer per document', () => {
  test('editing a second document does not cancel the first pending save', async () => {
    // The old code kept a single `autoSaveTimer` on the manager, so this exact
    // sequence lost document A's edit.
    const clock = new FakeClock();
    const store = new MemoryWorkspaceStore({
      files: [
        persisted({ id: 'doc-a', name: 'a.py', content: 'a0' }),
        persisted({ id: 'doc-b', name: 'b.py', content: 'b0' }),
      ],
    });
    const coordinator = new PersistenceCoordinator({
      store,
      autoSaveDelayMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    const documentA = makeDocument('a0', { id: 'doc-a', name: 'a.py' });
    const documentB = makeDocument('b0', { id: 'doc-b', name: 'b.py' });
    coordinator.register(documentA);
    coordinator.register(documentB);

    documentA.setContent('a1');
    documentB.setContent('b1');

    await clock.advance(1000);
    await settle();

    assert.equal(store.peekContent('doc-a'), 'a1', "document A's edit must survive");
    assert.equal(store.peekContent('doc-b'), 'b1');
  });

  test('repeated edits to one document debounce to one write', async () => {
    const clock = new FakeClock();
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1' })] });
    const coordinator = new PersistenceCoordinator({
      store,
      autoSaveDelayMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const document = makeDocument('');
    coordinator.register(document);

    document.setContent('t');
    await clock.advance(400);
    document.setContent('ty');
    await clock.advance(400);
    document.setContent('typ');
    await clock.advance(1000);
    await settle();

    assert.equal(store.countOperations('writeDocumentContent'), 1);
    assert.equal(store.peekContent('doc-1'), 'typ');
  });
});

describe('suspend', () => {
  test('a queued save cannot fire after the workspace is cleared', async () => {
    // The Clear Cache hazard: a debounced write landing after clearAll() recreates
    // a file the user just deleted.
    const clock = new FakeClock();
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1' })] });
    const coordinator = new PersistenceCoordinator({
      store,
      autoSaveDelayMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const document = makeDocument('');
    coordinator.register(document);

    document.setContent('about to be discarded');
    coordinator.suspend();
    await store.clearAll();

    await clock.advance(5000);
    await settle();

    assert.equal(clock.pendingCount, 0, 'no timer may remain armed');
    assert.equal(store.peekDocument('doc-1'), undefined, 'the file must stay deleted');
  });

  test('suspend leaves already-durable content alone', async () => {
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1', content: 'kept' })] });
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    const document = makeDocument('kept');
    coordinator.register(document);

    coordinator.suspend();

    assert.equal(store.peekContent('doc-1'), 'kept');
  });
});

describe('failure handling', () => {
  test('a failed write leaves the document dirty and reports the error', async () => {
    const store = new MemoryWorkspaceStore(
      { files: [persisted({ id: 'doc-1', content: 'old' })] },
      { failOn: (operation, index) => (operation === 'writeDocumentContent' && index === 0 ? new Error('quota exceeded') : null) },
    );
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    const document = makeDocument('old');
    coordinator.register(document);

    document.setContent('new');
    const outcome = await coordinator.flush('doc-1');

    assert.equal(outcome.status, 'failed');
    assert.equal(document.isDirty, true, 'unsaved work must still be marked unsaved');
    assert.match(coordinator.lastErrorFor('doc-1')?.message ?? '', /quota exceeded/);
  });

  test('a later flush recovers after a transient failure', async () => {
    const store = new MemoryWorkspaceStore(
      { files: [persisted({ id: 'doc-1', content: 'old' })] },
      { failOn: (operation, index) => (operation === 'writeDocumentContent' && index === 0 ? new Error('transient') : null) },
    );
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    const document = makeDocument('old');
    coordinator.register(document);

    document.setContent('new');
    await coordinator.flush('doc-1');
    const second = await coordinator.flush('doc-1');

    assert.equal(second.status, 'saved');
    assert.equal(store.peekContent('doc-1'), 'new');
    assert.equal(coordinator.lastErrorFor('doc-1'), undefined);
  });

  test('a persistent failure does not spin', async () => {
    let attempts = 0;
    const store = new MemoryWorkspaceStore(
      { files: [persisted({ id: 'doc-1' })] },
      {
        failOn: operation => {
          if (operation !== 'writeDocumentContent') return null;
          attempts++;
          return new Error('disk is gone');
        },
      },
    );
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    const document = makeDocument('');
    coordinator.register(document);

    document.setContent('x');
    await coordinator.flush('doc-1');

    assert.equal(attempts, 1, 'one flush must mean one attempt, not a retry loop');
  });
});

describe('flush', () => {
  test('flushing a clean document is a no-op', async () => {
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1', content: 'x' })] });
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    const document = makeDocument('x');
    coordinator.register(document);

    await coordinator.flush('doc-1');

    assert.equal(store.countOperations('writeDocumentContent'), 0);
  });

  test('flush cancels the pending debounce rather than writing twice', async () => {
    const clock = new FakeClock();
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1' })] });
    const coordinator = new PersistenceCoordinator({
      store,
      autoSaveDelayMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const document = makeDocument('');
    coordinator.register(document);

    document.setContent('x');
    await coordinator.flush('doc-1');
    await clock.advance(5000);
    await settle();

    assert.equal(store.countOperations('writeDocumentContent'), 1);
  });

  test('flushAll persists every dirty document', async () => {
    const store = new MemoryWorkspaceStore({
      files: [
        persisted({ id: 'doc-a', name: 'a.py' }),
        persisted({ id: 'doc-b', name: 'b.py' }),
        persisted({ id: 'doc-c', name: 'c.py' }),
      ],
    });
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });

    for (const id of ['doc-a', 'doc-b', 'doc-c']) {
      const document = makeDocument('', { id, name: `${id}.py` });
      coordinator.register(document);
      document.setContent(`content of ${id}`);
    }

    await coordinator.flushAll();

    assert.equal(store.peekContent('doc-a'), 'content of doc-a');
    assert.equal(store.peekContent('doc-b'), 'content of doc-b');
    assert.equal(store.peekContent('doc-c'), 'content of doc-c');
  });

  test('hasPendingWrites reflects queued work', async () => {
    const clock = new FakeClock();
    const store = new MemoryWorkspaceStore({ files: [persisted({ id: 'doc-1' })] });
    const coordinator = new PersistenceCoordinator({
      store,
      autoSaveDelayMs: 1000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const document = makeDocument('');
    coordinator.register(document);

    assert.equal(coordinator.hasPendingWrites, false);
    document.setContent('x');
    assert.equal(coordinator.hasPendingWrites, true);

    await clock.advance(1000);
    await settle();

    assert.equal(coordinator.hasPendingWrites, false);
  });
});

describe('concurrency', () => {
  test('two flushes for one document do not write concurrently', async () => {
    const store = new GatedStore({ files: [persisted({ id: 'doc-1' })] });
    const document = makeDocument('');
    const coordinator = new PersistenceCoordinator({ store, autoSaveDelayMs: 0 });
    coordinator.register(document);

    document.setContent('x');
    const writeStarted = store.whenNextWriteStarts();
    const first = coordinator.flush('doc-1');
    await writeStarted;

    const second = coordinator.flush('doc-1');
    assert.equal(store.writeCount, 1, 'the second flush must join the in-flight write');

    store.openGate();
    await Promise.all([first, second]);

    assert.equal(store.peekContent('doc-1'), 'x');
  });
});
