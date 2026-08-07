/**
 * The preview store: publishing atomically, expiring, and staying inside its cap.
 *
 * The class was untested. `PreviewStore` was extracted from server.mjs precisely so it
 * could be constructed against a temporary directory instead of only through a spawned
 * process, and then nothing took it up - so the sweep, which deletes student work, ran
 * only in production.
 *
 * The cap is the part worth the most care. It is the one operation here that removes a
 * preview a student did NOT ask to remove, so the tests below pin both directions: that
 * it evicts when over, and that it does nothing at all when it is off - which is the
 * default, and therefore what every existing deployment is relying on.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readdirSync, utimesSync, statSync, writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PreviewStore } from '../../server/previews/store.mjs';
import { PREVIEW_MANIFEST_NAME } from '../../server/previews/project.mjs';

const temporaries = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'bc-previews-'));
  temporaries.push(dir);
  return dir;
}

after(() => {
  for (const dir of temporaries) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
});

const BASE_LIMITS = {
  maxPathChars: 300,
  maxFileCount: 50,
  maxHtmlBytes: 1_000_000,
  ttlMs: 60_000,
  cleanupIntervalMs: 60_000,
  maxStorageBytes: 0,
};

function storeIn(dir, overrides = {}) {
  return new PreviewStore({
    storageDir: dir,
    limits: { ...BASE_LIMITS, ...overrides },
    log: () => {},
  });
}

/** Publish a preview of roughly `bytes`, then backdate it so ordering is deterministic. */
async function publishAged(store, dir, bytes, ageMs) {
  const id = await store.publish(
    [{ path: 'index.html', content: 'x'.repeat(bytes) }],
    'index.html',
  );

  /*
   * The age is set explicitly rather than by sleeping. An earlier test in this project
   * relied on timestamp granularity and passed alone while failing under parallel load;
   * on NTFS in particular, two files written in the same millisecond are the same age.
   *
   * Both signals are moved, because the store reads the manifest date and falls back to
   * mtime - setting only one would leave the test passing on the fallback and prove
   * nothing about the path that actually runs.
   */
  const createdAt = Date.now() - ageMs;
  const manifestPath = join(dir, id, PREVIEW_MANIFEST_NAME);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, createdAt }));

  const when = new Date(createdAt);
  utimesSync(join(dir, id), when, when);
  return id;
}

describe('publishing', () => {
  test('a published project is readable and its manifest describes it', async () => {
    const dir = scratch();
    const store = storeIn(dir);

    const id = await store.publish(
      [{ path: 'index.html', content: '<h1>hi</h1>' }, { path: 'js/app.js', content: 'let a=1' }],
      'index.html',
    );

    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(existsSync(join(dir, id, 'index.html')), true);
    assert.equal(existsSync(join(dir, id, 'js', 'app.js')), true);

    const manifest = await store.readManifest(id);
    assert.equal(manifest.entryPath, 'index.html');
    assert.equal(manifest.fileCount, 2);
  });

  test('nothing is left behind when a publish fails', async () => {
    const dir = scratch();
    const store = storeIn(dir);

    // Two files normalizing to one path collide under `flag: 'wx'`.
    await assert.rejects(
      store.publish(
        [{ path: 'a.html', content: '1' }, { path: './a.html', content: '2' }],
        'a.html',
      ),
    );

    // Not even the temporary directory: a half-written preview is never addressable.
    assert.deepEqual(readdirSync(dir), []);
  });
});

describe('expiry', () => {
  test('an expired preview is swept and a fresh one is not', async () => {
    const dir = scratch();
    const store = storeIn(dir, { ttlMs: 1000 });

    const old = await publishAged(store, dir, 10, 60_000);
    const fresh = await publishAged(store, dir, 10, 0);

    await store.cleanupExpired();
    assert.equal(existsSync(join(dir, old)), false, 'past the TTL');
    assert.equal(existsSync(join(dir, fresh)), true, 'and inside it');
  });

  test('the manifest date decides, not the directory mtime', async () => {
    const dir = scratch();
    const store = storeIn(dir, { ttlMs: 1000 });

    const id = await store.publish([{ path: 'index.html', content: 'hi' }], 'index.html');

    // Only the mtime is moved. A volume restore or a `cp -r` does exactly this to every
    // preview at once, and it must not expire a student's whole term of work.
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    utimesSync(join(dir, id), ancient, ancient);

    await store.cleanupExpired();
    assert.equal(existsSync(join(dir, id)), true);
  });
});

describe('the storage cap', () => {
  test('off by default, so an existing deployment is unaffected', async () => {
    const dir = scratch();
    const store = storeIn(dir); // maxStorageBytes: 0

    const ids = [];
    for (let index = 0; index < 4; index++) {
      ids.push(await publishAged(store, dir, 5000, (4 - index) * 10_000));
    }

    await store.enforceStorageCap();
    for (const id of ids) assert.equal(existsSync(join(dir, id)), true);
  });

  test('under the cap, nothing is removed', async () => {
    const dir = scratch();
    const store = storeIn(dir, { maxStorageBytes: 1_000_000 });

    const id = await publishAged(store, dir, 5000, 0);
    await store.enforceStorageCap();
    assert.equal(existsSync(join(dir, id)), true);
  });

  test('over the cap, the oldest go first and enough go to get under it', async () => {
    const dir = scratch();
    // Four previews of ~5 KB each; room for two.
    const store = storeIn(dir, { maxStorageBytes: 12_000 });

    const oldest = await publishAged(store, dir, 5000, 40_000);
    const older = await publishAged(store, dir, 5000, 30_000);
    const newer = await publishAged(store, dir, 5000, 20_000);
    const newest = await publishAged(store, dir, 5000, 10_000);

    await store.enforceStorageCap();

    assert.equal(existsSync(join(dir, oldest)), false, 'oldest evicted');
    assert.equal(existsSync(join(dir, older)), false, 'then the next oldest');
    assert.equal(existsSync(join(dir, newer)), true, 'and it stops once under the cap');
    assert.equal(existsSync(join(dir, newest)), true);
  });

  test('a directory is measured by what is inside it, not by its own inode', async () => {
    const dir = scratch();
    const store = storeIn(dir, { maxStorageBytes: 4000 });

    /*
     * A preview is a tree. Sizing it with a single stat() reports the directory entry -
     * a few hundred bytes on most filesystems, zero on some - so a cap implemented that
     * way would never fire no matter how much a student published.
     */
    const id = await store.publish(
      [
        { path: 'index.html', content: 'x'.repeat(3000) },
        { path: 'assets/big.css', content: 'y'.repeat(3000) },
      ],
      'index.html',
    );

    await store.enforceStorageCap();
    assert.equal(existsSync(join(dir, id)), false, '6 KB of files under a 4 KB cap');
  });

  test('the cap runs as part of the ordinary sweep', async () => {
    const dir = scratch();
    const store = storeIn(dir, { maxStorageBytes: 6000, ttlMs: 600_000 });

    const oldest = await publishAged(store, dir, 5000, 40_000);
    const newest = await publishAged(store, dir, 5000, 10_000);

    // Neither is expired; only the cap can remove anything here.
    await store.cleanupExpired();

    assert.equal(existsSync(join(dir, oldest)), false);
    assert.equal(existsSync(join(dir, newest)), true);
  });

  test('an unrelated file in the storage directory is never touched', async () => {
    const dir = scratch();
    const store = storeIn(dir, { maxStorageBytes: 1 });

    // Not a preview id, so not ours to delete - the sweep must not treat the storage
    // directory as though everything in it belongs to it.
    const stray = join(dir, 'README.txt');
    writeFileSync(stray, 'z'.repeat(100));

    await store.enforceStorageCap();
    assert.equal(existsSync(stray), true);
    assert.equal(statSync(stray).size, 100);
  });
});
