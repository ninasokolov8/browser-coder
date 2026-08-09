/**
 * Deciding what a multi-file import will create, before it creates anything.
 *
 * Three sources now produce a set of relative paths - a dragged OS folder, a picked
 * folder, and the entries of a ZIP - and all three need the same answers: which paths
 * are legal, which folders have to exist first, what collides, and where the limits
 * cut off. Getting that wrong with a ZIP is how an archive writes outside the
 * workspace, so the rules are here, pure, and tested rather than spread across three
 * event handlers.
 *
 * Paths are REJECTED, never repaired. A repaired traversal is still a caller who asked
 * for something we would not give them, and quietly writing it somewhere else is how
 * the server-side path defect (blueprint N-12) happened.
 */

import { normalizeWorkspacePath } from '../../../server/domain/paths.mjs';

export interface ImportCandidate {
  /** Relative path inside the import, e.g. `src/util/math.py`. */
  readonly path: string;
  /** Bytes, for the size cap. Unknown for a ZIP entry until it is read. */
  readonly size?: number;
}

export interface PlannedFile {
  /** The normalised path, relative to the import root. */
  readonly path: string;
  /** Final segment. */
  readonly name: string;
  /** Ancestor directories, outermost first: `['src', 'src/util']`. */
  readonly directories: readonly string[];
}

export interface ImportPlan {
  readonly files: readonly PlannedFile[];
  /** Every directory that must exist, outermost first and de-duplicated. */
  readonly directories: readonly string[];
  /** Structured rejections; the UI translates them at the presentation boundary. */
  readonly skipped: readonly ImportSkip[];
}

export type ImportSkip =
  | { readonly path: string; readonly reason: 'invalid-path'; readonly code: string }
  | { readonly path: string; readonly reason: 'duplicate' }
  | { readonly path: string; readonly reason: 'too-large'; readonly maxMegabytes: number }
  | { readonly path: string; readonly reason: 'file-limit'; readonly maxFiles: number };

export interface ImportLimits {
  /** Files already in the workspace, counted against `maxFiles`. */
  readonly existingFileCount: number;
  readonly maxFiles: number;
  readonly maxBytesPerFile: number;
}

/**
 * Entries a ZIP or an OS folder carries that are not part of the project.
 *
 * `__MACOSX` and `.DS_Store` are produced by macOS' own archiver, so a student on a
 * Mac would otherwise import a shadow copy of every file.
 */
function isNoise(path: string): boolean {
  const segments = path.split('/');
  return (
    segments[0] === '__MACOSX' ||
    segments.some(segment => segment === '.DS_Store' || segment === 'Thumbs.db') ||
    segments.some(segment => segment === '.git' || segment === 'node_modules')
  );
}

/**
 * Work out what to create, in order, for a set of relative paths.
 *
 * The returned directories are sorted outermost-first, so a caller can create them in
 * sequence and always find the parent already there.
 */
export function planImport(
  candidates: readonly ImportCandidate[],
  limits: ImportLimits,
): ImportPlan {
  const files: PlannedFile[] = [];
  const skipped: ImportSkip[] = [];
  const directories = new Set<string>();
  const seen = new Set<string>();

  let count = limits.existingFileCount;

  for (const candidate of candidates) {
    const raw = candidate.path.replace(/\\/g, '/').replace(/^\.\//, '');
    // A directory entry: the tree is derived from the file paths, so it carries no
    // information and is not an error either.
    if (raw.endsWith('/') || raw.length === 0) continue;
    if (isNoise(raw)) continue;

    const normalized = normalizeWorkspacePath(raw);
    if (!normalized.ok) {
      skipped.push({ path: raw, reason: 'invalid-path', code: normalized.code });
      continue;
    }

    if (seen.has(normalized.path)) {
      skipped.push({ path: normalized.path, reason: 'duplicate' });
      continue;
    }

    if (candidate.size !== undefined && candidate.size > limits.maxBytesPerFile) {
      skipped.push({
        path: normalized.path,
        reason: 'too-large',
        maxMegabytes: Math.round(limits.maxBytesPerFile / (1024 * 1024)),
      });
      continue;
    }

    if (count >= limits.maxFiles) {
      skipped.push({ path: normalized.path, reason: 'file-limit', maxFiles: limits.maxFiles });
      continue;
    }

    seen.add(normalized.path);
    count++;

    const segments = normalized.segments;
    const ancestors: string[] = [];
    for (let depth = 1; depth < segments.length; depth++) {
      const directory = segments.slice(0, depth).join('/');
      ancestors.push(directory);
      directories.add(directory);
    }

    files.push({
      path: normalized.path,
      name: segments[segments.length - 1],
      directories: ancestors,
    });
  }

  return {
    files,
    // Shortest first is outermost first, because every ancestor is a prefix.
    directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length),
    skipped,
  };
}

/**
 * The folder an archive should unpack into.
 *
 * Extracting straight into the drop target would scatter a hundred files across the
 * student's project with no single thing to undo. A folder named after the archive is
 * what desktop tools do, keeps the structure intact, and can be deleted in one action
 * if it was a mistake.
 */
export function archiveFolderName(archiveName: string): string {
  const withoutExtension = archiveName.replace(/\.zip$/i, '');
  const trimmed = withoutExtension.trim().replace(/[. ]+$/, '');
  return trimmed.length > 0 ? trimmed : 'archive';
}
