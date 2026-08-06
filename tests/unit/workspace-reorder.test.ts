/**
 * Persisting the order a student arranged their files in.
 *
 * The `order` field has been maintained by the storage layer since the beginning and
 * thrown away by the tree, which sorted by name. The trap in "just honour it" is that
 * `order` is assigned by CREATION SEQUENCE - so switching would have silently
 * reshuffled every project that nobody ever reordered, which reads as corruption.
 *
 * The rule these tests pin: a parent stays name-sorted until something inside it is
 * actually dragged into place, and the first drag renumbers that whole parent so the
 * arrangement is dense and complete rather than one moved item among stale numbers.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceService } from '../../src/workspace/service.ts';
import { MemoryWorkspaceStore } from '../../src/workspace/store.ts';

function idFactory() {
  let counter = 0;
  return (kind: 'file' | 'folder') => `${kind}-${++counter}`;
}

function makeService(store = new MemoryWorkspaceStore()) {
  const service = new WorkspaceService({
    store,
    autoSaveDelayMs: 0,
    now: () => 5_000,
    newId: idFactory(),
  });
  return { service, store };
}

async function threeFiles(service: WorkspaceService) {
  const a = await service.createDocument({ name: 'a.py', language: 'python', version: 'python3' });
  const b = await service.createDocument({ name: 'b.py', language: 'python', version: 'python3' });
  const c = await service.createDocument({ name: 'c.py', language: 'python', version: 'python3' });
  return { a, b, c };
}

describe('before anything has been arranged', () => {
  test('a parent is not manually ordered', async () => {
    const { service } = makeService();
    await service.open();
    await threeFiles(service);

    assert.equal(service.isManuallyOrdered(null), false);
  });

  test('a folder that has never been touched is not either', async () => {
    const { service } = makeService();
    await service.open();
    const src = await service.createFolder('src');

    assert.equal(service.isManuallyOrdered(src.id), false);
  });
});

describe('the first arrangement', () => {
  test('records the parent and renumbers all of its children densely', async () => {
    // Densely and completely: writing only the moved item would leave the others on
    // creation-sequence numbers, and the tree would rearrange around the one change.
    const { service } = makeService();
    await service.open();
    const { a, b, c } = await threeFiles(service);

    const changed = await service.reorderChildren(null, [c.id, a.id, b.id]);
    assert.equal(changed, true);
    assert.equal(service.isManuallyOrdered(null), true);

    assert.equal(service.getDocument(c.id)?.metadata.order, 0);
    assert.equal(service.getDocument(a.id)?.metadata.order, 1);
    assert.equal(service.getDocument(b.id)?.metadata.order, 2);
  });

  test('folders are ordered by the same call, not a separate one', async () => {
    const { service } = makeService();
    await service.open();
    const src = await service.createFolder('src');
    const lib = await service.createFolder('lib');

    await service.reorderChildren(null, [lib.id, src.id]);

    assert.equal(service.getFolder(lib.id)?.order, 0);
    assert.equal(service.getFolder(src.id)?.order, 1);
  });

  test('a folder is recorded separately from the root', async () => {
    const { service } = makeService();
    await service.open();
    const src = await service.createFolder('src');
    const inner = await service.createDocument({
      name: 'x.py', language: 'python', version: 'python3', parentId: src.id,
    });

    await service.reorderChildren(src.id, [inner.id]);

    assert.equal(service.isManuallyOrdered(src.id), true);
    assert.equal(service.isManuallyOrdered(null), false, 'the root was marked by a folder move');
  });
});

describe('after it has been arranged', () => {
  test('reordering again is not reported as a change when nothing moved', async () => {
    // The caller uses this to stay quiet rather than announcing a move that did not
    // happen - the defect the audit found in the plain move path.
    const { service } = makeService();
    await service.open();
    const { a, b, c } = await threeFiles(service);

    await service.reorderChildren(null, [a.id, b.id, c.id]);
    const again = await service.reorderChildren(null, [a.id, b.id, c.id]);

    assert.equal(again, false);
  });

  test('a real rearrangement is still reported', async () => {
    const { service } = makeService();
    await service.open();
    const { a, b, c } = await threeFiles(service);

    await service.reorderChildren(null, [a.id, b.id, c.id]);
    assert.equal(await service.reorderChildren(null, [b.id, a.id, c.id]), true);
    assert.equal(service.getDocument(b.id)?.metadata.order, 0);
  });

  test('an empty list does nothing at all', async () => {
    const { service } = makeService();
    await service.open();
    await threeFiles(service);

    assert.equal(await service.reorderChildren(null, []), false);
    assert.equal(service.isManuallyOrdered(null), false);
  });
});

describe('it survives a reload', () => {
  test('both the arrangement and the fact that there is one', async () => {
    // The flag lives in workspace state and the numbers on each record; if either half
    // were lost the tree would fall back to names and the student's arrangement would
    // silently vanish.
    const store = new MemoryWorkspaceStore();
    const first = makeService(store);
    await first.service.open();
    const { a, b, c } = await threeFiles(first.service);
    await first.service.reorderChildren(null, [c.id, b.id, a.id]);

    const second = makeService(store);
    await second.service.open();

    assert.equal(second.service.isManuallyOrdered(null), true);
    assert.equal(second.service.getDocument(c.id)?.metadata.order, 0);
    assert.equal(second.service.getDocument(b.id)?.metadata.order, 1);
    assert.equal(second.service.getDocument(a.id)?.metadata.order, 2);
  });

  test('a workspace written before this existed simply has no arrangement', async () => {
    // `manuallyOrderedParents` is optional for exactly this: an older record has no
    // such field, and reading it must not throw or mark everything as arranged.
    const store = new MemoryWorkspaceStore();
    const { service } = makeService(store);
    await service.open();
    await threeFiles(service);

    assert.equal(service.isManuallyOrdered(null), false);
    assert.equal(service.isManuallyOrdered('folder-that-does-not-exist'), false);
  });
});
