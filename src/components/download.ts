/**
 * Saving a file to the student's computer.
 *
 * ## Why this is not one function any more
 *
 * It used to be: `new Blob([content], { type: 'text/plain' })`. That is correct for
 * source code and wrong for everything else. Once the workspace could hold binary
 * assets, downloading a PNG produced a file containing its BASE64 TEXT under a `.png`
 * name - which opens in nothing, and reads as a corrupt image rather than a wrong
 * export. The project ZIP had the same defect in `zip.file(path, file.content)`.
 *
 * So a download now asks what the file IS. An asset is decoded back to bytes and
 * given its real media type; source stays text.
 */

import { assetTypeFor, base64ToBytes, isAssetName } from '../workspace/assets.ts';

/** Trigger a browser download for an already-prepared blob. */
function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoked on the next turn rather than immediately: revoking in the same task as
  // the click has historically cancelled the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The bytes a workspace file should be written as, and its media type.
 *
 * Exported because both download paths need it - a single file, and every entry in
 * the project ZIP - and they must agree. They did not before: the ZIP wrote base64
 * text for an asset while the single-file path wrote base64 text labelled
 * `text/plain`, so the two were wrong in different ways.
 */
export function fileBytesFor(
  name: string,
  content: string,
): { data: Uint8Array | string; mediaType: string } {
  if (!isAssetName(name)) {
    return { data: content, mediaType: 'text/plain;charset=utf-8' };
  }

  const type = assetTypeFor(name);

  // Checked, not caught. `base64ToBytes` is permissive by design - it ignores
  // characters outside the alphabet rather than throwing - so a try/catch here would
  // never fire and garbage would be written as if it were an image. The shape has to
  // be verified before decoding.
  if (!isBase64(content)) {
    // Content that is not base64 under an asset name must not silently become an
    // empty or garbled file: writing the raw text preserves whatever is there for the
    // student to inspect and recover.
    return { data: content, mediaType: 'text/plain;charset=utf-8' };
  }

  return {
    data: base64ToBytes(content),
    mediaType: type?.mediaType ?? 'application/octet-stream',
  };
}

/** Whether `text` is well-formed base64, ignoring the whitespace transports add. */
function isBase64(text: string): boolean {
  const clean = text.replace(/\s+/g, '');
  if (clean.length === 0) return true;
  // Length must be a multiple of 4, and padding only at the end.
  if (clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

/**
 * Download one workspace file under its own name and type.
 *
 * `filename` decides how `content` is interpreted, so callers pass the workspace name
 * rather than an arbitrary label.
 */
export function downloadFile(filename: string, content: string): void {
  const { data, mediaType } = fileBytesFor(filename, content);
  saveBlob(filename, new Blob([data as BlobPart], { type: mediaType }));
}

/** Download an already-built blob, for the project ZIP. */
export function downloadBlob(filename: string, blob: Blob): void {
  saveBlob(filename, blob);
}
