/**
 * Browser smoke test for the workspace domain.
 *
 * Verifies the seams the node tests structurally cannot reach:
 *
 * - a Monaco model really becomes the document's authoritative buffer, so typing
 *   in the editor is observed by the persistence coordinator with no glue code
 * - a rename really re-points the URI, and carries the text across
 * - real IndexedDB really round-trips a workspace across a close and reopen
 * - `replaceAll` really preserves model identity for unchanged paths
 *
 * Written as plain assertions reporting into the DOM, so a headless browser can
 * run it with `--dump-dom` and no CDP client.
 */

import * as monaco from 'monaco-editor';

import { createWorkspace } from '../../src/workspace/index.ts';
import { IndexedDbWorkspaceStore } from '../../src/workspace/store-indexeddb.ts';
import { WorkspaceService } from '../../src/workspace/service.ts';
import { MonacoModelRegistry } from '../../src/workspace/monaco/model-registry.ts';

/** Kept in step with tests/browser/receiver.mjs. */
const RECEIVER_PORT = 5200;

const lines: string[] = [];
let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    lines.push(`PASS ${name}`);
  } else {
    failures += 1;
    lines.push(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function equal(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const LANGUAGES = {
  monacoLanguageFor: (languageId: string) => (languageId === 'python' ? 'python' : 'plaintext'),
};

async function run(): Promise<void> {
  const databaseName = `SmokeDB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const workspace = createWorkspace({ databaseName, languages: LANGUAGES, autoSaveDelayMs: 20 });
  const { service, models } = workspace;

  await service.open();

  // ===== the Monaco model is the working copy =====

  const folder = await service.createFolder('src');
  const document = await service.createDocument({
    name: 'main.py',
    parentId: folder.id,
    language: 'python',
    version: 'python3',
    content: 'print("one")',
  });

  equal('path is derived without a leading slash', service.pathOf(document.id), 'src/main.py');

  const model = models.acquire(document);
  equal('model URI is the real workspace path', model.uri.toString(), 'file:///workspace/src/main.py');
  equal('model starts with the document content', model.getValue(), 'print("one")');
  check('acquiring a model leaves the document clean', !document.isDirty);

  // Typing into the EDITOR must be seen by the DOCUMENT with no glue.
  model.setValue('print("two")');
  equal('editing the model changes the document', document.getContent(), 'print("two")');
  check('editing the model marks the document dirty', document.isDirty);

  await service.flush(document.id);
  check('flush clears dirty', !document.isDirty);

  // ===== autosave fires on its own =====

  model.setValue('print("autosaved")');
  await new Promise(resolve => setTimeout(resolve, 200));
  check('debounced autosave persists without an explicit flush', !document.isDirty);

  // ===== rename re-points the URI and keeps the text =====

  await service.renameDocument(document.id, 'renamed.py');
  models.sync(document);
  const renamedModel = models.peek(document.id)!;
  equal(
    'rename re-points the model URI',
    renamedModel.uri.toString(),
    'file:///workspace/src/renamed.py',
  );
  equal('rename preserves the text', document.getContent(), 'print("autosaved")');
  check('the pre-rename model is disposed', model.isDisposed());

  // Editing through the NEW model must still reach the document.
  renamedModel.setValue('print("after rename")');
  equal('the new model is wired to the document', document.getContent(), 'print("after rename")');
  await service.flush(document.id);

  // ===== a folder rename repaths without touching the document =====

  await service.renameFolder(folder.id, 'lib');
  equal('folder rename repaths the document', service.pathOf(document.id), 'lib/renamed.py');
  equal('folder rename preserves content', document.getContent(), 'print("after rename")');

  // ===== real IndexedDB round trip =====

  await service.flushAll();
  service.dispose();

  const reopenedStore = new IndexedDbWorkspaceStore(databaseName);
  const reopened = new WorkspaceService({ store: reopenedStore, autoSaveDelayMs: 20 });
  await reopened.open();

  const restored = reopened.findByPath('lib/renamed.py');
  check('the workspace survives a close and reopen', restored !== null);
  equal('content survives the reopen', restored?.getContent(), 'print("after rename")');
  check('a restored document is clean', restored ? !restored.isDirty : false);

  // ===== replaceAll preserves identity for unchanged paths =====

  const first = await reopened.replaceAll(
    [
      { path: 'main.py', content: 'v1' },
      { path: 'keep.py', content: 'unchanged' },
    ],
    { resolve: () => ({ id: 'python', version: 'python3' }) },
  );
  const firstIds = first.documents.map(candidate => candidate.id).sort();

  const reopenedModels = new MonacoModelRegistry(reopened, LANGUAGES);
  const keepDocument = reopened.findByPath('keep.py')!;
  const keepModel = reopenedModels.acquire(keepDocument);

  const second = await reopened.replaceAll(
    [
      { path: 'main.py', content: 'v2' },
      { path: 'keep.py', content: 'unchanged' },
    ],
    { resolve: () => ({ id: 'python', version: 'python3' }) },
  );

  const secondIds = second.documents.map(candidate => candidate.id).sort();
  check('replaceAll keeps document identity', JSON.stringify(firstIds) === JSON.stringify(secondIds));
  equal('replaceAll reused every path', second.reused, 2);
  check('an untouched model is NOT disposed by replaceAll', !keepModel.isDisposed());
  equal('replaceAll applies new content', reopened.findByPath('main.py')?.getContent(), 'v2');

  // ===== a failed replaceAll leaves the workspace intact =====

  let rejected = false;
  try {
    await reopened.replaceAll(
      [
        { path: 'Clash.py', content: 'a' },
        { path: 'clash.py', content: 'b' },
      ],
      { resolve: () => ({ id: 'python', version: 'python3' }) },
    );
  } catch {
    rejected = true;
  }
  check('a case-colliding project is rejected', rejected);
  equal(
    'the workspace is untouched after a rejected replace',
    reopened.findByPath('main.py')?.getContent(),
    'v2',
  );

  reopened.dispose();
  indexedDB.deleteDatabase(databaseName);

  // Monaco must be genuinely loaded, or every model assertion above would have
  // been vacuous.
  check('monaco is really loaded', typeof monaco.editor.createModel === 'function');
}

run()
  .then(() => {
    lines.push(failures === 0 ? 'SMOKE RESULT: ALL PASSED' : `SMOKE RESULT: ${failures} FAILED`);
  })
  .catch(error => {
    // Counted as a failure, not merely reported. Without this the run printed the
    // stack trace and then announced PASSED, because `failures` was still 0 -
    // a harness that reports success on an exception is worse than no harness.
    failures += 1;
    lines.push(`FAIL threw: ${error?.stack || error}`);
    lines.push('SMOKE RESULT: THREW');
  })
  .finally(async () => {
    document.getElementById('results')!.textContent = lines.join('\n');
    document.title = failures === 0 ? 'smoke-ok' : 'smoke-failed';

    // Report to the receiver, which is what decides the run's exit code. Kept
    // best-effort so the page is still readable by hand when opened in a browser
    // with no receiver running.
    try {
      await fetch(`http://127.0.0.1:${RECEIVER_PORT}/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, failures }),
      });
    } catch {
      /* opened manually - the DOM already shows the results */
    }
  });
