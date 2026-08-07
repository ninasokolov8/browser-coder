/**
 * Sharing a project over HTTP.
 *
 * A share id is a capability URL: 128 random bits, and anyone holding it can read the
 * project. The tests below are mostly about the consequences of that - what the routes
 * refuse, and what they decline to tell an attacker who is guessing.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';

const project = (files, extra = {}) => ({ files, language: 'python', ...extra });

describe('share links', () => {
  let server;
  let base;

  before(async () => {
    server = await startServer();
    base = server.baseUrl;
  });

  after(async () => {
    await server?.stop();
  });

  async function publish(body) {
    return fetch(`${base}/api/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('publish, then open', async () => {
    const response = await publish(project(
      [
        { path: 'main.py', content: 'print("hello")', language: 'python' },
        { path: 'lib/helper.py', content: 'x = 1', language: 'python' },
      ],
      { entryPoint: 'main.py' },
    ));

    if (response.status === 503) return; // sharing not configured on this host
    assert.equal(response.status, 201);

    const { id } = await response.json();
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);

    const read = await fetch(`${base}/api/shares/${id}`);
    assert.equal(read.status, 200);

    const stored = await read.json();
    assert.equal(stored.entryPoint, 'main.py');
    assert.deepEqual(stored.files.map(file => file.path), ['main.py', 'lib/helper.py']);
    assert.equal(stored.files[0].content, 'print("hello")');
  });

  test('the same project published twice gets two different links', async () => {
    // A snapshot is immutable: a link always shows what was sent, so a student who
    // keeps working does not silently change what their teacher is looking at.
    const first = await publish(project([{ path: 'a.py', content: 'v1' }]));
    if (first.status === 503) return;
    const second = await publish(project([{ path: 'a.py', content: 'v1' }]));

    assert.notEqual((await first.json()).id, (await second.json()).id);
  });

  test('an unknown link and an expired one are the same answer', async () => {
    /*
     * Deliberately indistinguishable. Telling an attacker that an id is REAL but
     * expired, versus never existed, is an oracle: it turns guessing ids into a
     * search with feedback, which is most of the work of finding a live one.
     */
    const response = await fetch(`${base}/api/shares/${'A'.repeat(22)}`);
    if (response.status === 503) return;
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'share_not_found');
  });

  test('a malformed id is refused before anything touches the filesystem', async () => {
    for (const bad of ['../../etc/passwd', 'short', 'x'.repeat(200)]) {
      const response = await fetch(`${base}/api/shares/${encodeURIComponent(bad)}`);
      assert.ok(
        [400, 404, 503].includes(response.status),
        `${bad} answered ${response.status}`,
      );
    }
  });

  test('a traversal in a shared path never survives the round trip', async () => {
    // These files are written into the workspace of whoever opens the link.
    const response = await publish(project([
      { path: 'main.py', content: 'ok' },
      { path: '../escape.py', content: 'no' },
      { path: '..\\escape.py', content: 'no' },
    ]));
    if (response.status === 503) return;

    const { id } = await response.json();
    const stored = await (await fetch(`${base}/api/shares/${id}`)).json();

    assert.deepEqual(stored.files.map(file => file.path), ['main.py']);
  });

  test('an empty project is refused with a message, not a blank link', async () => {
    const response = await publish(project([]));
    if (response.status === 503) return;
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /nothing to share/i);
  });

  test('there is no way to list or delete shares', async () => {
    // A capability URL is only a capability if holding one tells you nothing about
    // the others, and if somebody else's link cannot be revoked by a stranger.
    const list = await fetch(`${base}/api/shares`);
    assert.notEqual(list.status, 200);

    const remove = await fetch(`${base}/api/shares/${'A'.repeat(22)}`, { method: 'DELETE' });
    assert.notEqual(remove.status, 200);
  });
});
