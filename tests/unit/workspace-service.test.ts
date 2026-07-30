/**
 * WorkspaceService - atomic commands and derived paths.
 *
 * The tests that matter most here are the ones about what survives a FAILURE.
 * V-13 is not "replaceAll is slow", it is "replaceAll can destroy the workspace
 * and leave nothing behind", and the only way to pin that is to make the store
 * fail on purpose and assert the previous contents are still there.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceService } from '../../src/workspace/service.ts';
import { MemoryWorkspaceStore } from '../../src/workspace/store.ts';
import { persisted, settle } from './support/workspace-fixtures.ts';

const PYTHON = { id: 'python', version: 'python3' };
const resolveAlwaysPython = { resolve: () => PYTHON };

/** Deterministic ids so assertions can name them. */
function idFactory() {
  let counter = 0;
  return (kind: 'file' | 'folder') => `${kind}-${++counter}`;
}

function makeService(
  store: MemoryWorkspaceStore = new MemoryWorkspaceStore(),
): { service: WorkspaceService; store: MemoryWorkspaceStore } {
  const service = new WorkspaceService({
    store,
    autoSaveDelayMs: 0,
    now: () => 5_000,
    newId: idFactory(),
  });
  return { service, store };
}

describe('derived paths', () => {
  test('a path is the folder chain plus the name', async () => {
    const { service } = makeService();
    await service.open();

    const src = await service.createFolder('src');
    const utils = await service.createFolder('utils', src.id);
    const document = await service.createDocument({
      name: 'math.py',
      parentId: utils.id,
      ...PYTHON,
      language: PYTHON.id,
    });

    assert.equal(service.pathOf(document.id), 'src/utils/math.py');
  });

  test('paths carry no leading slash', async () => {
    // The old store wrote "/main.py", which the server's validator rejects
    // outright, so every wire boundary had to strip it by hand.
    const { service } = makeService();
    await service.open();
    const document = await service.createDocument({ name: 'main.py', language: 'python', version: 'python3' });

    assert.equal(service.pathOf(document.id), 'main.py');
  });

  test('renaming a folder updates every descendant path with one write', async () => {
    // V-15: the previous implementation rewrote each descendant's stored path,
    // across two transactions. Nothing to rewrite here - paths are derived.
    const { service, store } = makeService();
    await service.open();

    const src = await service.createFolder('src');
    const document = await service.createDocument({
      name: 'app.py',
      parentId: src.id,
      language: 'python',
      version: 'python3',
    });
    assert.equal(service.pathOf(document.id), 'src/app.py');

    const before = store.countOperations('updateFolderMetadata');
    await service.renameFolder(src.id, 'lib');

    assert.equal(service.pathOf(document.id), 'lib/app.py');
    assert.equal(store.countOperations('updateFolderMetadata'), before + 1, 'exactly one write');
    assert.equal(store.countOperations('updateDocumentMetadata'), 0, 'no descendant rewrite');
  });

  test('moving a folder repaths its whole subtree', async () => {
    const { service } = makeService();
    await service.open();

    const src = await service.createFolder('src');
    const nested = await service.createFolder('deep', src.id);
    const document = await service.createDocument({
      name: 'x.py',
      parentId: nested.id,
      language: 'python',
      version: 'python3',
    });
    const target = await service.createFolder('other');

    await service.moveFolder(src.id, target.id);

    assert.equal(service.pathOf(document.id), 'other/src/deep/x.py');
  });

  test('a folder cannot be moved inside itself', async () => {
    const { service } = makeService();
    await service.open();
    const outer = await service.createFolder('outer');
    const inner = await service.createFolder('inner', outer.id);

    const result = await service.moveFolder(outer.id, inner.id);

    assert.equal(result, null);
    assert.equal(service.pathOf(inner.id), 'outer/inner');
  });

  test('a corrupt parent link is re-rooted and reported, not fatal', async () => {
    const store = new MemoryWorkspaceStore({
      files: [persisted({ id: 'doc-1', name: 'lost.py', parentId: 'folder-that-vanished' })],
      folders: [],
      state: { activeFileId: null, theme: 'vs-dark' },
    });
    const { service } = makeService(store);

    await service.open();

    assert.equal(service.pathOf('doc-1'), 'lost.py');
    assert.equal(service.tree.repairs.length, 1);
    assert.equal(service.tree.repairs[0].kind, 'missing_parent');
  });
});

describe('naming', () => {
  test('a new file is uniquified against files that are not open', async () => {
    // N-03: the old rename checked open tabs only, so renaming onto a file that
    // existed in storage but was closed produced two files at one path.
    const store = new MemoryWorkspaceStore({
      files: [persisted({ id: 'existing', name: 'main.py' })],
      folders: [],
      state: { activeFileId: null, theme: 'vs-dark' },
    });
    const { service } = makeService(store);
    await service.open();

    const created = await service.createDocument({ name: 'main.py', language: 'python', version: 'python3' });

    assert.equal(created.name, 'main_1.py');
  });

  test('renaming onto an existing name is uniquified', async () => {
    const { service } = makeService();
    await service.open();
    await service.createDocument({ name: 'taken.py', language: 'python', version: 'python3' });
    const other = await service.createDocument({ name: 'other.py', language: 'python', version: 'python3' });

    await service.renameDocument(other.id, 'taken.py');

    assert.equal(other.name, 'taken_1.py');
  });

  test('a case-only collision is treated as a collision', async () => {
    // V-14. The container is Linux and authors are on Windows and macOS, so a
    // workspace holding both names works in exactly one of those places.
    const { service } = makeService();
    await service.open();
    await service.createDocument({ name: 'Main.py', language: 'python', version: 'python3' });

    const second = await service.createDocument({ name: 'main.py', language: 'python', version: 'python3' });

    assert.equal(second.name, 'main_1.py');
    assert.equal(findCollisionCount(service), 0);
  });

  test('a file cannot take a sibling folder name', async () => {
    // "pkg" and "pkg/mod.py" cannot both exist; the server rejects the pair.
    const { service } = makeService();
    await service.open();
    await service.createFolder('pkg');

    const document = await service.createDocument({ name: 'pkg', language: 'python', version: 'python3' });

    assert.notEqual(document.name, 'pkg');
  });

  test('renaming keeps content untouched', async () => {
    const { service } = makeService();
    await service.open();
    const document = await service.createDocument({
      name: 'a.py',
      language: 'python',
      version: 'python3',
      content: 'saved text',
    });
    document.setContent('unsaved edit');

    await service.renameDocument(document.id, 'b.py');

    assert.equal(document.getContent(), 'unsaved edit');
    assert.equal(document.isDirty, true);
  });
});

describe('language and version switching', () => {
  test('the command targets a document by id, not whatever is active', async () => {
    // V-11: the version selector captured the active tab, awaited twice, then
    // wrote the starter into `editor.getModel()` - the model active at that
    // later moment.
    const { service } = makeService();
    await service.open();
    const first = await service.createDocument({
      name: 'first.py',
      language: 'python',
      version: 'python3',
      content: 'first content',
    });
    const second = await service.createDocument({
      name: 'second.py',
      language: 'python',
      version: 'python3',
      content: 'second content',
    });

    await service.setDocumentLanguage(first.id, 'javascript', 'es2022', {
      content: 'starter for js',
      name: 'first.js',
    });

    assert.equal(first.getContent(), 'starter for js');
    assert.equal(second.getContent(), 'second content', 'the other document must be untouched');
    assert.equal(first.language, 'javascript');
    assert.equal(first.name, 'first.js');
  });

  test('two switches in flight each land on their own document', async () => {
    const { service } = makeService();
    await service.open();
    const a = await service.createDocument({ name: 'a.py', language: 'python', version: 'python3', content: 'a' });
    const b = await service.createDocument({ name: 'b.py', language: 'python', version: 'python3', content: 'b' });

    await Promise.all([
      service.setDocumentLanguage(a.id, 'javascript', 'es2022', { content: 'js starter' }),
      service.setDocumentLanguage(b.id, 'php', 'php8', { content: 'php starter' }),
    ]);

    assert.equal(a.getContent(), 'js starter');
    assert.equal(b.getContent(), 'php starter');
  });

  test('a switch without content preserves the user code', async () => {
    const { service } = makeService();
    await service.open();
    const document = await service.createDocument({
      name: 'x.py',
      language: 'python',
      version: 'python3',
      content: 'my work',
    });

    await service.setDocumentLanguage(document.id, 'python', 'python312');

    assert.equal(document.getContent(), 'my work');
    assert.equal(document.version, 'python312');
  });
});

describe('replaceAll', () => {
  test('builds folders from paths and opens no duplicates', async () => {
    const { service } = makeService();
    await service.open();

    const result = await service.replaceAll(
      [
        { path: 'main.py', content: 'main' },
        { path: 'src/utils/math.py', content: 'math' },
        { path: 'src/helper.py', content: 'helper' },
      ],
      resolveAlwaysPython,
    );

    assert.equal(result.documents.length, 3);
    const paths = service.snapshotForExecution().map(file => file.path);
    assert.deepEqual(paths, ['main.py', 'src/helper.py', 'src/utils/math.py']);
  });

  test('a failure leaves the previous workspace fully intact', async () => {
    // V-13, stated as an assertion. The old code called clearAll() first, so this
    // scenario ended with an empty workspace and a thrown error.
    const store = new MemoryWorkspaceStore(
      {
        files: [persisted({ id: 'keep-me', name: 'important.py', content: 'a term paper' })],
        folders: [],
        state: { activeFileId: null, theme: 'vs-dark' },
      },
      { failOn: operation => (operation === 'replaceAll' ? new Error('transaction aborted') : null) },
    );
    const { service } = makeService(store);
    await service.open();

    await assert.rejects(
      () => service.replaceAll([{ path: 'new.py', content: 'replacement' }], resolveAlwaysPython),
      /transaction aborted/,
    );

    assert.equal(store.peekContent('keep-me'), 'a term paper', 'storage must be untouched');
    assert.equal(service.getDocument('keep-me')?.getContent(), 'a term paper');
    assert.equal(service.allDocuments().length, 1);
  });

  test('an invalid host path is rejected before storage is touched', async () => {
    const store = new MemoryWorkspaceStore({
      files: [persisted({ id: 'keep-me', content: 'still here' })],
      folders: [],
      state: { activeFileId: null, theme: 'vs-dark' },
    });
    const { service } = makeService(store);
    await service.open();

    await assert.rejects(
      () => service.replaceAll([{ path: '../../etc/passwd', content: 'x' }], resolveAlwaysPython),
      /Invalid file path/,
    );

    assert.equal(store.peekContent('keep-me'), 'still here');
    assert.equal(store.countOperations('replaceAll'), 0);
  });

  test('a case-colliding host project is rejected, not silently collapsed', async () => {
    const { service } = makeService();
    await service.open();

    await assert.rejects(
      () =>
        service.replaceAll(
          [
            { path: 'Main.py', content: 'one' },
            { path: 'main.py', content: 'two' },
          ],
          resolveAlwaysPython,
        ),
      /conflicting paths/,
    );
  });

  test('an exactly duplicated host path is rejected', async () => {
    const { service } = makeService();
    await service.open();

    await assert.rejects(
      () =>
        service.replaceAll(
          [
            { path: 'main.py', content: 'one' },
            { path: 'main.py', content: 'two' },
          ],
          resolveAlwaysPython,
        ),
      /Duplicate file path/,
    );
  });

  test('re-sending the same project keeps document identity', async () => {
    // Preserves the editor model, undo history and the user's current tab. The
    // old implementation disposed and recreated everything on every host update.
    const { service } = makeService();
    await service.open();

    const first = await service.replaceAll(
      [
        { path: 'main.py', content: 'v1' },
        { path: 'other.py', content: 'same' },
      ],
      resolveAlwaysPython,
    );
    const originalIds = first.documents.map(document => document.id);

    const second = await service.replaceAll(
      [
        { path: 'main.py', content: 'v2' },
        { path: 'other.py', content: 'same' },
      ],
      resolveAlwaysPython,
    );

    assert.deepEqual(second.documents.map(document => document.id), originalIds);
    assert.equal(second.reused, 2);
    assert.equal(second.created, 0);
    assert.equal(service.findByPath('main.py')?.getContent(), 'v2');
  });

  test('a reused document is clean afterwards', async () => {
    const { service } = makeService();
    await service.open();
    await service.replaceAll([{ path: 'main.py', content: 'v1' }], resolveAlwaysPython);

    await service.replaceAll([{ path: 'main.py', content: 'v2' }], resolveAlwaysPython);

    const document = service.findByPath('main.py')!;
    assert.equal(document.isDirty, false, 'storage already holds this exact content');
  });

  test('files the host dropped are removed', async () => {
    const { service } = makeService();
    await service.open();
    await service.replaceAll(
      [
        { path: 'a.py', content: 'a' },
        { path: 'b.py', content: 'b' },
      ],
      resolveAlwaysPython,
    );

    const result = await service.replaceAll([{ path: 'a.py', content: 'a' }], resolveAlwaysPython);

    assert.equal(result.removed, 1);
    assert.equal(service.findByPath('b.py'), null);
    assert.equal(service.allDocuments().length, 1);
  });
});

describe('deletion', () => {
  test('a pending save cannot resurrect a deleted file', async () => {
    const { service, store } = makeService();
    await service.open();
    const document = await service.createDocument({ name: 'doomed.py', language: 'python', version: 'python3' });

    document.setContent('typed just before deleting');
    await service.deleteDocuments([document.id]);
    await settle();

    assert.equal(store.peekDocument(document.id), undefined);
  });

  test('deleting a folder removes its whole subtree', async () => {
    const { service, store } = makeService();
    await service.open();
    const src = await service.createFolder('src');
    const nested = await service.createFolder('nested', src.id);
    const inner = await service.createDocument({
      name: 'inner.py',
      parentId: nested.id,
      language: 'python',
      version: 'python3',
    });
    const outside = await service.createDocument({ name: 'keep.py', language: 'python', version: 'python3' });

    await service.deleteFolders([src.id]);

    assert.equal(service.getDocument(inner.id), null);
    assert.equal(store.peekDocument(inner.id), undefined);
    assert.equal(service.getDocument(outside.id)?.name, 'keep.py');
    assert.equal(service.getFolder(nested.id), null);
  });
});

describe('clearAll', () => {
  test('a queued save cannot recreate a file after the workspace is cleared', async () => {
    const { service, store } = makeService();
    await service.open();
    const document = await service.createDocument({ name: 'x.py', language: 'python', version: 'python3' });
    document.setContent('about to be discarded');

    await service.clearAll();
    await settle();

    assert.equal(service.allDocuments().length, 0);
    assert.equal(store.peekDocument(document.id), undefined);
  });
});

describe('execution snapshot', () => {
  test('unsaved edits are what a run sees', async () => {
    const { service } = makeService();
    await service.open();
    const document = await service.createDocument({
      name: 'main.py',
      language: 'python',
      version: 'python3',
      content: 'print(1)',
    });
    document.setContent('print(2)');

    const snapshot = service.snapshotForExecution();

    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].content, 'print(2)', 'a run must execute what the user can see');
    assert.equal(snapshot[0].path, 'main.py');
  });
});

function findCollisionCount(service: WorkspaceService): number {
  const paths = new Map<string, number>();
  for (const entry of service.entries()) {
    const key = entry.path.toLowerCase();
    paths.set(key, (paths.get(key) ?? 0) + 1);
  }
  return [...paths.values()].filter(count => count > 1).length;
}
