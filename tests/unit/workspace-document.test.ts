/**
 * WorkspaceDocument - the authoritative working copy.
 *
 * These tests pin the properties the old `Tab` shape could not hold: that dirty
 * is derived rather than assigned, that a metadata change cannot reach content,
 * and that a late-landing save cannot mark newer text as durable.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryBuffer } from '../../src/workspace/buffer.ts';
import { WorkspaceDocument } from '../../src/workspace/document.ts';
import { makeDocument, metadata } from './support/workspace-fixtures.ts';

describe('WorkspaceDocument dirty state', () => {
  test('a freshly loaded document is clean', () => {
    const document = makeDocument('print("hi")');
    assert.equal(document.isDirty, false);
    assert.equal(document.getContent(), 'print("hi")');
  });

  test('editing makes it dirty and advances the revision', () => {
    const document = makeDocument('a');
    const before = document.revision;

    document.setContent('ab');

    assert.equal(document.isDirty, true);
    assert.ok(document.revision > before, 'revision must advance on edit');
  });

  test('an assignment that changes nothing does not make it dirty', () => {
    // Otherwise every metadata refresh that round-tripped content would queue a
    // pointless write, and "dirty" would stop meaning anything to the user.
    const document = makeDocument('same');
    document.setContent('same');
    assert.equal(document.isDirty, false);
  });

  test('markSaved for the current revision clears dirty', () => {
    const document = makeDocument('a');
    document.setContent('ab');

    document.markSaved(document.revision);

    assert.equal(document.isDirty, false);
  });

  test('markSaved for a stale revision leaves it dirty', () => {
    // This is V-09 reduced to one assertion: the write persisted revision 2, but
    // revision 3 already exists, so the document is NOT in sync with storage.
    const document = makeDocument('a');
    document.setContent('ab');
    const inFlightRevision = document.revision;
    document.setContent('abc');

    document.markSaved(inFlightRevision);

    assert.equal(document.isDirty, true, 'newer edits must keep it dirty');
  });

  test('a late write cannot regress savedRevision', () => {
    const document = makeDocument('a');
    document.setContent('ab');
    const first = document.revision;
    document.setContent('abc');
    const second = document.revision;

    document.markSaved(second);
    document.markSaved(first); // out-of-order completion

    assert.equal(document.savedRevision, second);
    assert.equal(document.isDirty, false);
  });

  test('dirty changes are announced once per transition', () => {
    const document = makeDocument('a');
    const seen: boolean[] = [];
    document.onDidChangeDirty(doc => seen.push(doc.isDirty));

    document.setContent('ab');
    document.setContent('abc'); // still dirty - must not re-announce
    document.markSaved(document.revision);

    assert.deepEqual(seen, [true, false]);
  });
});

describe('WorkspaceDocument metadata', () => {
  test('renaming does not touch content', () => {
    // V-10: the old rename merged the persisted row with a name change and
    // assigned the result over the working copy, reverting unsaved text.
    const document = makeDocument('user typed this');
    document.setContent('user typed this, then more');

    document.applyMetadata({ name: 'renamed.py' });

    assert.equal(document.getContent(), 'user typed this, then more');
    assert.equal(document.name, 'renamed.py');
  });

  test('renaming a dirty document leaves it dirty', () => {
    const document = makeDocument('a');
    document.setContent('ab');

    document.applyMetadata({ name: 'other.py' });

    assert.equal(document.isDirty, true);
  });

  test('a metadata change that changes nothing is not announced', () => {
    const document = makeDocument('a');
    let events = 0;
    document.onDidChangeMetadata(() => events++);

    document.applyMetadata({ name: document.name });

    assert.equal(events, 0);
  });

  test('language and version travel together with the announcement', () => {
    const document = makeDocument('a');
    let observed: { from: string; to: string } | null = null;
    document.onDidChangeMetadata(event => {
      observed = { from: event.previous.language, to: event.current.language };
    });

    document.applyMetadata({ language: 'javascript', version: 'es2022' });

    assert.deepEqual(observed, { from: 'python', to: 'javascript' });
    assert.equal(document.version, 'es2022');
  });
});

describe('WorkspaceDocument buffer attachment', () => {
  test('opening a listed file in the editor preserves its content', () => {
    const document = makeDocument('from explorer');
    const editorBuffer = new MemoryBuffer('');

    document.attachBuffer(editorBuffer, { dirty: false });

    assert.equal(document.getContent(), 'from explorer');
    assert.equal(document.isDirty, false);
  });

  test('an unsaved file stays unsaved when it is opened', () => {
    const document = makeDocument('saved');
    document.setContent('unsaved edit');

    document.attachBuffer(new MemoryBuffer(''), { dirty: true });

    assert.equal(document.getContent(), 'unsaved edit');
    assert.equal(
      document.isDirty,
      true,
      'attaching an editor must not silently mark unsaved work as saved',
    );
  });

  test('edits in the new buffer are observed', () => {
    const document = makeDocument('a');
    const editorBuffer = new MemoryBuffer('a');
    document.attachBuffer(editorBuffer, { dirty: false });

    let changes = 0;
    document.onDidChangeContent(() => changes++);
    editorBuffer.setValue('ab');

    assert.equal(changes, 1);
    assert.equal(document.isDirty, true);
  });

  test('the old buffer is no longer observed', () => {
    const original = new MemoryBuffer('a');
    const document = new WorkspaceDocument({ metadata: metadata(), buffer: original });
    document.attachBuffer(new MemoryBuffer('a'), { dirty: false });

    let changes = 0;
    document.onDidChangeContent(() => changes++);
    original.setValue('stale writer');

    assert.equal(changes, 0);
    assert.equal(document.getContent(), 'a');
  });
});
