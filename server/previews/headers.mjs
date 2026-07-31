/**
 * Response headers for preview documents and assets.
 *
 * The security-critical part of the preview feature. Kept in one module so the
 * policy for a served student file is stated once, and so a future content type
 * cannot be added to the MIME table without passing the active-document question
 * that sits right next to it.
 */

import path from 'node:path';

const TEXT_MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
]);

const BINARY_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.avif', 'image/avif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.pdf', 'application/pdf'],
]);

export function previewMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_MIME_TYPES.get(extension)
    || BINARY_MIME_TYPES.get(extension)
    || 'application/octet-stream';
}

/**
 * Formats a browser will execute as a document if navigated to directly.
 *
 * SVG belongs here and is easy to miss: it can carry `<script>`, and navigating to
 * an `.svg` runs it as a document on the serving origin. XML can too, via XSLT.
 */
const ACTIVE_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml', '.xsl', '.xslt']);

export function isActivePreviewDocument(filePath) {
  return ACTIVE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'public, max-age=300, immutable');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function setPreviewShellHeaders(res) {
  setCommonHeaders(res);
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; child-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *",
  );
}

export function setLegacyPreviewShellHeaders(res) {
  setCommonHeaders(res);
  // Legacy previews stored a single bundled HTML string and still use `srcdoc`, so
  // the shell policy has to permit the student document that srcdoc inherits.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:",
      "style-src 'unsafe-inline' data: blob: http: https:",
      'img-src data: blob: http: https:',
      'font-src data: blob: http: https:',
      'media-src data: blob: http: https:',
      'connect-src data: blob: http: https: ws: wss:',
      'worker-src data: blob: http: https:',
      "frame-src 'self' data: blob: http: https:",
      "child-src 'self' data: blob: http: https:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'frame-ancestors *',
    ].join('; '),
  );
}

/**
 * Headers for one file inside a published preview.
 *
 * ── V-03 ────────────────────────────────────────────────────────────────────────
 *
 * The reasoning this replaces was that student pages "run in an iframe without
 * allow-same-origin, so they receive an opaque origin". True of the wrapper - and
 * irrelevant, because the iframe is not the only way to reach the file. Navigating
 * straight to /preview/:id/index.html serves the same document as a TOP-LEVEL page
 * on the IDE origin, where no sandbox attribute applies and
 * `script-src 'unsafe-inline' 'unsafe-eval'` runs the student's JavaScript with full
 * authority over Browser Coder's origin: its cookies, its IndexedDB workspaces, and
 * its API with the caller's credentials. That is stored XSS, and it was reachable by
 * simply linking to the asset URL.
 *
 * The `sandbox` CSP directive is the fix that does not depend on how the document
 * was reached: it forces an opaque origin on the RESPONSE, so a direct navigation
 * gets the same containment as the iframe.
 */
export function setPreviewAssetHeaders(res, filePath) {
  setCommonHeaders(res);
  res.setHeader('Content-Type', previewMimeType(filePath));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (!isActivePreviewDocument(filePath)) return;

  // allow-scripts is granted because running JavaScript is the entire point of an
  // HTML preview. allow-same-origin is NOT: withholding it is what makes the origin
  // opaque, and granting both would be equivalent to no sandbox at all. Also
  // absent: allow-top-navigation (so a preview cannot navigate its parent away),
  // allow-popups, and allow-storage-access-by-user-activation.
  const sandboxDirective =
    'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads';

  // An SVG or XML document is served for two very different purposes: as an `<img>`
  // referenced by a page, where scripts never run and this is moot, and as a
  // navigated document, where they do. There is no way to tell them apart
  // per-request, so the strict policy applies to both - an SVG used as an image is
  // unaffected by script-src, because images do not execute scripts.
  const scriptPolicy = /\.(svg|xml|xhtml|xsl|xslt)$/i.test(filePath)
    ? "script-src 'none'"
    : "script-src 'unsafe-inline' 'unsafe-eval' data: blob: http: https:";

  res.setHeader(
    'Content-Security-Policy',
    [
      sandboxDirective,
      "default-src 'none'",
      scriptPolicy,
      "style-src 'unsafe-inline' data: blob: http: https:",
      'img-src data: blob: http: https:',
      'font-src data: blob: http: https:',
      'media-src data: blob: http: https:',
      'connect-src data: blob: http: https: ws: wss:',
      'worker-src data: blob: http: https:',
      'frame-src data: blob: http: https:',
      'child-src data: blob: http: https:',
      'manifest-src data: blob: http: https:',
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'frame-ancestors *',
    ].join('; '),
  );

  // Defence in depth for the case the CSP is not honoured: an opaque-origin document
  // cannot register a service worker anyway, but stating the intent costs nothing.
  res.setHeader('Permissions-Policy', 'clipboard-read=(), clipboard-write=()');
}
