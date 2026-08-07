/**
 * That a compile error stops being shown once the student has changed the file.
 *
 * `DiagnosticsStore.invalidate()` was written for this, its doc comment said "called
 * when a document changes", and nothing called it. The store's own tests covered the
 * method thoroughly - it is correct - so the gap was never that the logic was wrong. It
 * was that no wire ran to it, which is the kind of hole a unit test of the unit cannot
 * see.
 *
 * These tests drive the real WorkspaceService, so what is asserted is the connection.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DiagnosticsStore, type Diagnostic } from '../../src/diagnostics/store.ts';
import { connectDiagnosticStaleness } from '../../src/diagnostics/staleness.ts';
import { WorkspaceService } from '../../src/workspace/service.ts';
import { MemoryWorkspaceStore } from '../../src/workspace/store.ts';

const PYTHON = { language: 'python', version: 'python3' };

/** One compile error, of the shape a failed run publishes. */
function diagnostic(documentId: string, path: string, message: string): Diagnostic {
  return { documentId, path, line: 1, column: 7, severity: 'error', message, source: 'python' };
}

function makeService(): WorkspaceService {
  let counter = 0;
  return new WorkspaceService({
    store: new MemoryWorkspaceStore(),
    autoSaveDelayMs: 0,
    now: () => 5_000,
    newId: (kind: 'file' | 'folder') => `${kind}-${++counter}`,
  });
}

/** A workspace with one Python file, a store wired to it, and a compile error posted. */
async function withRunError() {
  const service = makeService();
  await service.open();

  const created = await service.createDocument({
    name: 'main.py',
    content: 'print(x)\n',
    ...PYTHON,
  });
  const document = service.getDocument(created.id)!;

  const store = new DiagnosticsStore();
  const wiring = connectDiagnosticStaleness({ store, service });

  // What a failed run publishes: an error against the revision that was run.
  store.set(document.id, 'run', document.revision, [
    diagnostic(document.id, 'main.py', "name 'x' is not defined"),
  ]);

  return { service, store, document, wiring };
}

describe('a run error and the edit that follows it', () => {
  test('the error is shown while the file is unchanged', async () => {
    const { store, document, wiring } = await withRunError();

    assert.equal(store.forDocument(document.id).length, 1);
    wiring.dispose();
  });

  test('editing the file discards it', async () => {
    const { store, document, wiring } = await withRunError();

    // The student fixes the bug. Before this wiring existed, the squiggle stayed on
    // line 1 through this edit and every edit after it, until the next run.
    document.setContent('x = 1\nprint(x)\n');

    assert.deepEqual(store.forDocument(document.id), []);
    wiring.dispose();
  });

  test('an error published AFTER the edit survives', async () => {
    const { store, document, wiring } = await withRunError();

    document.setContent('print(y)\n');
    store.set(document.id, 'run', document.revision, [
      diagnostic(document.id, 'main.py', "name 'y' is not defined"),
    ]);

    // Invalidation is by revision, not "clear on any change" - otherwise a run that
    // finishes while the student is still typing would erase its own result.
    assert.equal(store.forDocument(document.id).length, 1);
    assert.match(store.forDocument(document.id)[0].message, /'y'/);
    wiring.dispose();
  });

  test('one document changing does not clear another', async () => {
    const { service, store, document, wiring } = await withRunError();

    const other = await service.createDocument({
      name: 'helper.py',
      content: 'def f(): pass\n',
      ...PYTHON,
    });
    const otherDocument = service.getDocument(other.id)!;
    store.set(otherDocument.id, 'run', otherDocument.revision, [
      diagnostic(otherDocument.id, 'helper.py', 'unused'),
    ]);

    document.setContent('changed\n');

    assert.deepEqual(store.forDocument(document.id), []);
    assert.equal(store.forDocument(otherDocument.id).length, 1, "the other file's error stays");
    wiring.dispose();
  });
});

describe('documents that appear and disappear', () => {
  test('a file created after wiring is watched too', async () => {
    const service = makeService();
    await service.open();

    const store = new DiagnosticsStore();
    const wiring = connectDiagnosticStaleness({ store, service });

    // Created AFTER the connection: the subscription set has to be reconciled on
    // workspace change, not built once at startup.
    const created = await service.createDocument({
      name: 'later.py',
      content: 'a\n',
      ...PYTHON,
    });
    const document = service.getDocument(created.id)!;

    store.set(document.id, 'run', document.revision, [
      diagnostic(document.id, 'later.py', 'boom'),
    ]);
    document.setContent('b\n');

    assert.deepEqual(store.forDocument(document.id), []);
    wiring.dispose();
  });

  test('deleting a file takes its diagnostics with it', async () => {
    const { service, store, document, wiring } = await withRunError();

    await service.deleteDocuments([document.id]);

    // Otherwise closing and reopening a file would show errors from before it was
    // closed, and the subscription would leak for the session.
    assert.deepEqual(store.forDocument(document.id), []);
    wiring.dispose();
  });

  test('disposing stops the watching', async () => {
    const { store, document, wiring } = await withRunError();

    wiring.dispose();
    document.setContent('changed after dispose\n');

    assert.equal(store.forDocument(document.id).length, 1, 'no longer invalidated');
  });
});
