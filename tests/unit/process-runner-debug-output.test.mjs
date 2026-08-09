import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

import { spawnManaged } from '../../server/execution/process-runner.mjs';
import { TerminationReason } from '../../server/domain/termination.mjs';

function sleepingProcess(options = {}) {
  return spawnManaged({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    env: { ...process.env },
    timeoutMs: 5000,
    stdin: false,
    maxOutputChars: 100,
    ...options,
  });
}

describe('debug-protocol output uses the managed output sinks', () => {
  test('streams and stores external stdout exactly once', async () => {
    let streamed = '';
    const managed = sleepingProcess({ onStdout: text => { streamed += text; } });
    assert.equal(managed.writeOutput('stdout', 'hello'), true);
    managed.stop(TerminationReason.CANCELLED);
    const result = await managed.done;

    assert.equal(streamed, 'hello');
    assert.equal(result.stdout, 'hello');
    assert.equal(result.termination.reason, TerminationReason.CANCELLED);
  });

  test('cannot bypass the output cap', async () => {
    const managed = sleepingProcess({ maxOutputChars: 5 });
    assert.equal(managed.writeOutput('stdout', '123456'), false);
    const result = await managed.done;

    assert.equal(result.stdout, '12345');
    assert.equal(result.truncated, true);
    assert.equal(result.termination.reason, TerminationReason.OUTPUT_LIMIT);
  });
});
