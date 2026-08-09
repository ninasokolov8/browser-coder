import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRuntimeTimeout } from '../../server/execution/pipeline.mjs';

describe('runtime timeout policy', () => {
  it('lets an explicit interactive no-timeout policy override a language default', () => {
    assert.equal(resolveRuntimeTimeout(0, 30_000, 10_000), 0);
  });

  it('uses language and service defaults only when the caller did not choose', () => {
    assert.equal(resolveRuntimeTimeout(undefined, 45_000, 10_000), 45_000);
    assert.equal(resolveRuntimeTimeout(undefined, undefined, 10_000), 10_000);
  });
});
