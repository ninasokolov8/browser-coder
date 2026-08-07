/**
 * The asset upload route. One verb, one path.
 *
 *   PUT /api/blobs/:digest
 *
 * There is deliberately NO GET and no DELETE, and that is the most important thing on
 * this page. An anonymous, content-addressed, publicly-writable store with a read route
 * is a file host: anyone could put bytes in and hand the URL to anyone else, and a
 * teaching IDE would be hosting whatever they liked, on the school's domain.
 *
 * The bytes only ever come back out INSIDE A RUN, as the content of a file in the
 * student's own job directory - which the run pipeline already confines.
 *
 * DELETE is absent for a different reason: the cache is shared, so a delete is a way to
 * make somebody else's next run slower. Eviction belongs to the sweeper.
 */

import { createDigestSink, parseDigest } from '../../blobs/digest.mjs';

export function registerBlobRoutes(app, { store, config, log }) {
  /**
   * Does the server already have these?
   *
   * The client asks before a run so it can send digests for the hits and bytes for the
   * misses. A POST rather than a GET because the list can be long, and because a GET
   * that answers questions about content-addressed storage is the first half of the
   * read route this route does not have.
   */
  app.post('/api/blobs/check', (req, res) => {
    if (!store.isReady) {
      // Not an error. It means "send everything inline", which is what the client did
      // before this route existed.
      return res.json({ available: false, have: [] });
    }

    const asked = Array.isArray(req.body?.digests) ? req.body.digests : [];
    const have = [];

    for (const raw of asked.slice(0, 500)) {
      const digest = parseDigest(raw);
      if (digest && store.has(digest)) have.push(digest);
    }

    return res.json({ available: true, have });
  });

  /**
   * Store one asset.
   *
   * The body is raw bytes, not JSON and not multipart: the client already has the
   * bytes, the server already knows the name from the URL, and neither an envelope nor
   * a boundary parser would add anything. `express.raw` handles the size limit.
   */
  app.put('/api/blobs/:digest', (req, res) => {
    if (!store.isReady) {
      return res.status(503).json({
        error: 'The asset cache is not configured.',
        code: 'blob_cache_unavailable',
      });
    }

    const claimed = parseDigest(req.params.digest);
    if (!claimed) {
      return res.status(400).json({ error: 'Not a digest.', code: 'blob_digest_invalid' });
    }

    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'Empty body.', code: 'blob_empty' });
    }

    if (body.length > config.blobs.maxBlobBytes) {
      return res.status(413).json({ error: 'Asset too large.', code: 'blob_too_large' });
    }

    /*
     * Verify what ARRIVED, never what was claimed.
     *
     * Trusting the URL would let anyone store bytes of their choosing under a name of
     * their choosing - and because the cache is shared, the next student whose project
     * legitimately contains that digest would run the attacker's file instead of their
     * own image. The whole safety of content addressing is that the name is derived
     * from the content, so it has to actually be derived, here, from these bytes.
     */
    const sink = createDigestSink();
    sink.update(body);
    const actual = sink.digest();

    if (actual !== claimed) {
      log('warn', 'blob_digest_mismatch', { claimed, actual });
      return res.status(400).json({
        error: 'The content does not match the digest.',
        code: 'blob_digest_mismatch',
      });
    }

    const stored = store.write(claimed, body);
    if (!stored) {
      // A failed write is not a failed run: the client falls back to sending the bytes
      // inline, exactly as it did before this existed.
      return res.status(503).json({
        error: 'The asset could not be cached.',
        code: 'blob_write_failed',
      });
    }

    return res.status(204).end();
  });
}
