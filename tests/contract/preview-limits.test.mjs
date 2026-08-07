/**
 * The two bounds on preview storage, which for a long time did not exist.
 *
 * PREVIEW_MAX_STORAGE_BYTES and PREVIEW_PUBLISHES_PER_MINUTE were set in
 * docker-compose.prod.yml and read by nothing (blueprint V-38), under a config comment
 * saying "Phase B enforces them". Phase B came and went, so production believed it had a
 * storage cap and a publish rate limit and had neither - the only bound was a 30-day
 * TTL, and on a shared volume a class publishing all term fills the disk.
 *
 * Driven through the real HTTP surface with the limits actually configured, because the
 * defect was never in the logic - it was that nothing read the setting.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './support/server.mjs';

const PAGE = { path: 'index.html', content: '<!doctype html><p>hi</p>', language: 'html' };

describe('PREVIEW_PUBLISHES_PER_MINUTE', () => {
  let server;

  before(async () => {
    server = await startServer({ env: { PREVIEW_PUBLISHES_PER_MINUTE: '3' } });
  });

  after(async () => {
    await server?.stop();
  });

  it('allows publishes up to the limit and then refuses, in words a student can act on', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const { status, body } = await server.postJson('/api/previews', {
        files: [PAGE],
        entryPath: 'index.html',
      });
      statuses.push({ status, body });
    }

    const allowed = statuses.filter(entry => entry.status === 201);
    const refused = statuses.filter(entry => entry.status === 429);

    assert.equal(allowed.length, 3, `allowed ${allowed.length}: ${statuses.map(s => s.status)}`);
    assert.equal(refused.length, 2);

    // Not "Too many requests" - the student needs to know which thing to stop doing.
    assert.match(refused[0].body.error, /publishing previews too quickly/i);
    assert.equal(refused[0].body.retryAfter, 60);
  });
});

describe('with no limit configured', () => {
  let server;

  before(async () => {
    // The default. An existing deployment that never set it must not start being
    // refused because it upgraded.
    server = await startServer();
  });

  after(async () => {
    await server?.stop();
  });

  it('publishing repeatedly is not refused', async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const { status } = await server.postJson('/api/previews', {
        files: [PAGE],
        entryPath: 'index.html',
      });
      assert.equal(status, 201, `attempt ${attempt + 1} was refused`);
    }
  });
});
