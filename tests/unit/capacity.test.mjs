/**
 * V-36: concurrency derived from memory the process does not have.
 *
 * The old derivation was `min(500, floor(TOTAL_MEMORY_MB / 50))` against the HOST's
 * memory. On the production droplet that is 30 GiB behind a 1 GiB container, so it
 * computed the 500 ceiling - eight times the memory actually available. Admission
 * never refused anything, and the kernel enforced the real limit by OOM-killing the
 * container, turning what should have been a clean 503 into an outage.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG, MEMORY_BUDGET, deriveMaxConcurrent } from '../../server/config.mjs';

describe('deriveMaxConcurrent', () => {
  test('a 1 GiB container gets a limit that fits in 1 GiB', () => {
    // reserve = clamp(128, 256, 1024/4) = 256; (1024 - 256) / 50 = 15.
    assert.equal(deriveMaxConcurrent({ budgetMb: 1024 }), 15);
  });

  test('the reserve is proportionate, so a small container is not starved', () => {
    // The production compose limit is 512 MB. A flat 256 MB reserve would take half
    // the budget and leave room for five runs; a quarter leaves room for seven.
    assert.equal(deriveMaxConcurrent({ budgetMb: 512 }), 7);
    // ...and above 1 GB the reserve stops growing, because more than 256 MB for
    // express plus a session registry is waste.
    assert.equal(deriveMaxConcurrent({ budgetMb: 4096 }), 76);
  });

  test('the old formula would have allowed 500 for the same container', () => {
    // Stated as an assertion so the size of the defect is on the record: the host
    // reading produced the ceiling regardless of the container's actual limit.
    const oldFormula = Math.min(500, Math.floor(30 * 1024 / 50));
    assert.equal(oldFormula, 500);
    assert.ok(
      deriveMaxConcurrent({ budgetMb: 1024 }) * 33 < oldFormula,
      'the corrected limit must be dramatically lower for a small container',
    );
  });

  test('the server keeps its own reserve', () => {
    // Spending the entire budget on runs leaves nothing for the process supervising
    // them, and the first symptom is the supervisor dying rather than a run being
    // refused.
    const withReserve = deriveMaxConcurrent({ budgetMb: 1024, reserveMb: 256, perRunMb: 50 });
    const withoutReserve = deriveMaxConcurrent({ budgetMb: 1024, reserveMb: 0, perRunMb: 50 });
    assert.ok(withReserve < withoutReserve);
  });

  test('a tiny container still runs one program rather than refusing everything', () => {
    // Returning 0 would make every request 503 and look like a broken deployment.
    assert.equal(deriveMaxConcurrent({ budgetMb: 256 }), 2);
    assert.equal(deriveMaxConcurrent({ budgetMb: 10 }), 1);
    assert.equal(deriveMaxConcurrent({ budgetMb: 0 }), 1);
  });

  test('a large budget is still capped', () => {
    // The ceiling exists because memory is not the only limit - file descriptors,
    // PIDs and CPU bind long before 100k concurrent compilers.
    assert.equal(deriveMaxConcurrent({ budgetMb: 1024 * 1024 }), 500);
  });

  test('an explicit override wins', () => {
    assert.equal(deriveMaxConcurrent({ budgetMb: 1024, override: 42 }), 42);
    // ...but only when it is a real value; 0 means "not set".
    assert.equal(deriveMaxConcurrent({ budgetMb: 1024, override: 0 }), 15);
  });

  test('a heavier per-run assumption lowers the limit proportionally', () => {
    assert.equal(deriveMaxConcurrent({ budgetMb: 1024, perRunMb: 128 }), 6);
  });
});

describe('the live configuration is coherent', () => {
  test('maxConcurrent fits the detected budget', () => {
    // Whatever host this runs on, the derived limit must not claim more memory than
    // the process is allowed. This is the invariant the old code violated.
    const claimed = CONFIG.execution.maxConcurrent * 50;
    const budget = MEMORY_BUDGET.megabytes;

    // The 500 ceiling can bind before memory does on a large host, which is fine -
    // the check is that a SMALL budget is respected.
    if (CONFIG.execution.maxConcurrent < 500) {
      assert.ok(
        claimed <= budget,
        `concurrency claims ${claimed} MB of a ${budget} MB budget`,
      );
    }
  });

  test('interactive sessions cannot exceed concurrent runs', () => {
    // Since every run is a session holding a live process, the two limits describe
    // the same resource. A session cap above the run cap means the honest limit is
    // bypassed by using the interactive endpoint - which is the one the IDE uses
    // for everything.
    assert.ok(
      CONFIG.execution.maxInteractiveSessions <= CONFIG.execution.maxConcurrent,
      `sessions ${CONFIG.execution.maxInteractiveSessions} > runs ${CONFIG.execution.maxConcurrent}`,
    );
  });

  test('the dead scaling block is gone (V-35)', () => {
    // It configured a worker pool and an autoscaler that never existed.
    assert.equal(CONFIG.scaling, undefined);
    assert.equal(CONFIG.execution.maxQueueSize, undefined);
  });

  test('the memory budget reports where it came from', () => {
    // A caller has to be able to tell a real cgroup limit from a host-wide guess.
    assert.ok(['cgroup-v2', 'cgroup-v1', 'host', 'declared'].includes(MEMORY_BUDGET.source));
    assert.ok(MEMORY_BUDGET.megabytes > 0);
  });
});
