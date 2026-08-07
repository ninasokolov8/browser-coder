/**
 * Shared project snapshots.
 *
 * A share id is a capability: 128 random bits that only the publisher has seen, and
 * anyone holding it can read the project. So the tests that matter most are the ones
 * about what a link can and cannot reach - a path in a shared project is written into
 * somebody else's workspace, and they have even less reason than the publisher to
 * expect a file to land outside it.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ShareStore, parseShareId } from '../../server/shares/store.mjs';

const temporaries = [];
function readyStore(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bc-shares-'));
  temporaries.push(directory);
  const store = new ShareStore({
    directory,
    ttlMs: 60_000,
    maxBytes: 1024 * 1024,
    maxFiles: 10,
    sweepIntervalMs: 60_000,
    ...overrides,
  });
  store.start();
  return store;
}

after(() => {
  for (const directory of temporaries) {
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* fine */ }
  }
});

const project = files => ({ files, language: 'python', entryPoint: 'main.py' });

describe('ids', () => {
  test('only a 22-character URL-safe id parses', () => {
    assert.equal(parseShareId('A'.repeat(22)), 'A'.repeat(22));
    for (const bad of ['short', 'A'.repeat(23), 'A'.repeat(21), 'has/slash!!!!!!!!!!!!!', '', null, 42]) {
      assert.equal(parseShareId(bad), null, `accepted ${String(bad).slice(0, 24)}`);
    }
  });

  test('an id can never be a path, because it becomes a filename', () => {
    assert.equal(parseShareId('../../etc/passwd'), null);
    assert.equal(parseShareId('..'), null);
  });

  test('two publishes never collide', () => {
    const store = readyStore();
    const ids = new Set();
    for (let index = 0; index < 25; index++) {
      ids.add(store.publish(project([{ path: 'main.py', content: String(index) }])));
    }
    assert.equal(ids.size, 25);
    store.stop();
  });
});

describe('publishing and reading', () => {
  test('a project round-trips', () => {
    const store = readyStore();
    const id = store.publish(project([
      { path: 'main.py', content: 'print(1)', language: 'python', version: 'python3' },
      { path: 'lib/helper.py', content: 'x = 2', language: 'python' },
    ]));

    const read = store.read(id);
    assert.equal(read.version, 1);
    assert.equal(read.language, 'python');
    assert.equal(read.entryPoint, 'main.py');
    assert.deepEqual(read.files.map(file => file.path), ['main.py', 'lib/helper.py']);
    assert.equal(read.files[0].content, 'print(1)');
    store.stop();
  });

  test('a snapshot is immutable: publishing again is a different link', () => {
    // The whole value of sending one. A link always shows what was sent, so a student
    // who keeps working does not silently change what their teacher is looking at.
    const store = readyStore();
    const first = store.publish(project([{ path: 'main.py', content: 'v1' }]));
    const second = store.publish(project([{ path: 'main.py', content: 'v2' }]));

    assert.notEqual(first, second);
    assert.equal(store.read(first).files[0].content, 'v1');
    assert.equal(store.read(second).files[0].content, 'v2');
    store.stop();
  });

  test('an unknown or expired id reads as null', () => {
    const store = readyStore();
    assert.equal(store.read('A'.repeat(22)), null);
    assert.equal(store.read('nonsense'), null);
    store.stop();
  });
});

describe('what a shared project may contain', () => {
  test('a path that climbs out of the project is dropped', () => {
    /*
     * The files in a share are written into the workspace of whoever opens it. A
     * traversal here would put a file somewhere they did not choose - and unlike the
     * publisher, they never saw the project before opening it.
     */
    const store = readyStore();
    const id = store.publish(project([
      { path: 'main.py', content: 'ok' },
      { path: '../escape.py', content: 'no' },
      { path: 'a/../../escape.py', content: 'no' },
      { path: '/etc/passwd', content: 'no' },
    ]));

    const paths = store.read(id).files.map(file => file.path);
    assert.deepEqual(paths, ['main.py', 'etc/passwd']);
    assert.ok(!paths.some(path => path.includes('..')));
    store.stop();
  });

  test('a backslash path is normalised before it is checked', () => {
    // Otherwise `..\\escape.py` passes a check that only looks for forward slashes.
    const store = readyStore();
    const id = store.publish(project([
      { path: 'main.py', content: 'ok' },
      { path: '..\\escape.py', content: 'no' },
    ]));
    assert.deepEqual(store.read(id).files.map(file => file.path), ['main.py']);
    store.stop();
  });

  test('too many files is refused with a message a student can act on', () => {
    const store = readyStore({ maxFiles: 2 });
    assert.throws(
      () => store.publish(project([
        { path: 'a.py', content: '1' },
        { path: 'b.py', content: '2' },
        { path: 'c.py', content: '3' },
      ])),
      /at most 2 files/,
    );
    store.stop();
  });

  test('too large is refused', () => {
    const store = readyStore({ maxBytes: 10 });
    assert.throws(
      () => store.publish(project([{ path: 'a.py', content: 'x'.repeat(50) }])),
      /too large/,
    );
    store.stop();
  });

  test('an empty project is refused rather than published as a blank link', () => {
    const store = readyStore();
    assert.throws(() => store.publish(project([])), /nothing to share/);
    assert.throws(() => store.publish(project([{ path: '', content: 'x' }])), /nothing to share/);
    store.stop();
  });

  test('a file with no content is skipped, not stored as undefined', () => {
    const store = readyStore();
    const id = store.publish(project([
      { path: 'main.py', content: 'ok' },
      { path: 'broken.py' },
    ]));
    assert.deepEqual(store.read(id).files.map(file => file.path), ['main.py']);
    store.stop();
  });
});

describe('expiry', () => {
  test('a share is swept once it is older than its lifetime', () => {
    // A share is a message, not an archive.
    //
    // The file is aged EXPLICITLY rather than by setting a zero lifetime. A file
    // written and swept in the same millisecond depends on the filesystem's timestamp
    // granularity - which is coarse on NTFS - so the zero-lifetime version passed
    // alone and failed under a full parallel run. A test that depends on clock
    // resolution is a test that will fail on somebody else's machine.
    const store = readyStore({ ttlMs: 1000 });
    const id = store.publish(project([{ path: 'main.py', content: 'x' }]));

    const file = join(store.root, readdirSync(store.root)[0]);
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);

    assert.equal(store.sweep().removed, 1);
    assert.equal(store.read(id), null);
    store.stop();
  });

  test('reading does not extend a share, because its author expected it to expire', () => {
    const store = readyStore({ ttlMs: 1000 });
    const id = store.publish(project([{ path: 'main.py', content: 'x' }]));

    // Age it past the cutoff, then read it - mtime must not move.
    const file = join(store.root, readdirSync(store.root)[0]);
    const past = new Date(Date.now() - 60_000);
    utimesSync(file, past, past);

    store.read(id);
    assert.equal(store.sweep().removed, 1);
    store.stop();
  });

  test('an unconfigured store refuses to publish and reads null', () => {
    const store = new ShareStore({
      directory: null, ttlMs: 1, maxBytes: 1, maxFiles: 1, sweepIntervalMs: 1,
    });
    store.start();

    assert.equal(store.isReady, false);
    assert.throws(() => store.publish(project([{ path: 'a.py', content: 'x' }])), /not available/);
    assert.equal(store.read('A'.repeat(22)), null);
  });
});
