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
 * @param {Array<import('express').RequestHandler>} [options.runGate]
 *        Middleware for /api/run that must see the request BEFORE its body is
 *        buffered - the capacity gate, and the CORS headers its refusal needs.
 */
export function applyRequestContext(app, { config, runBodyLimitBytes, runGate = [] }) {
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
  // Registered BEFORE the parser, deliberately: the whole point is to answer without
  // buffering several megabytes. Express runs middleware in registration order, so
  // moving this line below the parser would silently undo it.
  for (const middleware of runGate) app.use('/api/run', middleware);

  app.use('/api/run', express.json({ limit: runBodyLimitBytes }));

  /*
   * An asset upload is RAW BYTES, not JSON and not multipart.
   *
   * The client already has the bytes and the server already knows the name from the
   * URL, so an envelope would add only cost: JSON would mean base64 and its 33%, and
   * multipart would mean hand-writing a boundary parser - there is no multipart
   * dependency here and none is wanted for what a raw body does natively.
   *
   * Registered before the general JSON parser so it wins for this path.
   */
  // The check route FIRST, and the order is load-bearing: `type: '*/*'` below would
  // otherwise swallow its JSON body as a Buffer, and the handler would see no digests
  // and answer that the cache has nothing - so every run would upload everything.
  app.use('/api/blobs/check', express.json({ limit: '64kb' }));
  app.use('/api/blobs', express.raw({ type: '*/*', limit: config.blobs.maxBlobBytes }));

  app.use(express.json({ limit: '100kb' }));

  // Every log line and every error response can be tied back to one request.
  app.use((req, res, next) => {
    req.id = crypto.randomBytes(4).toString('hex');
    res.setHeader('X-Request-ID', req.id);
    next();
  });
}
