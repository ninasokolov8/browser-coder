/**
 * Types for the canonical path rules, so the browser workspace can import the
 * SAME module the server enforces instead of carrying a second copy.
 *
 * A duplicated validator is worse than no validator: the two drift, and the
 * divergence only shows up as a file the IDE accepts and the server rejects
 * (or worse, one both accept and resolve differently). paths.mjs is pure - no
 * fs, no express, no node builtins, no imports at all - so bundling it into the
 * client costs a few kilobytes and buys exact agreement.
 *
 * Hand-written rather than generated because paths.mjs must stay plain ESM for
 * the server to import it without a build step.
 */

export interface PathLimits {
  readonly maxPathChars: number;
  readonly maxSegmentChars: number;
  readonly maxDepth: number;
}

export declare const DEFAULT_PATH_LIMITS: PathLimits;

export declare const PathError: {
  readonly EMPTY: 'path_empty';
  readonly NOT_A_STRING: 'path_not_a_string';
  readonly ABSOLUTE: 'path_absolute';
  readonly DRIVE_LETTER: 'path_drive_letter';
  readonly TRAVERSAL: 'path_traversal';
  readonly DOT_SEGMENT: 'path_dot_segment';
  readonly EMPTY_SEGMENT: 'path_empty_segment';
  readonly NUL_BYTE: 'path_nul_byte';
  readonly CONTROL_CHARACTER: 'path_control_character';
  readonly TOO_LONG: 'path_too_long';
  readonly SEGMENT_TOO_LONG: 'path_segment_too_long';
  readonly TOO_DEEP: 'path_too_deep';
  readonly RESERVED_DEVICE_NAME: 'path_reserved_device_name';
  readonly RESERVED_NAME: 'path_reserved_name';
  readonly RESERVED_DIRECTORY: 'path_reserved_directory';
  readonly TRAILING_DOT_OR_SPACE: 'path_trailing_dot_or_space';
  readonly DUPLICATE: 'path_duplicate';
  readonly CASE_COLLISION: 'path_case_collision';
  readonly FILE_DIRECTORY_CONFLICT: 'path_file_directory_conflict';
};

export interface PathFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface NormalizedPath {
  readonly ok: true;
  readonly path: string;
  readonly segments: string[];
}

export declare function normalizeWorkspacePath(
  raw: unknown,
  limits?: PathLimits,
): NormalizedPath | PathFailure;

export declare function pathCollisionKey(path: string): string;

export interface ValidatedFile {
  readonly name: string;
  readonly content: string;
  readonly language: unknown;
  readonly isMain: boolean;
}

export interface ValidatedFileSet {
  readonly ok: true;
  readonly files: ValidatedFile[];
  readonly totalContentChars: number;
}

export declare function validateFileSet(
  rawFiles: unknown,
  options?: {
    limits?: PathLimits;
    maxFiles?: number;
    maxTotalContentChars?: number;
  },
): ValidatedFileSet | PathFailure;

export declare function resolveEntryPoint(
  files: ReadonlyArray<{ name: string; isMain: boolean }>,
  requestedEntryPoint: unknown,
): { readonly ok: true; readonly entryPoint: string } | PathFailure;
