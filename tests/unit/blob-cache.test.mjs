/**
 * The asset cache: digests, the store, and turning a digest back into content.
 *
 * The security property is the one to hold onto. A shared content-addressed cache is
 * safe only because the name is DERIVED from the content - so if anything here ever
 * accepted a client's claim about what it was uploading, the next student whose project
 * legitimately contained that digest would run somebody else's file instead of their
 * own image.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

import {
  DIGEST_PATTERN,
  createDigestSink,
  digestOfBuffer,
  parseDigest,
  relativePathFor,
} from '../../server/blobs/digest.mjs';
import { BlobStore } from '../../server/blobs/store.mjs';
import { digestsIn, resolveBlobFiles } from '../../server/blobs/resolve.mjs';

const temporaries = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'bc-blobs-'));
  temporaries.push(dir);
  return dir;
}

after(() => {
  for (const dir of temporaries) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
});

describe('digests', () => {
  test('a digest is the sha256 of the bytes, and matches node', () => {
    const bytes = Buffer.from('hello');
    const expected = `sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(digestOfBuffer(bytes), expected);
    assert.match(digestOfBuffer(bytes), DIGEST_PATTERN);
  });

  test('the streaming sink agrees with the one-shot form', () => {
    const sink = createDigestSink();
    sink.update(Buffer.from('hel'));
    sink.update(Buffer.from('lo'));
    assert.equal(sink.digest(), digestOfBuffer(Buffer.from('hello')));
    assert.equal(sink.bytes, 5);
  });

  test('only a well-formed token parses', () => {
    assert.ok(parseDigest(digestOfBuffer(Buffer.from('x'))));
    for (const bad of [
      'sha256-XYZ',
      `sha256-${'a'.repeat(63)}`,
      `sha256-${'a'.repeat(65)}`,
      `SHA256-${'a'.repeat(64)}`,
      `sha256-${'A'.repeat(64)}`,
      `md5-${'a'.repeat(64)}`,
      '',
      null,
      42,
    ]) {
      assert.equal(parseDigest(bad), null, `accepted ${String(bad).slice(0, 20)}`);
    }
  });

  test('a token can never become a traversal, because it becomes a filename', () => {
    /*
     * The reason the pattern is anchored, lowercase-only and fixed-length. This string
     * is joined onto a path, so anything the parser accepts is something an attacker
     * can write to.
     */
    for (const attack of [
      '../../etc/passwd',
      'sha256-../../../etc/passwd',
      `sha256-${'a'.repeat(60)}/../x`,
      'sha256-..',
    ]) {
      assert.equal(parseDigest(attack), null);
      assert.equal(relativePathFor(attack), null);
    }
  });

  test('paths fan out two levels, so one directory never holds everything', () => {
    const digest = `sha256-${'ab'}${'cd'}${'0'.repeat(60)}`;
    assert.deepEqual(relativePathFor(digest), ['ab', 'cd', digest]);
  });
});

describe('the store', () => {
  function readyStore(overrides = {}) {
    const store = new BlobStore({
      directory: scratch(),
      maxBytes: 1024 * 1024,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
      ...overrides,
    });
    store.start();
    return store;
  }

  test('write, has, read', () => {
    const store = readyStore();
    const bytes = Buffer.from('an image, pretend');
    const digest = digestOfBuffer(bytes);

    assert.equal(store.has(digest), false);
    assert.equal(store.write(digest, bytes), true);
    assert.equal(store.has(digest), true);
    assert.deepEqual(store.read(digest), bytes);
    store.stop();
  });

  test('writing the same content twice is not an error and does not tear', () => {
    // Two students importing the same starter image is the normal case, not an edge.
    const store = readyStore();
    const bytes = Buffer.from('shared');
    const digest = digestOfBuffer(bytes);

    assert.equal(store.write(digest, bytes), true);
    assert.equal(store.write(digest, bytes), true);
    assert.deepEqual(store.read(digest), bytes);
    store.stop();
  });

  test('an unconfigured store is not ready and refuses everything, quietly', () => {
    // The whole degraded mode: not ready means every run sends its assets inline, and
    // nothing else in the system has to know.
    const store = new BlobStore({ directory: null, maxBytes: 1, ttlMs: 1, sweepIntervalMs: 1 });
    store.start();

    assert.equal(store.isReady, false);
    assert.equal(store.pathOf(digestOfBuffer(Buffer.from('x'))), null);
    assert.equal(store.has(digestOfBuffer(Buffer.from('x'))), false);
    assert.equal(store.read(digestOfBuffer(Buffer.from('x'))), null);
    assert.equal(store.write(digestOfBuffer(Buffer.from('x')), Buffer.from('x')), false);
  });

  test('reading something absent gives null rather than throwing', () => {
    // Absent is ordinary: the sweeper may remove an entry between the client's check
    // and the run that needs it.
    const store = readyStore();
    assert.equal(store.read(digestOfBuffer(Buffer.from('never stored'))), null);
    store.stop();
  });

  test('the sweeper evicts what is expired', () => {
    const store = readyStore({ ttlMs: -1 });
    const bytes = Buffer.from('cold');
    const digest = digestOfBuffer(bytes);
    store.write(digest, bytes);

    const swept = store.sweep();
    assert.equal(swept.removed, 1);
    assert.equal(store.has(digest), false);
    store.stop();
  });

  test('the sweeper enforces the size cap, coldest first', () => {
    const store = readyStore({ maxBytes: 10 });
    const older = Buffer.from('aaaaaaaaaa');
    const newer = Buffer.from('bbbbbbbbbb');
    store.write(digestOfBuffer(older), older);
    store.write(digestOfBuffer(newer), newer);

    // Make the first genuinely colder than the second.
    const target = store.pathOf(digestOfBuffer(older));
    const past = new Date(Date.now() - 60_000);
    utimesSync(target, past, past);

    store.sweep();
    assert.equal(store.has(digestOfBuffer(older)), false, 'the cold one should go first');
    assert.equal(store.has(digestOfBuffer(newer)), true);
    store.stop();
  });

  test('a stray file that is not a digest is left alone by the sweeper', () => {
    // The directory is shared. Deleting things it does not recognise is not its job.
    const store = readyStore({ ttlMs: -1 });
    const stray = join(store.root, 'ab', 'cd');
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, 'notes.txt'), 'hello');

    store.sweep();
    assert.equal(existsSync(join(stray, 'notes.txt')), true);
    store.stop();
  });
});

describe('resolving a run payload', () => {
  function readyStore() {
    const store = new BlobStore({
      directory: scratch(),
      maxBytes: 1024 * 1024,
      ttlMs: 60_000,
      sweepIntervalMs: 60_000,
    });
    store.start();
    return store;
  }

  test('a digest becomes base64 content, which is what an asset has always been', () => {
    const store = readyStore();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const digest = digestOfBuffer(bytes);
    store.write(digest, bytes);

    const outcome = resolveBlobFiles(
      [{ path: 'logo.png', digest, language: 'asset' }],
      store,
    );

    assert.equal(outcome.missing, undefined);
    assert.equal(outcome.files[0].content, bytes.toString('base64'));
    store.stop();
  });

  test('a file with content is untouched', () => {
    const store = readyStore();
    const files = [{ path: 'main.py', content: 'print(1)' }];
    assert.deepEqual(resolveBlobFiles(files, store).files, files);
    store.stop();
  });

  test('content wins over a digest, so a client that sends both is always right', () => {
    const store = readyStore();
    const outcome = resolveBlobFiles(
      [{ path: 'a.png', content: 'aGk=', digest: digestOfBuffer(Buffer.from('other')) }],
      store,
    );
    assert.equal(outcome.files[0].content, 'aGk=');
    store.stop();
  });

  test('an uncached digest is reported so the client can upload it', () => {
    const store = readyStore();
    const digest = digestOfBuffer(Buffer.from('never uploaded'));
    const outcome = resolveBlobFiles([{ path: 'a.png', digest }], store);

    assert.deepEqual(outcome.missing, [digest]);
    assert.equal(outcome.files, undefined);
    store.stop();
  });

  test('a malformed digest is treated as missing, not as an error', () => {
    // The client is asked for the bytes, which is the right outcome and needs no
    // error path of its own.
    const store = readyStore();
    const outcome = resolveBlobFiles([{ path: 'a.png', digest: 'nonsense' }], store);
    assert.equal(outcome.missing.length, 1);
    store.stop();
  });

  test('with no store at all, every digest is missing', () => {
    const digest = digestOfBuffer(Buffer.from('x'));
    assert.deepEqual(resolveBlobFiles([{ path: 'a.png', digest }], null).missing, [digest]);
  });

  test('the same digest twice is reported once', () => {
    const digest = digestOfBuffer(Buffer.from('x'));
    const outcome = resolveBlobFiles(
      [{ path: 'a.png', digest }, { path: 'b.png', digest }],
      null,
    );
    assert.deepEqual(outcome.missing, [digest]);
  });

  test('digestsIn lists what a payload refers to, deduplicated', () => {
    const one = digestOfBuffer(Buffer.from('1'));
    const two = digestOfBuffer(Buffer.from('2'));
    assert.deepEqual(
      digestsIn([{ digest: one }, { digest: two }, { digest: one }, { content: 'x' }]).sort(),
      [one, two].sort(),
    );
  });
});

describe('the client and the server compute the same digest', () => {
  test('byte-identical to the server, for every shape of content', async () => {
    /*
     * The one agreement the whole feature rests on.
     *
     * The client names the bytes and the server verifies the name against what it
     * received. If the two implementations ever disagree - a different algorithm, a
     * different prefix, a different hex case - every upload is rejected as a mismatch
     * and the cache silently never works, while looking configured.
     */
    const { digestToken } = await import('../../src/workspace/content-hash.ts');

    const samples = [
      Buffer.from(''),
      Buffer.from('hello'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('שלום', 'utf8'),
      Buffer.from(Array.from({ length: 5000 }, (_, index) => index % 256)),
    ];

    for (const sample of samples) {
      const fromClient = await digestToken(new Uint8Array(sample));
      assert.equal(fromClient, digestOfBuffer(sample), `disagreed for ${sample.length} bytes`);
    }
  });

  test('no secure context means no digest, and never an exception', async () => {
    // `crypto.subtle` is absent over plain HTTP to a routable IP - which is how this
    // is deployed today. Throwing there would break the Run button.
    const { supportsContentHash } = await import('../../src/workspace/content-hash.ts');
    assert.equal(typeof supportsContentHash(), 'boolean');
  });
});
