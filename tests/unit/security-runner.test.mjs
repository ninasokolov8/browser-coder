import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { executeCode } from '../../security/runner/index.mjs';

describe('security corpus execution classification', () => {
  test('a program can execute successfully without printing anything', async (context) => {
    context.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ stdout: '', stderr: '', error: null, exitCode: 1 }),
    }));

    const result = await executeCode('python', 'import sys; sys.exit(1)');

    assert.equal(result.blocked, false);
    assert.equal(result.executed, true);
  });

  test('a security refusal is not classified as execution', async (context) => {
    context.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({
        stdout: '',
        stderr: '',
        error: 'Blocked: file access is disabled for security',
      }),
    }));

    const result = await executeCode('python', 'open("/etc/passwd")');

    assert.equal(result.blocked, true);
    assert.equal(result.executed, false);
  });
});
