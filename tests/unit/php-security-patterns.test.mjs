import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SECURITY } from '../../server/security/patterns.mjs';

const blocked = source => SECURITY.patterns.php.some(pattern => pattern.test(source));

describe('PHP callback policy', () => {
  test('allows ordinary array operations used by the built-in starter', () => {
    assert.equal(blocked('$doubled = array_map(fn($n) => $n * 2, $numbers);'), false);
  });

  test('still refuses command execution through string callbacks', () => {
    assert.equal(blocked("array_map('system', ['id']);"), true);
    assert.equal(blocked("array_filter(['id'], 'system');"), true);
    assert.equal(blocked("array_walk($items, 'shell_exec');"), true);
  });
});
