/**
 * The viewer shown instead of the editor when the open file is a binary asset.
 *
 * ## Why not just open it in Monaco
 *
 * Because the content is base64. Monaco would happily show it, let the student type
 * in it, and mark the document dirty - at which point autosave persists a corrupted
 * image and the original is gone. An asset must never reach a text editor, so this
 * takes over the editor area entirely and no model is created.
 *
 * ## Why a data URL and an <img>
 *
 * `<img src="data:image/png;base64,...">` is the restricted rendering context: a
 * browser runs no scripts and fetches no external references for an image loaded that
 * way. The media type comes from the ASSET_TYPES table, keyed by the extension that
 * was validated against the file's own magic bytes on import - so the type declared
 * here cannot be something the bytes disagree with.
 *
 * SVG is deliberately NOT handled here. It is XML text with its own editor, language
 * service and sanitiser, and it is the one image format that can carry script; it
 * keeps going through the text path that checks it.
 */

import {
  ASSET_LANGUAGE_ID,
  assetDataUrl,
  assetTypeFor,
  base64ToBytes,
  formatBytes,
  type AssetType,
} from '../workspace/assets.ts';
import { t } from '../i18n/index.ts';
import { runtime } from '../app/runtime';

const VIEWER_ID = 'asset-viewer';

/** True when this document must be shown by the viewer rather than the editor. */
export function isAssetFile(
  file: { language?: string; name?: string } | null | undefined,
): boolean {
  if (!file) return false;
  if (file.language === ASSET_LANGUAGE_ID) return true;
  // A file whose language was never set - imported by an older build, or supplied by
  // a host - is still an asset if its name says so. Falling through to Monaco would
  // be the corrupting case.
  return file.name ? assetTypeFor(file.name) !== null : false;
}

function viewerElement(): HTMLElement | null {
  return document.getElementById(VIEWER_ID);
}

/** Remove the viewer and let the editor show again. */
export function hideAssetViewer(): void {
  const viewer = viewerElement();
  if (viewer) viewer.hidden = true;
  const editorHost = document.getElementById('editor');
  if (editorHost) editorHost.style.display = '';
}

interface AssetDetails {
  readonly type: AssetType;
  readonly base64: string;
  readonly byteLength: number;
}

function describe(fileName: string, content: string): AssetDetails | null {
  const type = assetTypeFor(fileName);
  if (!type) return null;
  // Length computed from the decoded bytes rather than the base64 text, so the size
  // shown is the file's real size and not 4/3 of it.
  return { type, base64: content, byteLength: base64ToBytes(content).length };
}

/**
 * Show `file` in the asset viewer, replacing the editor.
 *
 * Returns false when the file is not an asset, so the caller can fall through to the
 * normal editor path rather than having to check twice.
 */
export function showAssetViewer(file: { name: string; content: string; path?: string }): boolean {
  const details = describe(file.name, file.content);
  if (!details) return false;

  const host = document.getElementById('editor-container');
  if (!host) return false;

  let viewer = viewerElement();
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = VIEWER_ID;
    host.appendChild(viewer);
  }

  viewer.hidden = false;
  viewer.textContent = '';

  // Monaco keeps its own DOM; hiding it rather than removing it means switching back
  // to a code file does not have to rebuild the editor.
  const editorHost = document.getElementById('editor');
  if (editorHost) editorHost.style.display = 'none';

  const panel = document.createElement('div');
  panel.className = 'asset-panel';

  if (details.type.displayable) {
    const image = document.createElement('img');
    image.className = 'asset-image';
    image.alt = file.name;
    image.src = assetDataUrl(details.type, details.base64);

    // A file that passed the signature check can still be truncated or corrupt, and
    // a broken <img> with no explanation reads as an IDE fault.
    image.addEventListener('error', () => {
      image.remove();
      const failed = document.createElement('div');
      failed.className = 'asset-unavailable';
      failed.textContent = t('asset.displayFailed', { name: file.name });
      panel.prepend(failed);
    });

    panel.appendChild(image);
  } else {
    const notice = document.createElement('div');
    notice.className = 'asset-unavailable';
    // Honest about WHY, since "cannot preview" alone reads like a missing feature.
    notice.textContent =
      details.type.mediaType === 'application/pdf'
        ? t('asset.pdfNoPreview', { name: file.name })
        : t('asset.noPreview', { name: file.name });
    panel.appendChild(notice);
  }

  const meta = document.createElement('div');
  meta.className = 'asset-meta';

  const rows: Array<[string, string]> = [
    [t('asset.name'), file.name],
    [t('asset.type'), details.type.mediaType],
    [t('asset.size'), formatBytes(details.byteLength)],
  ];
  if (file.path && file.path !== file.name) rows.push([t('asset.path'), file.path]);

  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'asset-meta-row';

    const key = document.createElement('span');
    key.className = 'asset-meta-key';
    key.textContent = label;

    const text = document.createElement('span');
    text.className = 'asset-meta-value';
    // textContent, never innerHTML: the name comes from a file the student chose.
    text.textContent = value;

    row.append(key, text);
    meta.appendChild(row);
  }

  panel.appendChild(meta);

  const hint = document.createElement('div');
  hint.className = 'asset-hint';
  hint.textContent = details.type.kind === 'image'
    ? t('asset.imageHint', { name: file.name })
    : t('asset.fileHint');
  panel.appendChild(hint);

  viewer.appendChild(panel);
  return true;
}

window.addEventListener('languageChanged', () => {
  const active = runtime.tabManager?.getActiveTab();
  if (active && isAssetFile(active.file)) {
    showAssetViewer({
      name: active.file.name,
      content: active.file.content,
      path: active.file.path,
    });
  }
});

/*
 * There was an `initializeAssetViewer()` here: a MutationObserver on the tab strip that
 * showed or hid the viewer whenever the active tab changed.
 *
 * It was exported and called by nobody, so none of it ran. Its doc comment claimed it
 * was what kept the viewer in step "rather than every call site that opens a file",
 * which described the opposite of what the code did - the call sites in
 * features/editor-core.ts are the ones that actually drive it, and they always were.
 *
 * Deleted rather than wired up. Watching the DOM to infer which document is active is a
 * worse mechanism than the tab manager's own callback, and having both would mean two
 * things deciding when an image is on screen. The one gap it would genuinely have
 * covered - closing the LAST tab activates nothing, so onTabSwitch never fires - is now
 * handled in `onTabClose`, where the event actually happens.
 */
