/**
 * Transport-level request setup: proxy trust, compression, body limits, request id.
 *
 * Grouped because these must run before everything else and their ORDER matters -
 * a body parser registered after a route never parses that route's body, and the
 * request id has to exist before anything logs.
 */

import crypto from 'node:crypto';
import compression from 'compression';
import express from 'express';

/**
 * @param {import('express').Express} app
 * @param {object} options
 * @param {object} options.config              CONFIG
 * @param {number} options.runBodyLimitBytes   RUN_BODY_LIMIT_BYTES
 */
export function applyRequestContext(app, { config, runBodyLimitBytes }) {
  // N-01: `trust proxy: true` told Express to trust EVERY hop, so `req.ip` was
  // taken from the leftmost X-Forwarded-For entry - a value the client writes.
  // A hop COUNT makes Express count inward from the socket, so entries a client
  // injected on the left are never reached. One hop (nginx) by default;
  // TRUSTED_PROXY_HOPS covers a deployment that adds a CDN or load balancer.
  app.set('trust proxy', Number.parseInt(process.env.TRUSTED_PROXY_HOPS || '1', 10));

  app.use(compression());

  // Only preview publishing receives the larger request-body allowance.
  app.use(
    '/api/previews',
    express.json({ limit: config.preview.maxHtmlBytes * 2 + 1024 * 1024 }),
  );

  // /api/run carries a whole multi-file project as JSON. JSON-encoding the raw code
  // inflates its byte size well past CONFIG.execution.maxCodeChars: every
  // newline/quote/backslash in the source doubles when escaped, non-ASCII comments
  // and strings cost extra UTF-8 bytes, and each file adds JSON wrapper overhead
  // ({"name":...,"content":...,"language":...,"isMain":...}). A body limit equal to
  // maxCodeChars therefore rejects legitimate projects that are well within the
  // app's own size policy, before the handler even runs - that was the previous 413.
  // Size the transport limit for the actual worst case the policy allows instead of
  // copying the same number:
  //   - content: up to 3x for escaping + multi-byte overhead
  //   - per file: path + ~100 bytes of JSON metadata, up to maxProjectFiles files
  //   - a few KB slack for language/version/entryPoint and JSON punctuation
  // Derived from the size policy in server/config.mjs, so raising a limit there
  // raises the transport allowance with it.
  app.use('/api/run', express.json({ limit: runBodyLimitBytes }));

  app.use(express.json({ limit: '100kb' }));

  // Every log line and every error response can be tied back to one request.
  app.use((req, res, next) => {
    req.id = crypto.randomBytes(4).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    next();
  });
}
