/**
 * The two middleware defects, pinned at unit level.
 *
 * N-01 (rate-limit bypass) and V-46 (CORS grant on rejection) were both fixed
 * before this extraction, but only the black-box contract suite covered them - and
 * it can only observe them through a live server, which means the exact forged
 * header that caused N-01 is awkward to reproduce there. Now that the middleware is
 * a pure function of (request, config), the bypass can be attempted directly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RateLimiter,
  createRateLimitMiddleware,
  isDirectInternalCaller,
} from '../../server/http/middleware/rate-limit.mjs';
import {
  ALLOWED_ORIGINS,
  createCorsMiddleware,
  isAllowedOrigin,
} from '../../server/http/middleware/cors.mjs';

/** Minimal express-shaped request. */
function request({ peer = '203.0.113.7', headers = {}, ip, method = 'GET', path = '/api/run' } = {}) {
  return { socket: { remoteAddress: peer }, headers, ip: ip ?? peer, method, path };
}

/** Minimal express-shaped response that records what was set. */
function response() {
  const headers = {};
  const state = { statusCode: null, body: null, ended: false, headers };
  return {
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      state.ended = true;
      return this;
    },
    sendStatus(code) {
      state.statusCode = code;
      state.ended = true;
      return this;
    },
    state,
  };
}

describe('N-01: the rate-limit bypass', () => {
  test('a forged forwarded-for from the internet does NOT exempt the caller', () => {
    // The exact attack: a public peer claiming to be a private address. The old
    // check asked `isTrustedInternalIp(req.ip)` with `trust proxy: true`, so this
    // request was exempt and could spawn compilers without limit.
    const forged = request({
      peer: '203.0.113.7',
      headers: { 'x-forwarded-for': '10.0.0.1' },
      ip: '10.0.0.1',
    });

    assert.equal(isDirectInternalCaller(forged), false);
  });

  test('a private peer that forwarded a client address is the PROXY, not an internal caller', () => {
    // nginx connects from a private address, but forwards the real client. The
    // request behind it belongs to a user who must be rate limited.
    const viaProxy = request({
      peer: '172.18.0.5',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      ip: '203.0.113.9',
    });

    assert.equal(isDirectInternalCaller(viaProxy), false);
  });

  test('a private peer speaking for itself is exempt', () => {
    // A sibling container - the security-test runner - which must run unthrottled.
    for (const peer of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.4', '172.16.9.9', '::ffff:10.0.0.2']) {
      assert.equal(
        isDirectInternalCaller(request({ peer, headers: {} })),
        true,
        `${peer} should be an internal caller`,
      );
    }
  });

  test('an address merely resembling a private range is not exempt', () => {
    // 172.32 is outside 172.16-172.31, and 100.64 is carrier-grade NAT, not private.
    for (const peer of ['172.32.0.1', '172.15.0.1', '100.64.0.1', '11.0.0.1', '193.168.0.1']) {
      assert.equal(
        isDirectInternalCaller(request({ peer, headers: {} })),
        false,
        `${peer} should NOT be an internal caller`,
      );
    }
  });

  test('the middleware throttles a forged internal claim', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const middleware = createRateLimitMiddleware({ limiter });

    const attempt = () => {
      const res = response();
      let passed = false;
      middleware(
        request({ peer: '203.0.113.7', headers: { 'x-forwarded-for': '10.0.0.1' }, ip: '203.0.113.7' }),
        res,
        () => {
          passed = true;
        },
      );
      return { passed, res };
    };

    assert.equal(attempt().passed, true);
    assert.equal(attempt().passed, true);

    const third = attempt();
    assert.equal(third.passed, false, 'the third request must be refused');
    assert.equal(third.res.state.statusCode, 429);
    assert.equal(third.res.getHeader('Retry-After'), '60');
  });

  test('a genuine internal caller is never throttled', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const middleware = createRateLimitMiddleware({ limiter });

    let passes = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      middleware(request({ peer: '10.0.0.5', headers: {} }), response(), () => {
        passes += 1;
      });
    }

    assert.equal(passes, 20);
  });
});

describe('RateLimiter', () => {
  test('counts within a window and reports what is left', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });

    assert.deepEqual(limiter.check('a'), { allowed: true, remaining: 2 });
    assert.deepEqual(limiter.check('a'), { allowed: true, remaining: 1 });
    assert.deepEqual(limiter.check('a'), { allowed: true, remaining: 0 });
    assert.deepEqual(limiter.check('a'), { allowed: false, remaining: 0 });
  });

  test('clients are counted separately', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
    assert.equal(limiter.check('a').allowed, true);
    assert.equal(limiter.check('b').allowed, true);
    assert.equal(limiter.check('a').allowed, false);
  });

  test('cleanup drops expired windows so the map cannot grow without bound', () => {
    const limiter = new RateLimiter({ windowMs: -1, maxRequests: 5 });
    limiter.check('a');
    limiter.check('b');
    assert.equal(limiter.size, 2);

    limiter.cleanup();
    assert.equal(limiter.size, 0);
  });

  test('constructing a limiter does not arm a timer', () => {
    // The previous version called setInterval in its constructor, which held the
    // event loop open and could never be cleared. If this test hangs, that
    // regressed.
    const limiter = new RateLimiter({ windowMs: 10, maxRequests: 1 });
    limiter.stop(); // must be safe even though start() was never called
    assert.equal(limiter.size, 0);
  });
});

describe('V-46: CORS must reject, not grant', () => {
  const noop = () => {};

  test('a disallowed origin receives NO allow-origin header', () => {
    // The whole defect: the old code logged "cors_rejected" and then sent the
    // rejected origin back with credentials, which is a grant.
    const middleware = createCorsMiddleware({ isDev: false, log: noop });
    const res = response();
    let passed = false;

    middleware(request({ headers: { origin: 'https://evil.example' } }), res, () => {
      passed = true;
    });

    assert.equal(res.getHeader('Access-Control-Allow-Origin'), undefined);
    assert.equal(res.getHeader('Access-Control-Allow-Credentials'), undefined);
    // The request still proceeds - it has already been sent - but the browser will
    // not expose the response.
    assert.equal(passed, true);
  });

  test('a disallowed preflight is refused outright', () => {
    const middleware = createCorsMiddleware({ isDev: false, log: noop });
    const res = response();

    middleware(request({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), res, () => {
      assert.fail('a rejected preflight must not continue');
    });

    assert.equal(res.state.statusCode, 403);
  });

  test('an allowed origin is echoed with credentials', () => {
    const middleware = createCorsMiddleware({ isDev: false, log: noop });
    const res = response();

    middleware(request({ headers: { origin: 'https://stepup.school' } }), res, () => {});

    assert.equal(res.getHeader('Access-Control-Allow-Origin'), 'https://stepup.school');
    assert.equal(res.getHeader('Access-Control-Allow-Credentials'), 'true');
  });

  test('Vary: Origin is always set', () => {
    // Without it a shared cache can hand one origin's response to another.
    const middleware = createCorsMiddleware({ isDev: false, log: noop });
    for (const origin of [undefined, 'https://stepup.school', 'https://evil.example']) {
      const res = response();
      middleware(request({ headers: origin ? { origin } : {} }), res, () => {});
      assert.equal(res.getHeader('Vary'), 'Origin');
    }
  });

  test('a request with no Origin gets * and no credentials', () => {
    const middleware = createCorsMiddleware({ isDev: false, log: noop });
    const res = response();

    middleware(request({ headers: {} }), res, () => {});

    assert.equal(res.getHeader('Access-Control-Allow-Origin'), '*');
    assert.equal(res.getHeader('Access-Control-Allow-Credentials'), undefined);
  });
});

describe('isAllowedOrigin', () => {
  const prod = { isDev: false };

  test('exact allowlist entries pass', () => {
    for (const origin of ALLOWED_ORIGINS) {
      assert.equal(isAllowedOrigin(origin, prod), true, origin);
    }
  });

  test('a subdomain of an allowed domain passes over https', () => {
    assert.equal(isAllowedOrigin('https://app.stepup.school', prod), true);
    assert.equal(isAllowedOrigin('https://deep.nested.step-up.co.il', prod), true);
  });

  test('a subdomain grant is refused over plain http in production', () => {
    assert.equal(isAllowedOrigin('http://app.stepup.school', prod), false);
    assert.equal(isAllowedOrigin('http://app.stepup.school', { isDev: true }), true);
  });

  test('a lookalike domain is refused', () => {
    // The reason the check parses the hostname instead of using endsWith on the
    // raw origin string: these are the shapes that defeat string matching.
    for (const origin of [
      'https://stepup.school.attacker.com',
      'https://evil-stepup.school',
      'https://stepupxschool',
      'https://notstepup.school.co',
      'https://arcacademy.co.evil.com',
    ]) {
      assert.equal(isAllowedOrigin(origin, prod), false, origin);
    }
  });

  test('a malformed or missing origin is refused', () => {
    for (const origin of ['', null, undefined, 'not a url', 'https://']) {
      assert.equal(isAllowedOrigin(origin, prod), false, String(origin));
    }
  });

  test('hostname comparison is case-insensitive', () => {
    assert.equal(isAllowedOrigin('https://APP.StepUp.School', prod), true);
  });
});
