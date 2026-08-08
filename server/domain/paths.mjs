/**
 * Canonical workspace path rules - the single source of truth.
 *
 * Before this module, /api/run and /api/run/interactive each carried their own
 * near-identical copy of the checks (blueprint V-26), and both copies were
 * partly unreachable: normalization stripped a leading slash *before* the
 * absolute-path guard tested for one, so "/etc/passwd.py" was silently
 * rewritten to "etc/passwd.py" and accepted, and "/main.py" plus "main.py" in
 * one project collapsed onto the same file with one overwriting the other
 * (blueprint N-12).
 *
 * The rules here are deliberately stricter than "cannot escape the job
 * directory". A path that cannot escape can still collide, shadow a generated
 * artifact, or be unrepresentable on the host filesystem. Every rejection is a
 * stable, typed reason so the HTTP layer can produce a 4xx a caller can act on.
 *
 * Pure module: no fs, no express, no language runtimes. Imported by the server
 * today and intended to be shared with the browser workspace so both sides
 * agree on what a legal path is.
 */

/** Reserved Windows device names. Illegal as a bare segment or as a stem. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Names the service owns inside a job or preview directory. A user file may
 * never occupy one, or it would shadow trusted content.
 */
const RESERVED_NAMES = new Set([
  '.browser-coder-preview.json',
]);

/**
 * Directory names whose contents are build output, never source. Accepting one
 * from a caller would let generated artifacts be supplied as inputs.
 */
const RESERVED_DIRECTORIES = new Set(['bin', 'obj', 'node_modules', '__pycache__']);

export const DEFAULT_PATH_LIMITS = Object.freeze({
  maxPathChars: 300,
  maxSegmentChars: 120,
  maxDepth: 24,
});

export const PathError = Object.freeze({
  EMPTY: 'path_empty',
  NOT_A_STRING: 'path_not_a_string',
  ABSOLUTE: 'path_absolute',
  DRIVE_LETTER: 'path_drive_letter',
  TRAVERSAL: 'path_traversal',
  DOT_SEGMENT: 'path_dot_segment',
  EMPTY_SEGMENT: 'path_empty_segment',
  NUL_BYTE: 'path_nul_byte',
  CONTROL_CHARACTER: 'path_control_character',
  TOO_LONG: 'path_too_long',
  SEGMENT_TOO_LONG: 'path_segment_too_long',
  TOO_DEEP: 'path_too_deep',
  RESERVED_DEVICE_NAME: 'path_reserved_device_name',
  RESERVED_NAME: 'path_reserved_name',
  RESERVED_DIRECTORY: 'path_reserved_directory',
  TRAILING_DOT_OR_SPACE: 'path_trailing_dot_or_space',
  DUPLICATE: 'path_duplicate',
  CASE_COLLISION: 'path_case_collision',
  FILE_DIRECTORY_CONFLICT: 'path_file_directory_conflict',
});

function failure(code, message, path) {
  return { ok: false, code, message, path };
}

/**
 * Validate and canonicalize one relative workspace path.
 *
 * Rejects rather than repairs. Silent repair is what produced N-12: a caller
 * who sends a path we cannot represent must be told, not quietly given a
 * different file.
 *
 * @param {unknown} raw
 * @param {typeof DEFAULT_PATH_LIMITS} [limits]
 * @returns {{ok: true, path: string, segments: string[]} | {ok: false, code: string, message: string, path?: string}}
 */
export function normalizeWorkspacePath(raw, limits = DEFAULT_PATH_LIMITS) {
  if (typeof raw !== 'string') {
    return failure(PathError.NOT_A_STRING, 'File path must be a string');
  }

  // Accept Windows-style separators from clients, but only as separators. This
  // conversion happens first so every later rule sees one path shape.
  const candidate = raw.replace(/\\/g, '/');

  if (candidate.length === 0) {
    return failure(PathError.EMPTY, 'File path must not be empty');
  }

  if (candidate.includes('\0')) {
    return failure(PathError.NUL_BYTE, 'File path must not contain a NUL byte', raw);
  }

  // C0 controls plus DEL. These are legal in a POSIX filename but cannot
  // round-trip through a URL, a ZIP entry or a terminal, so a path containing
  // one would pass validation and then break export, preview or import.
  if (/[\u0001-\u001f\u007f]/.test(candidate)) {
    return failure(
      PathError.CONTROL_CHARACTER,
      'File path must not contain control characters',
      raw,
    );
  }

  // Checked BEFORE any stripping. The original defect was doing this after.
  if (candidate.startsWith('/')) {
    return failure(
      PathError.ABSOLUTE,
      'File path must be relative to the project root, not absolute',
      raw,
    );
  }

  if (/^[a-zA-Z]:/.test(candidate)) {
    return failure(
      PathError.DRIVE_LETTER,
      'File path must not contain a drive letter',
      raw,
    );
  }

  if (candidate.length > limits.maxPathChars) {
    return failure(
      PathError.TOO_LONG,
      `File path is longer than ${limits.maxPathChars} characters`,
      raw,
    );
  }

  const segments = candidate.split('/');

  if (segments.length > limits.maxDepth) {
    return failure(
      PathError.TOO_DEEP,
      `File path is nested deeper than ${limits.maxDepth} levels`,
      raw,
    );
  }

  for (const segment of segments) {
    if (segment.length === 0) {
      // Covers both a trailing slash and a "//" run.
      return failure(
        PathError.EMPTY_SEGMENT,
        'File path must not contain an empty path segment',
        raw,
      );
    }

    if (segment === '.') {
      return failure(PathError.DOT_SEGMENT, 'File path must not contain a "." segment', raw);
    }

    if (segment === '..') {
      return failure(PathError.TRAVERSAL, 'File path must not contain a ".." segment', raw);
    }

    if (segment.length > limits.maxSegmentChars) {
      return failure(
        PathError.SEGMENT_TOO_LONG,
        `Path segment "${segment}" is longer than ${limits.maxSegmentChars} characters`,
        raw,
      );
    }

    // Windows silently strips these, so two distinct names can land on one file.
    if (/[. ]$/.test(segment)) {
      return failure(
        PathError.TRAILING_DOT_OR_SPACE,
        `Path segment "${segment}" must not end with a dot or a space`,
        raw,
      );
    }

    // "NUL", "nul.txt" and "CON" are all unusable as filenames on Windows.
    const stem = segment.split('.')[0].toLowerCase();
    if (WINDOWS_RESERVED.has(stem)) {
      return failure(
        PathError.RESERVED_DEVICE_NAME,
        `Path segment "${segment}" is a reserved device name`,
        raw,
      );
    }

    if (RESERVED_NAMES.has(segment.toLowerCase())) {
      return failure(
        PathError.RESERVED_NAME,
        `"${segment}" is reserved for internal use`,
        raw,
      );
    }
  }

  // Only reject a build directory when it is a *directory* in the supplied path.
  // A file literally named "bin" is harmless; "bin/app.dll" is generated output.
  for (const segment of segments.slice(0, -1)) {
    if (RESERVED_DIRECTORIES.has(segment.toLowerCase())) {
      return failure(
        PathError.RESERVED_DIRECTORY,
        `"${segment}/" holds generated output and cannot be supplied as source`,
        raw,
      );
    }
  }

  return { ok: true, path: segments.join('/'), segments };
}

/**
 * Collision key for a path.
 *
 * Deliberately case-insensitive and Unicode-normalized even though stored paths
 * keep their exact bytes. The production container is Linux (case-sensitive)
 * while authors work on macOS and Windows (case-insensitive), so a project
 * containing both `Main.java` and `main.java` builds on the server and breaks on
 * every author's machine. Rejecting the pair is the only behaviour that is the
 * same everywhere.
 *
 * NFC is chosen over NFD because it is what browsers and most editors emit.
 */
export function pathCollisionKey(path) {
  return path.normalize('NFC').toLowerCase();
}

/**
 * Validate a whole supplied file set.
 *
 * Beyond per-path rules this enforces the set-level invariants that no
 * per-path check can see: exact duplicates, case/Unicode collisions, and a path
 * used as both a file and a directory prefix (`pkg` and `pkg/mod.py`, which
 * cannot both exist on a real filesystem).
 *
 * @param {Array<{path?: string, name?: string, content?: unknown, language?: unknown, isMain?: unknown}>} rawFiles
 * @param {object} [options]
 * @param {typeof DEFAULT_PATH_LIMITS} [options.limits]
 * @param {number} [options.maxFiles]
 * @param {number} [options.maxTotalContentChars]
 * @returns {{ok: true, files: Array<{name: string, content: string, language: unknown, isMain: boolean}>, totalContentChars: number} | {ok: false, code: string, message: string, path?: string}}
 */
export function validateFileSet(rawFiles, options = {}) {
  const limits = options.limits || DEFAULT_PATH_LIMITS;

  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    return failure('files_empty', 'files[] must contain at least one named file');
  }

  if (options.maxFiles !== undefined && rawFiles.length > options.maxFiles) {
    // Checked before per-file work so a huge array cannot make validation itself
    // the expensive operation.
    return failure('files_too_many', `Too many files (max ${options.maxFiles})`);
  }

  const files = [];
  const byCollisionKey = new Map();
  const directoryPrefixes = new Map();
  let totalContentChars = 0;

  for (const rawFile of rawFiles) {
    const rawPath = rawFile?.path ?? rawFile?.name;
    const normalized = normalizeWorkspacePath(rawPath, limits);
    if (!normalized.ok) return normalized;

    const key = pathCollisionKey(normalized.path);
    const existing = byCollisionKey.get(key);
    if (existing !== undefined) {
      return existing === normalized.path
        ? failure(PathError.DUPLICATE, `Duplicate file path: ${normalized.path}`, normalized.path)
        : failure(
            PathError.CASE_COLLISION,
            `File paths "${existing}" and "${normalized.path}" differ only by case or Unicode form and cannot coexist`,
            normalized.path,
          );
    }
    byCollisionKey.set(key, normalized.path);

    // Record every ancestor so a later file/directory conflict is detectable in
    // one pass regardless of the order the caller supplied.
    for (let depth = 1; depth < normalized.segments.length; depth++) {
      const prefix = normalized.segments.slice(0, depth).join('/');
      if (!directoryPrefixes.has(pathCollisionKey(prefix))) {
        directoryPrefixes.set(pathCollisionKey(prefix), prefix);
      }
    }

    const content = typeof rawFile?.content === 'string' ? rawFile.content : '';
    totalContentChars += content.length;

    if (
      options.maxTotalContentChars !== undefined &&
      totalContentChars > options.maxTotalContentChars
    ) {
      return failure(
        'files_too_large',
        `Total code size too large (max ${options.maxTotalContentChars / 1000}KB)`,
      );
    }

    files.push({
      name: normalized.path,
      content,
      language: rawFile?.language,
      isMain: rawFile?.isMain === true,
    });
  }

  for (const [key, prefix] of directoryPrefixes) {
    const conflicting = byCollisionKey.get(key);
    if (conflicting !== undefined) {
      return failure(
        PathError.FILE_DIRECTORY_CONFLICT,
        `"${conflicting}" is used as both a file and a directory`,
        conflicting,
      );
    }
  }

  return { ok: true, files, totalContentChars };
}

/**
 * Resolve which file a run should start from.
 *
 * Separated from validateFileSet because "which file is the entry point" is a
 * different question from "is this file set legal", and because the previous
 * implementation conflated two distinct failures: a requested-but-absent entry
 * point reported "No entry file was provided", making the dedicated
 * not-found branch unreachable dead code (blueprint N-11).
 *
 * @param {Array<{name: string, isMain: boolean}>} files already validated
 * @param {unknown} requestedEntryPoint
 * @returns {{ok: true, entryPoint: string} | {ok: false, code: string, message: string}}
 */
export function resolveEntryPoint(files, requestedEntryPoint) {
  if (requestedEntryPoint !== undefined && requestedEntryPoint !== null && requestedEntryPoint !== '') {
    const normalized = normalizeWorkspacePath(requestedEntryPoint);
    if (!normalized.ok) {
      return failure(
        'entry_point_invalid',
        `Invalid entryPoint: ${normalized.message}`,
      );
    }

    const match = files.find(file => file.name === normalized.path);
    if (!match) {
      return failure(
        'entry_point_not_found',
        `entryPoint "${normalized.path}" was not found in files`,
      );
    }
    return { ok: true, entryPoint: match.name };
  }

  const flagged = files.find(file => file.isMain);
  if (flagged) return { ok: true, entryPoint: flagged.name };

  if (files.length === 0) {
    return failure('entry_point_missing', 'No entry file was provided');
  }

  // Legacy rule, preserved: with neither an explicit entryPoint nor an isMain
  // flag, the first supplied file runs.
  return { ok: true, entryPoint: files[0].name };
}
