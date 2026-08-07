/**
 * The asset cache over HTTP: upload once, run many times.
 *
 * The unit tests cover the digest, the store and the payload resolution. What this
 * proves is the part they cannot: that a run whose asset is sent as a DIGEST produces
 * the same program behaviour as one that sends the bytes - the file must actually
 * appear in the job directory with the right content.
 *
 * And the security property, which is the reason content addressing is safe at all: the
 * server verifies what it RECEIVED rather than what the client claimed. Without that, a
 * shared cache is a way to hand one student a file another student will run.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { startServer } from './support/server.mjs';
import { requires } from './support/toolchain.mjs';

const digestOf = buffer =>
  `sha256-${crypto.createHash('sha256').update(buffer).digest('hex')}`;

/** A tiny but real PNG, so the asset validator sees correct magic bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('the asset cache', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  test('a fresh digest is reported as missing', async () => {
    const digest = digestOf(Buffer.from(`unique-${Date.now()}`));
    const response = await fetch(`${base}/api/blobs/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digests: [digest] }),
    });

    assert.equal(response.ok, true);
    const body = await response.json();
    if (!body.available) return; // no cache configured on this host; nothing to test
    assert.deepEqual(body.have, []);
  });

  test('upload, then the server says it has it', async () => {
    const bytes = Buffer.from(`content-${Date.now()}`);
    const digest = digestOf(bytes);

    const put = await fetch(`${base}/api/blobs/${digest}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (put.status === 503) return; // cache not configured
    assert.equal(put.status, 204);

    const check = await fetch(`${base}/api/blobs/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ digests: [digest] }),
    });
    assert.deepEqual((await check.json()).have, [digest]);
  });

  test('content that does not match its digest is REFUSED', async () => {
    /*
     * The security property, and the whole reason a shared content-addressed cache is
     * safe. If the server trusted the URL, anyone could store bytes of their choosing
     * under a name of their choosing - and the next student whose project legitimately
     * contained that digest would run the attacker's file instead of their own image.
     */
    const honest = digestOf(Buffer.from('what the client claims'));
    const response = await fetch(`${base}/api/blobs/${honest}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('something else entirely'),
    });

    if (response.status === 503) return;
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'blob_digest_mismatch');
  });

  test('a digest that is not one is refused before anything touches the filesystem', async () => {
    // The token becomes a filename, so anything accepted here is somewhere an attacker
    // can write.
    for (const bad of ['../../etc/passwd', 'sha256-short', 'nonsense']) {
      const response = await fetch(`${base}/api/blobs/${encodeURIComponent(bad)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('x'),
      });
      assert.ok(
        response.status === 400 || response.status === 404 || response.status === 503,
        `${bad} answered ${response.status}`,
      );
    }
  });

  test('there is no way to read a blob back out', async () => {
    /*
     * Deliberately absent. An anonymous, content-addressed, publicly-writable store
     * WITH a read route is a file host - anyone could put bytes in and hand the URL to
     * anyone else, on the school's domain.
     *
     * The bytes only ever come back inside a run, as a file in the student's own job
     * directory.
     */
    const bytes = Buffer.from(`readable-${Date.now()}`);
    const digest = digestOf(bytes);

    await fetch(`${base}/api/blobs/${digest}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });

    const read = await fetch(`${base}/api/blobs/${digest}`);
    assert.notEqual(read.status, 200, 'a GET route has appeared - this is now a file host');
  });

  test('a run whose asset is a digest behaves exactly like one that sends the bytes', requires('python'), async () => {
    const digest = digestOf(PNG);

    const put = await fetch(`${base}/api/blobs/${digest}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: PNG,
    });
    if (put.status === 503) return;

    const program = [
      'with open("logo.png", "rb") as handle:',
      '    print(len(handle.read()))',
    ].join('\n');

    const run = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        version: 'python3',
        entryPoint: 'main.py',
        files: [
          { name: 'main.py', path: 'main.py', isMain: true, content: program },
          // No `content`. This is the saving.
          { name: 'logo.png', path: 'logo.png', language: 'asset', version: 'png', digest },
        ],
      }),
    });

    const body = await run.json();
    assert.equal(body.exitCode, 0, `${body.stderr}\n${body.stdout}`);
    assert.equal(
      body.stdout.trim(),
      String(PNG.length),
      'the file the program read was not the asset that was uploaded',
    );
  });

  test('a run naming a digest the cache does not have is answered, not hung', async () => {
    // The backstop for an entry evicted between the client's check and the run. The
    // client uploads what is named and retries.
    const missing = digestOf(Buffer.from(`gone-${Date.now()}-${Math.random()}`));

    const run = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        version: 'python3',
        entryPoint: 'main.py',
        files: [
          { name: 'main.py', path: 'main.py', isMain: true, content: 'print(1)' },
          { name: 'logo.png', path: 'logo.png', language: 'asset', digest: missing },
        ],
      }),
    });

    assert.equal(run.status, 409);
    const body = await run.json();
    assert.equal(body.code, 'blob_missing');
    assert.deepEqual(body.missing, [missing]);
  });

  test('a run with inline content still works, and is unaffected', requires('python'), async () => {
    // The frozen v1 shape. Everything above is additive; this is the proof.
    const run = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        version: 'python3',
        entryPoint: 'main.py',
        files: [
          {
            name: 'main.py',
            path: 'main.py',
            isMain: true,
            content: 'with open("logo.png", "rb") as handle:\n    print(len(handle.read()))',
          },
          {
            name: 'logo.png',
            path: 'logo.png',
            language: 'asset',
            version: 'png',
            content: PNG.toString('base64'),
          },
        ],
      }),
    });

    const body = await run.json();
    assert.equal(body.exitCode, 0, body.stderr);
    assert.equal(body.stdout.trim(), String(PNG.length));
  });
});
