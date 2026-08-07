/**
 * The diagnostics store, and the staleness rule that is the point of it.
 *
 * Diagnostics arrive asynchronously - Monaco's TypeScript worker answers on its own
 * schedule, and a server compile error arrives a round trip after the code was sent.
 * By the time a result lands the document may have changed. Showing it anyway means
 * errors for code the user has already fixed, with line numbers pointing at the
 * wrong lines: worse than showing nothing, because the student trusts it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { DiagnosticsStore } from '../../src/diagnostics/store.ts';
import type { Diagnostic, DiagnosticSeverity } from '../../src/diagnostics/store.ts';

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    documentId: 'doc-1',
    path: 'main.ts',
    severity: 'error' as DiagnosticSeverity,
    message: 'something is wrong',
    line: 1,
    column: 1,
    source: 'ts',
    ...overrides,
  };
}

describe('revision binding', () => {
  test('a result for an older revision is discarded', () => {
    const store = new DiagnosticsStore();

    store.set('doc-1', 'ts', 10, [diagnostic({ message: 'current' })]);
    // A slow worker answering about revision 3, long after revision 10 exists.
    store.set('doc-1', 'ts', 3, [diagnostic({ message: 'stale' })]);

    const messages = store.forDocument('doc-1').map(item => item.message);
    assert.deepEqual(messages, ['current']);
  });

  test('a result for the same revision replaces, so a producer can correct itself', () => {
    const store = new DiagnosticsStore();

    store.set('doc-1', 'ts', 7, [diagnostic({ message: 'first pass' })]);
    store.set('doc-1', 'ts', 7, [diagnostic({ message: 'second pass' })]);

    assert.deepEqual(store.forDocument('doc-1').map(item => item.message), ['second pass']);
  });

  test('invalidate drops everything older than the current revision', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 4, [diagnostic()]);
    store.set('doc-1', 'server', 9, [diagnostic({ source: 'server', message: 'from a run' })]);

    // The user typed; the document is now at revision 9.
    store.invalidate('doc-1', 9);

    const remaining = store.forDocument('doc-1').map(item => item.source);
    assert.deepEqual(remaining, ['server'], 'only the up-to-date producer survives');
  });

  test('invalidate leaves current results alone', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 5, [diagnostic()]);

    store.invalidate('doc-1', 5);

    assert.equal(store.forDocument('doc-1').length, 1);
  });
});

describe('producers are kept apart', () => {
  test('two producers do not erase each other', () => {
    // Monaco reports type errors continuously; the server reports compile errors
    // only after a run. Merged into one list per document, whichever answered last
    // would erase the other's findings.
    const store = new DiagnosticsStore();

    store.set('doc-1', 'ts', 1, [diagnostic({ source: 'ts', message: 'type error' })]);
    store.set('doc-1', 'server', 1, [diagnostic({ source: 'server', message: 'compile error' })]);

    assert.equal(store.forDocument('doc-1').length, 2);
  });

  test('clearing one producer leaves the other', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 1, [diagnostic({ source: 'ts' })]);
    store.set('doc-1', 'server', 1, [diagnostic({ source: 'server' })]);

    store.clear('doc-1', 'ts');

    assert.deepEqual(store.forDocument('doc-1').map(item => item.source), ['server']);
  });

  test('an empty list means clean, which is not the same as having no opinion', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 1, [diagnostic()]);

    store.set('doc-1', 'ts', 2, []);
    assert.equal(store.forDocument('doc-1').length, 0);

    // And clearing entirely is also empty - the difference matters to the producer,
    // not to the reader.
    store.clear('doc-1');
    assert.equal(store.forDocument('doc-1').length, 0);
  });
});

describe('ordering and grouping', () => {
  test('errors come before warnings, then by position', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 1, [
      diagnostic({ severity: 'warning', line: 1, message: 'w1' }),
      diagnostic({ severity: 'error', line: 40, message: 'e40' }),
      diagnostic({ severity: 'error', line: 2, column: 9, message: 'e2b' }),
      diagnostic({ severity: 'error', line: 2, column: 1, message: 'e2a' }),
    ]);

    assert.deepEqual(
      store.forDocument('doc-1').map(item => item.message),
      ['e2a', 'e2b', 'e40', 'w1'],
    );
  });

  test('grouping by path is stable and sorted', () => {
    const store = new DiagnosticsStore();
    store.set('b', 'ts', 1, [diagnostic({ documentId: 'b', path: 'src/b.ts' })]);
    store.set('a', 'ts', 1, [diagnostic({ documentId: 'a', path: 'src/a.ts' })]);

    assert.deepEqual(store.groupedByPath().map(group => group.path), ['src/a.ts', 'src/b.ts']);
  });
});

describe('counts and the run gate', () => {
  test('counts are broken down by severity', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 1, [
      diagnostic({ severity: 'error' }),
      diagnostic({ severity: 'error' }),
      diagnostic({ severity: 'warning' }),
      diagnostic({ severity: 'info' }),
    ]);

    assert.deepEqual(store.counts(), { error: 2, warning: 1, info: 1, total: 4 });
  });

  test('only errors block a run', () => {
    // A warning that blocked Run would make the IDE unusable for a beginner, whose
    // code is full of them.
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 1, [diagnostic({ severity: 'warning' })]);
    assert.equal(store.hasErrors(), false);

    store.set('doc-1', 'ts', 2, [diagnostic({ severity: 'error' })]);
    assert.equal(store.hasErrors(), true);
  });

  test('an empty store reports zero rather than throwing', () => {
    const store = new DiagnosticsStore();
    assert.deepEqual(store.counts(), { error: 0, warning: 0, info: 0, total: 0 });
    assert.equal(store.hasErrors(), false);
    assert.deepEqual(store.all(), []);
    assert.deepEqual(store.groupedByPath(), []);
  });
});

describe('change notification', () => {
  test('observers are told when anything changes', () => {
    const store = new DiagnosticsStore();
    let changes = 0;
    store.onDidChange(() => changes++);

    store.set('doc-1', 'ts', 1, [diagnostic()]);
    store.clear('doc-1');

    assert.equal(changes, 2);
  });

  test('a no-op does not notify', () => {
    // The status bar re-renders on every notification; firing for nothing makes it
    // flicker and hides real changes.
    const store = new DiagnosticsStore();
    let changes = 0;
    store.onDidChange(() => changes++);

    store.clear('never-existed');
    store.clearAll();
    store.invalidate('never-existed', 5);

    assert.equal(changes, 0);
  });

  test('a discarded stale result does not notify', () => {
    const store = new DiagnosticsStore();
    store.set('doc-1', 'ts', 10, [diagnostic()]);

    let changes = 0;
    store.onDidChange(() => changes++);
    store.set('doc-1', 'ts', 2, [diagnostic({ message: 'stale' })]);

    assert.equal(changes, 0, 'a dropped result must not redraw the panel');
  });
});
