/**
 * Preview project rules: what a publishable project may contain.
 *
 * Pure module - no fs, no express, no CONFIG import. Limits arrive as an argument
 * so the rules can be unit-tested without standing up a server, which matters
 * because these are the checks that keep a published preview from writing outside
 * its own directory.
 *
 * Deliberately SEPARATE from `server/domain/paths.mjs` even though the two look
 * similar. That module governs paths inside a run's job directory and is shared
 * with the browser workspace; this one governs paths inside an immutable published
 * preview, where the constraints differ: a preview may contain `bin/`, has its own
 * reserved manifest name, and permits a much wider set of file types because it is
 * served to a browser rather than compiled. Merging them would mean one set of
 * rules serving two different threat models.
 */

import path from 'node:path';

export const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const PREVIEW_MANIFEST_NAME = '.browser-coder-preview.json';

/**
 * Canonicalize one path inside a preview project, or return null.
 *
 * `..` is rejected on the ORIGINAL segments, before normalization, rather than
 * checked afterwards. Normalizing first and inspecting the result is the mistake
 * that lets `a/../../b` collapse into something that looks acceptable.
 */
export function normalizePreviewProjectPath(value, limits) {
  if (typeof value !== 'string') return null;

  const slashPath = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!slashPath || slashPath.length > limits.maxPathChars) return null;
  if (slashPath.includes('\0')) return null;

  const originalSegments = slashPath.split('/');
  if (originalSegments.some(segment => segment === '..')) return null;

  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) return null;
  if (path.posix.isAbsolute(normalized)) return null;

  return normalized;
}

/**
 * Validate a whole preview project.
 *
 * Throws rather than returning a result object, because every caller is an HTTP
 * handler that turns the message straight into a 400 - and the messages are part
 * of the frozen v1 surface.
 */
export function validatePreviewProject(rawFiles, rawEntryPath, limits) {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error('Preview project files are required');
  }

  if (rawFiles.length > limits.maxFileCount) {
    throw new Error(`Preview contains too many files. Maximum is ${limits.maxFileCount}`);
  }

  const filesByPath = new Map();
  let totalBytes = 0;

  for (const rawFile of rawFiles) {
    const filePath = normalizePreviewProjectPath(rawFile?.path, limits);
    if (!filePath) {
      throw new Error(`Invalid preview file path: ${String(rawFile?.path || '')}`);
    }

    if (filesByPath.has(filePath)) {
      throw new Error(`Duplicate preview file path: ${filePath}`);
    }

    const content = typeof rawFile?.content === 'string' ? rawFile.content : '';
    totalBytes += Buffer.byteLength(filePath, 'utf8');
    totalBytes += Buffer.byteLength(content, 'utf8');

    if (totalBytes > limits.maxHtmlBytes) {
      throw new Error(
        `Preview is too large. Maximum project size is ${limits.maxHtmlBytes} bytes`,
      );
    }

    filesByPath.set(filePath, {
      path: filePath,
      content,
      language: typeof rawFile?.language === 'string'
        ? rawFile.language.slice(0, 100)
        : undefined,
    });
  }

  const entryPath = normalizePreviewProjectPath(rawEntryPath || 'index.html', limits);
  if (!entryPath || !filesByPath.has(entryPath)) {
    throw new Error('The preview entry HTML file was not included in the project');
  }

  if (!/\.html?$/i.test(entryPath)) {
    throw new Error('The preview entry file must be an HTML file');
  }

  return {
    entryPath,
    files: [...filesByPath.values()],
    totalBytes,
  };
}

/**
 * Resolve a requested asset path inside a preview directory, or null.
 *
 * The containment check compares against `directory + separator`, not just
 * `directory`, so a sibling whose name merely starts with the same characters
 * (`/previews/abc-evil` against `/previews/abc`) cannot pass.
 */
export function safePreviewAssetPath(storageDir, previewId, requestedPath, limits) {
  if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
  const normalizedPath = normalizePreviewProjectPath(requestedPath, limits);
  if (!normalizedPath) return null;

  const directory = path.join(storageDir, previewId);
  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(directory, normalizedPath);
  if (!resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`)) return null;

  return { directory, normalizedPath, filePath: resolvedFile };
}
