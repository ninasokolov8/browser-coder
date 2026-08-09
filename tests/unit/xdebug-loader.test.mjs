import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { xdebugLoadArgs } from '../../languages/php/xdebug-loader.mjs';

describe('Xdebug CLI loading', () => {
  test('does not load the extension twice when the interpreter already enabled it', () => {
    const calls = [];
    const args = xdebugLoadArgs('php', ['-d', 'memory_limit=64M'], (...call) => {
      calls.push(call);
      return { status: 0, error: null };
    });

    assert.deepEqual(args, []);
    assert.deepEqual(calls[0][1], [
      '-d',
      'memory_limit=64M',
      '-r',
      'exit(extension_loaded("xdebug") ? 0 : 1);',
    ]);
  });

  test('loads Xdebug explicitly when the distribution leaves it disabled', () => {
    const args = xdebugLoadArgs('php', [], () => ({ status: 1, error: null }));
    assert.deepEqual(args, ['-dzend_extension=xdebug']);
  });

  test('leaves launch-time error reporting intact when the probe cannot run', () => {
    const args = xdebugLoadArgs('missing-php', [], () => {
      throw new Error('missing');
    });
    assert.deepEqual(args, ['-dzend_extension=xdebug']);
  });
});
