/**
 * Serving the build-time compressed variant.
 *
 * The reason this exists is a measurement, not a preference: compressing the built
 * assets on the fly costs 179 ms of CPU for one cache-cold client of this build, on the
 * same container that runs student code. Pre-compressing moves that to CI and, with
 * brotli, ships 23% fewer bytes as well.
 *
 * What has to be right is narrow and easy to get wrong: pick an encoding the client
 * actually accepts, keep the ORIGINAL file's content type, always send Vary, and never
 * let a URL name a file outside the root.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPrecompressedStatic } from '../../server/http/middleware/precompressed.mjs';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'precompressed-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'app.js.gz'), 'GZIPPED');
  writeFileSync(join(root, 'assets', 'app.js.br'), 'BROTLIED');
  // A file with no variants, to prove the fallthrough.
  writeFileSync(join(root, 'assets', 'plain.js'), 'console.log(2)');
  writeFileSync(join(root, 'secret.js'), 'not for the web');
  writeFileSync(join(root, 'secret.js.br'), 'not for the web either');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

function request(path, acceptEncoding, method = 'GET') {
  const middleware = createPrecompressedStatic({
    root,
    urlPrefix: '/assets/',
    setHeaders(res) {
      res.setHeader('Cache-Control', 'immutable-marker');
    },
  });

  const headers = {};
  let sent = null;
  let ended = false;
  let statusCode = 200;
  let passed = false;

  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      statusCode = code;
      return res;
    },
    end() {
      ended = true;
      return res;
    },
    sendFile(file) {
      sent = file;
      return res;
    },
    headersSent: false,
  };

  middleware(
    { method, path, headers: { 'accept-encoding': acceptEncoding } },
    res,
    () => {
      passed = true;
    },
  );

  return { headers, sent, ended, statusCode, passed };
}

describe('choosing an encoding', () => {
  test('brotli wins when both are accepted', () => {
    // Every browser that speaks brotli also speaks gzip, so the order here is the
    // only thing that decides - and brotli is 22% smaller on the editor chunk.
    const result = request('/assets/app.js', 'gzip, deflate, br');
    assert.match(result.sent, /app\.js\.br$/);
    assert.equal(result.headers['content-encoding'], 'br');
  });

  test('gzip is used when brotli is not accepted', () => {
    const result = request('/assets/app.js', 'gzip, deflate');
    assert.match(result.sent, /app\.js\.gz$/);
    assert.equal(result.headers['content-encoding'], 'gzip');
  });

  test('a client accepting nothing falls through to the plain file', () => {
    const result = request('/assets/app.js', '');
    assert.equal(result.passed, true);
    assert.equal(result.sent, null);
    assert.equal(result.headers['content-encoding'], undefined);
  });
});

describe('the headers a compressed response needs', () => {
  test('Vary: Accept-Encoding, or a shared cache poisons a client that cannot decode it', () => {
    assert.equal(request('/assets/app.js', 'br').headers['vary'], 'Accept-Encoding');
  });

  test('the content type is the ORIGINAL file type, not the archive type', () => {
    // The obvious mistake: letting the .br extension decide, so the browser is handed
    // application/octet-stream for a script and refuses to execute it.
    assert.match(request('/assets/app.js', 'br').headers['content-type'], /text\/javascript/);
  });

  test('the caller headers are applied too', () => {
    assert.equal(request('/assets/app.js', 'br').headers['cache-control'], 'immutable-marker');
  });

  test('a HEAD gets the headers and no body', () => {
    const result = request('/assets/app.js', 'br', 'HEAD');
    assert.equal(result.ended, true);
    assert.equal(result.sent, null);
    assert.equal(result.headers['content-encoding'], 'br');
  });
});

describe('what it must never do', () => {
  test('a traversal cannot leave the assets directory', () => {
    // The boundary is the prefix directory, not merely the root: `/assets/../x`
    // resolves back inside dist/, so a root-only check would happily serve it.
    const result = request('/assets/../secret.js', 'br');
    assert.equal(result.passed, true, 'the traversal was served');
    assert.equal(result.sent, null);
  });

  test('an encoded traversal cannot either', () => {
    const result = request('/assets/%2e%2e/secret.js', 'br');
    assert.equal(result.passed, true);
    assert.equal(result.sent, null);
  });

  test('nor can one that climbs above the root entirely', () => {
    const result = request('/assets/../../../../etc/passwd.js', 'br');
    assert.equal(result.passed, true);
    assert.equal(result.sent, null);
  });

  test('a file with no variant falls through untouched', () => {
    const result = request('/assets/plain.js', 'br, gzip');
    assert.equal(result.passed, true);
    assert.equal(result.headers['content-encoding'], undefined);
  });

  test('a path outside the prefix is not its business', () => {
    assert.equal(request('/other/app.js', 'br').passed, true);
  });

  test('an extension it does not know is left alone', () => {
    assert.equal(request('/assets/photo.png', 'br').passed, true);
  });

  test('a POST is left alone', () => {
    assert.equal(request('/assets/app.js', 'br', 'POST').passed, true);
  });
});
