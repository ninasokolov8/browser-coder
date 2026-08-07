/**
 * The IndexedDB adapter, against a real IndexedDB implementation.
 *
 * The domain tests use an in-memory store, which proves the logic but not the
 * transaction discipline. These tests exist for the parts that only a real
 * IndexedDB can get wrong: auto-commit ending a transaction early, a clear that
 * misses a store, and whether "atomic" actually is.
 */

import 'fake-indexeddb/auto';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDbWorkspaceStore } from '../../src/workspace/store-indexeddb.ts';
import { WorkspaceService } from '../../src/workspace/service.ts';
import type { FolderMetadata, PersistedDocument } from '../../src/workspace/types.ts';

let databaseCounter = 0;

/** A fresh database per test, so state cannot leak between them. */
function freshStore(): IndexedDbWorkspaceStore {
  databaseCounter += 1;
  return new IndexedDbWorkspaceStore(`WorkspaceTestDB-${databaseCounter}`);
}

function document(overrides: Partial<PersistedDocument> = {}): PersistedDocument {
  return {
    id: 'doc-1',
    name: 'main.py',
    parentId: null,
    language: 'python',
    version: 'python3',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    isUserModified: false,
    content: '',
    ...overrides,
  };
}

function folder(overrides: Partial<FolderMetadata> = {}): FolderMetadata {
  return {
    id: 'folder-1',
    name: 'src',
    parentId: null,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('round trip', () => {
  test('a created document reads back with its content', async () => {
    const store = freshStore();
    await store.open();

    await store.createDocument(document({ content: 'print(1)' }));
    const snapshot = await store.loadAll();

    assert.equal(snapshot.files.length, 1);
    assert.equal(snapshot.files[0].content, 'print(1)');
    assert.equal(snapshot.files[0].name, 'main.py');
    store.close();
  });

  test('content writes and metadata writes do not interfere', async () => {
    const store = freshStore();
    await store.open();
    await store.createDocument(document({ content: 'original' }));

    await store.writeDocumentContent('doc-1', 'edited', 20);
    await store.updateDocumentMetadata('doc-1', { name: 'renamed.py' }, 30);

    const snapshot = await store.loadAll();
    assert.equal(snapshot.files[0].content, 'edited', 'a rename must not revert content');
    assert.equal(snapshot.files[0].name, 'renamed.py');
    store.close();
  });

  test('state survives a reopen', async () => {
    const store = freshStore();
    await store.open();
    await store.saveState({ activeFileId: 'doc-1', theme: 'vs-light' });
    store.close();

    const reopened = new IndexedDbWorkspaceStore(store.databaseName);
    await reopened.open();
    const snapshot = await reopened.loadAll();

    assert.deepEqual(snapshot.state, { activeFileId: 'doc-1', theme: 'vs-light' });
    reopened.close();
  });
});

describe('legacy compatibility', () => {
  test('a stored path is ignored in favour of the folder chain', async () => {
    // A record whose persisted path disagrees with its parent - exactly the stale
    // state a folder move used to leave behind. The chain wins.
    const store = freshStore();
    await store.open();
    await store.createFolder(folder({ id: 'f1', name: 'src' }));
    await store.createDocument(document({ id: 'd1', name: 'app.py', parentId: 'f1' }));
    await store.updateFolderMetadata('f1', { name: 'lib' }, 99);

    const service = new WorkspaceService({ store, autoSaveDelayMs: 0 });
    await service.open();

    assert.equal(service.pathOf('d1'), 'lib/app.py');
    service.dispose();
  });

  test('the compat path is refreshed for descendants on a folder rename', async () => {
    // Written for rollback safety only. If this branch is reverted, the previous
    // implementation still finds correct paths.
    const store = freshStore();
    await store.open();
    await store.createFolder(folder({ id: 'f1', name: 'src' }));
    await store.createFolder(folder({ id: 'f2', name: 'deep', parentId: 'f1' }));
    await store.createDocument(document({ id: 'd1', name: 'x.py', parentId: 'f2' }));

    await store.updateFolderMetadata('f1', { name: 'lib' }, 99);

    const raw = await readRawRecords(store.databaseName);
    assert.equal(raw.files[0].path, '/lib/deep/x.py');
    assert.equal(raw.folders.find(f => f.id === 'f2')?.path, '/lib/deep');
    store.close();
  });

  test('a record missing newer fields still loads', async () => {
    const store = freshStore();
    await store.open();
    store.close();

    // Simulates a record written by an older build.
    await writeRawFile(store.databaseName, {
      id: 'legacy',
      name: 'old.py',
      path: '/old.py',
      parentId: null,
      language: 'python',
      version: 'python3',
      content: 'legacy content',
    });

    const reopened = new IndexedDbWorkspaceStore(store.databaseName);
    await reopened.open();
    const snapshot = await reopened.loadAll();

    assert.equal(snapshot.files[0].content, 'legacy content');
    assert.equal(snapshot.files[0].isUserModified, false);
    assert.equal(snapshot.files[0].order, 0);
    reopened.close();
  });
});

describe('atomicity', () => {
  test('replaceAll commits files, folders and state together', async () => {
    const store = freshStore();
    await store.open();
    await store.createDocument(document({ id: 'old', name: 'old.py', content: 'old' }));

    await store.replaceAll({
      files: [
        document({ id: 'new-1', name: 'a.py', parentId: 'f1', content: 'a' }),
        document({ id: 'new-2', name: 'b.py', content: 'b' }),
      ],
      folders: [folder({ id: 'f1', name: 'src' })],
      state: { activeFileId: 'new-1', theme: 'vs-dark' },
    });

    const snapshot = await store.loadAll();
    assert.equal(snapshot.files.length, 2);
    assert.equal(snapshot.folders.length, 1);
    assert.equal(snapshot.state.activeFileId, 'new-1');
    assert.equal(
      snapshot.files.some(file => file.id === 'old'),
      false,
      'the replaced workspace must be gone',
    );
    store.close();
  });

  test('clearAll empties the folders store too', async () => {
    // N-02: the previous importAll cleared files and state but not folders,
    // leaving orphaned folders from the old workspace behind.
    const store = freshStore();
    await store.open();
    await store.createFolder(folder({ id: 'f1' }));
    await store.createDocument(document({ id: 'd1', parentId: 'f1' }));

    await store.clearAll();
    const snapshot = await store.loadAll();

    assert.equal(snapshot.files.length, 0);
    assert.equal(snapshot.folders.length, 0, 'no orphaned folders may remain');
    store.close();
  });

  test('deleting a folder deletes its files in the same transaction', async () => {
    const store = freshStore();
    await store.open();
    await store.createFolder(folder({ id: 'f1', name: 'src' }));
    await store.createFolder(folder({ id: 'f2', name: 'nested', parentId: 'f1' }));
    await store.createDocument(document({ id: 'd1', name: 'inner.py', parentId: 'f2' }));
    await store.createDocument(document({ id: 'd2', name: 'root.py', parentId: null }));

    await store.deleteFoldersRecursive(['f1']);
    const snapshot = await store.loadAll();

    assert.deepEqual(snapshot.files.map(file => file.id), ['d2']);
    assert.equal(snapshot.folders.length, 0);
    store.close();
  });
});

describe('resurrection', () => {
  test('a write for a deleted document is dropped, not recreated', async () => {
    // The debounced-save hazard: the timer fires after the file is gone.
    const store = freshStore();
    await store.open();
    await store.createDocument(document({ id: 'doomed', content: 'x' }));
    await store.deleteDocuments(['doomed']);

    await store.writeDocumentContent('doomed', 'late arrival', 50);

    const snapshot = await store.loadAll();
    assert.equal(snapshot.files.length, 0, 'the deleted file must stay deleted');
    store.close();
  });

  test('a metadata update for a deleted document is dropped', async () => {
    const store = freshStore();
    await store.open();
    await store.createDocument(document({ id: 'doomed' }));
    await store.deleteDocuments(['doomed']);

    await store.updateDocumentMetadata('doomed', { name: 'zombie.py' }, 50);

    const snapshot = await store.loadAll();
    assert.equal(snapshot.files.length, 0);
    store.close();
  });
});

describe('end to end through the service', () => {
  let store: IndexedDbWorkspaceStore;

  beforeEach(() => {
    store = freshStore();
  });

  test('a workspace survives a full close and reopen', async () => {
    const service = new WorkspaceService({ store, autoSaveDelayMs: 0 });
    await service.open();

    const src = await service.createFolder('src');
    const created = await service.createDocument({
      name: 'app.py',
      parentId: src.id,
      language: 'python',
      version: 'python3',
      content: 'initial',
    });
    created.setContent('edited before reload');
    await service.flushAll();
    service.dispose();

    const reopenedStore = new IndexedDbWorkspaceStore(store.databaseName);
    const reopened = new WorkspaceService({ store: reopenedStore, autoSaveDelayMs: 0 });
    await reopened.open();

    const restored = reopened.findByPath('src/app.py');
    assert.ok(restored, 'the file must come back at the same path');
    assert.equal(restored.getContent(), 'edited before reload');
    assert.equal(restored.isDirty, false);
    reopened.dispose();
  });

  test('a host project replacement persists atomically and reloads', async () => {
    const service = new WorkspaceService({ store, autoSaveDelayMs: 0 });
    await service.open();

    await service.replaceAll(
      [
        { path: 'main.py', content: 'main' },
        { path: 'pkg/util.py', content: 'util' },
      ],
      { resolve: () => ({ id: 'python', version: 'python3' }) },
    );
    service.dispose();

    const reopenedStore = new IndexedDbWorkspaceStore(store.databaseName);
    const reopened = new WorkspaceService({ store: reopenedStore, autoSaveDelayMs: 0 });
    await reopened.open();

    assert.deepEqual(
      reopened.snapshotForExecution().map(file => file.path),
      ['main.py', 'pkg/util.py'],
    );
    reopened.dispose();
  });
});

// ===== raw helpers, to inspect what actually landed on disk =====

function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRawRecords(
  name: string,
): Promise<{ files: Array<Record<string, unknown>>; folders: Array<Record<string, unknown>> }> {
  const db = await openRaw(name);
  const transaction = db.transaction(['files', 'folders'], 'readonly');
  const read = <T>(store: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });

  const files = await read<Array<Record<string, unknown>>>('files');
  const folders = await read<Array<Record<string, unknown>>>('folders');
  db.close();
  return { files, folders };
}

async function writeRawFile(name: string, record: Record<string, unknown>): Promise<void> {
  const db = await openRaw(name);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
