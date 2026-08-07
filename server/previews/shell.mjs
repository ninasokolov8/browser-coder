/**
 * The HTML wrappers served at /preview/:id.
 *
 * Pure string building - no fs, no express - so the sandbox tokens can be asserted
 * directly by a test rather than only observed through a live response.
 */

export function escapeHtmlAttribute(value) {
  // Sufficient for a value inside a DOUBLE-quoted attribute, which is the only way
  // these are used. `'` is deliberately not escaped; adding it would change bytes
  // that the frozen preview contract already emits.
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function encodePreviewProjectPath(filePath) {
  // Each segment separately, so separators survive while spaces and non-ASCII
  // characters are encoded.
  return filePath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Sandbox tokens granted to the preview iframe.
 *
 * `allow-same-origin` is absent and must stay absent: granting it together with
 * `allow-scripts` is equivalent to having no sandbox at all.
 *
 * `allow-popups-to-escape-sandbox` was previously granted (V-04). It lets
 * sandboxed content open a window that does NOT inherit the sandbox, and since the
 * popup target can be another same-origin preview document, student code could
 * escape into an unsandboxed context holding the IDE origin - defeating the only
 * control the wrapper provided. `allow-popups` went with it: a popup that inherits
 * the sandbox is harmless, but nothing in a beginner web project needs one, so
 * keeping it only enlarges the surface.
 */
const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-downloads allow-pointer-lock';

function shellDocument(iframeAttribute) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Browser Coder Preview</title>
  <style>
    html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden;background:#fff}
  </style>
</head>
<body>
  <iframe
    title="Browser Coder website preview"
    sandbox="${IFRAME_SANDBOX}"
    referrerpolicy="no-referrer"
    ${iframeAttribute}
  ></iframe>
</body>
</html>`;
}

/**
 * The wrapper for a multi-file project.
 *
 * This wrapper is defence in depth, NOT the boundary. The real control is the
 * `sandbox` CSP directive on the asset response itself (see headers.mjs), because
 * that also applies when a document is navigated to directly rather than framed.
 */
export function buildPreviewShell(previewId, entryPath) {
  // Relative to /preview/:id, so any outer mount prefix - such as Arc Academy's
  // /coder/ - is preserved without the server needing to know about it.
  const iframeSrc = `./${encodeURIComponent(previewId)}/${encodePreviewProjectPath(entryPath)}`;
  return shellDocument(`src="${escapeHtmlAttribute(iframeSrc)}"`);
}

/** The wrapper for a legacy single-document preview, which still uses srcdoc. */
export function buildLegacyPreviewShell(html) {
  return shellDocument(`srcdoc="${escapeHtmlAttribute(html)}"`);
}
