/**
 * The shareable web-preview routes.
 *
 * Three endpoints, and the split between them is the security boundary:
 *
 *   POST /api/previews            publish an immutable project
 *   GET  /preview/:id             the wrapper document - never student code
 *   GET  /preview/:id/*           the student's files, sandboxed by CSP
 *
 * The wrapper is a separate document precisely so the top-level page on the IDE
 * origin contains nothing the student wrote. Everything they wrote is served by the
 * third route, which stamps a `sandbox` CSP directive on the response itself - so
 * the containment survives a direct navigation, not only framing (V-03).
 */

import fs from 'node:fs';

import { PREVIEW_ID_PATTERN, PREVIEW_MANIFEST_NAME, validatePreviewProject } from '../../previews/project.mjs';
import { buildLegacyPreviewShell, buildPreviewShell } from '../../previews/shell.mjs';
import {
  setLegacyPreviewShellHeaders,
  setPreviewAssetHeaders,
  setPreviewShellHeaders,
} from '../../previews/headers.mjs';

const STORAGE_UNAVAILABLE_JSON =
  'Preview storage is unavailable. Configure PREVIEW_STORAGE_DIR as a writable persistent volume.';
const STORAGE_UNAVAILABLE_TEXT = 'Preview storage is unavailable';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {import('../../previews/store.mjs').PreviewStore} deps.store
 * @param {Function} deps.log
 */
export function registerPreviewRoutes(app, { store, log }) {
  app.post('/api/previews', async (req, res) => {
    if (!store.isReady) {
      return res.status(503).json({ error: STORAGE_UNAVAILABLE_JSON });
    }

    const rawEntryPath = typeof req.body?.entryPath === 'string' ? req.body.entryPath : 'index.html';

    // Backward compatibility for an older frontend that sent one bundled HTML
    // string. New clients send the entire workspace in files[].
    const rawFiles = Array.isArray(req.body?.files)
      ? req.body.files
      : typeof req.body?.html === 'string'
        ? [{ path: rawEntryPath, content: req.body.html, language: 'html' }]
        : [];

    let project;
    try {
      project = validatePreviewProject(rawFiles, rawEntryPath, store.limits);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Invalid preview project',
      });
    }

    try {
      const previewId = await store.publish(project.files, project.entryPath);
      const previewPath = `/preview/${previewId}`;

      return res.status(201).json({
        id: previewId,
        entryPath: project.entryPath,
        fileCount: project.files.length,
        previewPath,
        previewUrl: previewPath,
        expiresAt: new Date(Date.now() + store.limits.ttlMs).toISOString(),
      });
    } catch (error) {
      log('error', 'Failed to publish preview', { requestId: req.id, error: error.message });
      return res.status(500).json({ error: 'Could not publish preview' });
    }
  });

  // The wrapper. Student code is never executed in this top-level document; it runs
  // inside the sandboxed iframe loaded from the immutable project files.
  app.get('/preview/:previewId', async (req, res) => {
    if (!store.isReady) {
      return res.status(503).type('text/plain').send(STORAGE_UNAVAILABLE_TEXT);
    }

    if (!PREVIEW_ID_PATTERN.test(req.params.previewId)) {
      return res.status(404).type('text/plain').send('Preview not found');
    }

    try {
      const manifest = await store.readManifest(req.params.previewId);
      if (manifest) {
        if (store.isExpired(manifest.createdAt)) {
          await store.remove(req.params.previewId).catch(() => {});
          return res.status(410).type('text/plain').send('This preview has expired');
        }

        setPreviewShellHeaders(res);
        return res
          .status(200)
          .type('html')
          .send(buildPreviewShell(req.params.previewId, manifest.entryPath));
      }

      // Preserve already-issued one-file preview URLs from the previous format.
      // These have no manifest, so their age comes from the file's mtime.
      const legacyPath = store.legacyFilePath(req.params.previewId);
      if (!legacyPath) {
        return res.status(404).type('text/plain').send('Preview not found');
      }

      const stat = await fs.promises.stat(legacyPath);
      if (Date.now() - stat.mtimeMs > store.limits.ttlMs) {
        await fs.promises.unlink(legacyPath).catch(() => {});
        return res.status(410).type('text/plain').send('This preview has expired');
      }

      const html = await fs.promises.readFile(legacyPath, 'utf8');
      setLegacyPreviewShellHeaders(res);
      return res.status(200).type('html').send(buildLegacyPreviewShell(html));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return res.status(404).type('text/plain').send('Preview not found');
      }

      log('error', 'Failed to load preview', {
        requestId: req.id,
        previewId: req.params.previewId,
        error: error.message,
      });
      return res.status(500).type('text/plain').send('Could not load preview');
    }
  });

  // Every immutable workspace file below the preview id. Serving them at real
  // relative paths is what makes `style.css`, `./js/app.js` and `../images/logo.svg`
  // behave the way they do in a normal website, including navigation between
  // several HTML files.
  app.get('/preview/:previewId/*', async (req, res) => {
    if (!store.isReady) {
      return res.status(503).type('text/plain').send(STORAGE_UNAVAILABLE_TEXT);
    }

    const previewId = req.params.previewId;
    const requestedPath = req.params[0] || '';
    if (!PREVIEW_ID_PATTERN.test(previewId)) {
      return res.status(404).type('text/plain').send('Preview file not found');
    }

    try {
      const manifest = await store.readManifest(previewId);
      if (!manifest) {
        return res.status(404).type('text/plain').send('Preview file not found');
      }

      if (store.isExpired(manifest.createdAt)) {
        await store.remove(previewId).catch(() => {});
        return res.status(410).type('text/plain').send('This preview has expired');
      }

      const asset = store.assetPath(previewId, requestedPath);
      // The manifest is service metadata, not part of the published project, so it
      // is not addressable even though it lives in the same directory.
      if (!asset || asset.normalizedPath === PREVIEW_MANIFEST_NAME) {
        return res.status(404).type('text/plain').send('Preview file not found');
      }

      const content = await fs.promises.readFile(asset.filePath);
      setPreviewAssetHeaders(res, asset.normalizedPath);
      return res.status(200).send(content);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        return res.status(404).type('text/plain').send('Preview file not found');
      }

      log('error', 'Failed to load preview file', {
        requestId: req.id,
        previewId,
        requestedPath,
        error: error.message,
      });
      return res.status(500).type('text/plain').send('Could not load preview file');
    }
  });
}
