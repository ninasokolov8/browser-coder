/**
 * Serve the build-time `.br` / `.gz` variant when the client can take it.
 *
 * Without this, `compression()` gzips every asset again for every cache-cold browser -
 * 179 ms of CPU for a full cold load of this build, on the same container that runs
 * student code, competing for the same libuv thread pool that does the execution
 * pipeline's filesystem work. See `scripts/precompress-dist.mjs` for the measurement.
 *
 * Falls through untouched when a variant is missing, so a dev build with no
 * pre-compression step, or a file that compressed larger than its original, behaves
 * exactly as before.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Content types for the extensions the pre-compressor covers. */
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
};

/**
 * @param {object} options
 * @param {string} options.root       Directory the URL path is resolved against.
 * @param {string} options.urlPrefix  Only paths under this are considered.
 * @param {(res: import('express').Response) => void} [options.setHeaders]
 */
export function createPrecompressedStatic({ root, urlPrefix, setHeaders }) {
  const resolvedRoot = path.resolve(root);

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.path.startsWith(urlPrefix)) return next();

    const type = TYPES[path.extname(req.path)];
    if (!type) return next();

    // The path comes from the URL, so it is resolved and then checked to be inside
    // the root. `..` in a URL is normally collapsed by the client, but "normally" is
    // not a boundary - a handcrafted request must not be able to name a file outside
    // dist/.
    // The WHOLE path is resolved against the root - `/assets/app.js` under `dist/` is
    // `dist/assets/app.js`. The prefix decides whether this middleware is interested,
    // not what gets stripped.
    const relative = decodeURIComponent(req.path).replace(/^\/+/, '');
    const target = path.resolve(resolvedRoot, `.${path.sep}${relative}`);

    // The boundary is the PREFIX directory, not merely the root. `/assets/../x` still
    // lands inside the root, so a root-only check would let a URL that claims to be an
    // asset serve something that is not one - the resolved path has to still be under
    // the directory the prefix names.
    const boundary = path.resolve(resolvedRoot, `.${path.sep}${urlPrefix.replace(/^\/+/, '')}`);
    if (!target.startsWith(boundary.endsWith(path.sep) ? boundary : boundary + path.sep)) {
      return next();
    }

    const accepted = String(req.headers['accept-encoding'] || '');
    // Brotli first: 22% smaller than gzip on the editor chunk, and every browser that
    // supports it also supports gzip, so the order is the only thing that decides.
    const candidates = [
      ['br', '.br'],
      ['gzip', '.gz'],
    ].filter(([encoding]) => accepted.includes(encoding));

    for (const [encoding, extension] of candidates) {
      const file = `${target}${extension}`;
      let stats;
      try {
        stats = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;

      // Vary before anything else: an origin cache that ignored it would hand a
      // brotli body to a client that cannot read it.
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Length', String(stats.size));
      setHeaders?.(res);

      if (req.method === 'HEAD') return res.status(200).end();
      return res.sendFile(file, error => {
        // A read failure after the headers are out cannot be turned into a 404; the
        // connection is closed instead, which is what sendFile does by default.
        if (error && !res.headersSent) next(error);
      });
    }

    return next();
  };
}
