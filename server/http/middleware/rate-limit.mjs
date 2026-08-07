/**
 * Per-client rate limiting, and the internal-caller exemption that N-01 broke.
 *
 * The exemption's reasoning was sound - the api service publishes no port, so only
 * sibling containers can reach it directly, and the security-test container needs
 * to run unthrottled - but the implementation asked the wrong question:
 *
 *     isTrustedInternalIp(req.ip)     with     app.set('trust proxy', true)
 *
 * `trust proxy: true` tells Express to believe every hop, so `req.ip` came from the
 * leftmost `X-Forwarded-For` entry, which the client writes. Sending
 * `X-Forwarded-For: 10.0.0.1` from anywhere on the internet therefore disabled rate
 * limiting entirely, on endpoints that spawn compilers.
 *
 * The fix separates two questions that had been conflated:
 *
 *   "who is the client?"          -> req.ip, derived from a trusted hop COUNT
 *   "did this bypass the proxy?"  -> req.socket.remoteAddress, the real TCP peer,
 *                                    which no header can influence
 */

/**
 * Fixed-window counter, keyed by client address.
 *
 * The timer is created by start() rather than by the constructor, and is unref'd.
 * The previous version armed a bare `setInterval` in its constructor, which meant
 * constructing a limiter had a side effect, the interval could never be cleared,
 * and it held the event loop open during shutdown.
 */
export class RateLimiter {
  #requests = new Map();
  #windowMs;
  #maxRequests;
  #timer = null;

  constructor({ windowMs, maxRequests }) {
    this.#windowMs = windowMs;
    this.#maxRequests = maxRequests;
  }

  get maxRequests() {
    return this.#maxRequests;
  }

  get size() {
    return this.#requests.size;
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.cleanup(), this.#windowMs);
    this.#timer.unref?.();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  check(ip) {
    const now = Date.now();
    const record = this.#requests.get(ip);

    if (!record) {
      this.#requests.set(ip, { count: 1, resetAt: now + this.#windowMs });
      return { allowed: true, remaining: this.#maxRequests - 1 };
    }

    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + this.#windowMs;
      return { allowed: true, remaining: this.#maxRequests - 1 };
    }

    record.count++;
    const remaining = Math.max(0, this.#maxRequests - record.count);
    return { allowed: record.count <= this.#maxRequests, remaining };
  }

  /**
   * Drop expired windows.
   *
   * Without this the map grows once per distinct client address for the lifetime of
   * the process, which for a public endpoint is unbounded.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.#requests) {
      if (now > record.resetAt) this.#requests.delete(key);
    }
  }
}

/**
 * True when the request came straight from a sibling container rather than through
 * the proxy.
 *
 * A sibling connects to us directly, so its socket address is private. A user's
 * request arrives via nginx, so the socket address is *also* private - but a
 * forwarded-for header is present. That second condition is what distinguishes
 * them, and dropping it is what made the original check forgeable.
 */
export function isDirectInternalCaller(req) {
  // The real TCP peer. Unlike req.ip, this is not derived from any header.
  const peer = req.socket?.remoteAddress || '';
  const v4 = peer.replace(/^::ffff:/, '');
  const peerIsPrivate =
    v4 === '127.0.0.1' ||
    peer === '::1' ||
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4);

  if (!peerIsPrivate) return false;

  // A private peer that forwarded a client address IS the proxy, and the request
  // behind it belongs to a real user who must be rate limited.
  return !req.headers['x-forwarded-for'];
}

export function createRateLimitMiddleware({ limiter }) {
  return (req, res, next) => {
    if (isDirectInternalCaller(req)) return next();

    // req.ip is trustworthy here: with a hop count, Express counts inward from the
    // socket and never reaches entries a client prepended.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const { allowed, remaining } = limiter.check(ip);

    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Limit', limiter.maxRequests);

    if (!allowed) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
    }
    return next();
  };
}
