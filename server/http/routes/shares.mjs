/**
 * Share a project snapshot, and read one back.
 *
 *   POST /api/shares       publish, returns { id }
 *   GET  /api/shares/:id   the project, as JSON
 *
 * Unlike the asset cache next door, this one HAS a read route - and the difference is
 * worth stating, because the two look similar and the reasoning is opposite.
 *
 * A blob is named by its content, so anyone who can guess a name can read the file; the
 * only safe answer is to have no read route at all. A share is named by 128 random bits
 * that only the publisher has ever seen, and the whole point is to send that name to
 * somebody. Unguessable-and-shared is a different security model from
 * derived-and-therefore-known.
 *
 * It is still a capability URL, and it is treated as one: nothing enumerates shares,
 * the id never appears in a log, and a share expires.
 */

import { parseShareId } from '../../shares/store.mjs';

export function registerShareRoutes(app, { store, log }) {
  app.post('/api/shares', (req, res) => {
    if (!store.isReady) {
      return res.status(503).json({
        error: 'Sharing is not configured on this server.',
        code: 'share_unavailable',
      });
    }

    try {
      const id = store.publish(req.body || {});
      // The id is NOT logged. It is the whole secret; a log line is a copy of it in a
      // place the publisher did not choose and cannot delete.
      log('info', 'share_published', { files: (req.body?.files || []).length });
      return res.status(201).json({ id });
    } catch (error) {
      // The messages this throws are written for a student - "this project is too
      // large to share" - so they are passed through rather than replaced.
      return res.status(400).json({ error: error.message, code: 'share_rejected' });
    }
  });

  app.get('/api/shares/:id', (req, res) => {
    if (!store.isReady) {
      return res.status(503).json({
        error: 'Sharing is not configured on this server.',
        code: 'share_unavailable',
      });
    }

    if (!parseShareId(req.params.id)) {
      return res.status(400).json({ error: 'Not a share link.', code: 'share_invalid' });
    }

    const project = store.read(req.params.id);
    if (!project) {
      /*
       * Expired and never-existed are the same answer, deliberately.
       *
       * Distinguishing them would turn this into an oracle: an attacker guessing ids
       * could tell a real one from a wrong one without ever reading a project, which
       * is most of the work of finding one.
       */
      return res.status(404).json({
        error: 'This share link has expired or does not exist.',
        code: 'share_not_found',
      });
    }

    return res.json(project);
  });
}
