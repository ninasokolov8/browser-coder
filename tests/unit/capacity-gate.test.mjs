/**
 * Refusing a large run body before it is buffered.
 *
 * `/api/run` carries a whole project as JSON and `express.json` parses it before any
 * handler runs, so at capacity the server used to read several megabytes into memory
 * and only then answer 503 - at exactly the moment a burst of students all press Run.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  LARGE_BODY_BYTES,
  createCapacityGate,
} from '../../server/http/middleware/capacity-gate.mjs';

function harness({ active, max = 4, bytes, method = 'POST' }) {
  const gate = createCapacityGate({
    pipeline: { activeCount: active },
    config: { execution: { maxConcurrent: max } },
  });

  const req = { method, headers: bytes === undefined ? {} : { 'content-length': String(bytes) } };

  let statusCode = null;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      body = payload;
      return res;
    },
  };

  let passed = false;
  gate(req, res, () => {
    passed = true;
  });

  return { passed, statusCode, body };
}

describe('when the gate lets a request through', () => {
  test('there is capacity', () => {
    const result = harness({ active: 1, max: 4, bytes: 5 * 1024 * 1024 });
    assert.equal(result.passed, true);
    assert.equal(result.statusCode, null);
  });

  test('the body is small, even at capacity', () => {
    // A small body costs almost nothing to buffer, and buffering it leaves the run a
    // chance of a slot freeing before the handler reads it - runs are short.
    const result = harness({ active: 4, max: 4, bytes: 1024 });
    assert.equal(result.passed, true);
  });

  test('the body size is not declared', () => {
    // Chunked upload with no Content-Length: nothing to decide on, and the transport
    // limit still bounds it.
    const result = harness({ active: 4, max: 4, bytes: undefined });
    assert.equal(result.passed, true);
  });

  test('it is not a POST', () => {
    const result = harness({ active: 4, max: 4, bytes: 5 * 1024 * 1024, method: 'GET' });
    assert.equal(result.passed, true);
  });

  test('a malformed Content-Length is treated as absent, not as huge', () => {
    const gate = createCapacityGate({
      pipeline: { activeCount: 9 },
      config: { execution: { maxConcurrent: 4 } },
    });
    let passed = false;
    gate({ method: 'POST', headers: { 'content-length': 'not-a-number' } }, {}, () => {
      passed = true;
    });
    assert.equal(passed, true);
  });
});

describe('when the gate refuses', () => {
  test('at capacity with a large body, before any parsing', () => {
    const result = harness({ active: 4, max: 4, bytes: LARGE_BODY_BYTES });
    assert.equal(result.passed, false);
    assert.equal(result.statusCode, 503);
  });

  test('the envelope is the one the pipeline itself produces', () => {
    // A client must not be able to tell the two refusals apart, or it needs new
    // handling for a condition it already handles.
    const result = harness({ active: 5, max: 4, bytes: 8 * 1024 * 1024 });
    assert.equal(result.body.code, 'at_capacity');
    assert.match(result.body.error, /capacity/i);
  });

  test('over-capacity, not merely at it', () => {
    const result = harness({ active: 99, max: 4, bytes: LARGE_BODY_BYTES * 2 });
    assert.equal(result.statusCode, 503);
  });
});

describe('the threshold', () => {
  test('is exclusive below and inclusive at the boundary', () => {
    assert.equal(harness({ active: 4, max: 4, bytes: LARGE_BODY_BYTES - 1 }).passed, true);
    assert.equal(harness({ active: 4, max: 4, bytes: LARGE_BODY_BYTES }).passed, false);
  });

  test('is configurable, so an operator who measured something better can use it', () => {
    const gate = createCapacityGate({
      pipeline: { activeCount: 4 },
      config: { execution: { maxConcurrent: 4 } },
      largeBodyBytes: 10,
    });
    let passed = false;
    let statusCode = null;
    const res = { status(code) { statusCode = code; return res; }, json: () => res };
    gate({ method: 'POST', headers: { 'content-length': '50' } }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(statusCode, 503);
  });
});
