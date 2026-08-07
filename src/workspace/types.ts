/**
 * Workspace domain types.
 *
 * The single most important rule here: **metadata never carries content, and
 * path is never stored.**
 *
 * Before this module a file's text existed in three places at once - the Monaco
 * model the user was typing into, `tab.file.content`, and the IndexedDB record -
 * with no rule about which one won. Every one of the confirmed data-loss defects
 * (V-09, V-10, V-11, V-13) is a case of one copy overwriting a newer one after
 * an `await`. Splitting content out of metadata makes that class of mistake
 * unrepresentable: a metadata update has no content field to clobber.
 *
 * `path` is derived from the folder chain plus the name, recomputed on demand,
 * and deliberately absent from these records. Storing it meant a folder rename
 * had to rewrite every descendant - which is exactly the operation that spanned
 * two transactions (V-15) and left stale paths behind that execution then had to
 * defensively distrust. Derived state cannot go stale.
 *
 * Pure module: no DOM, no Monaco, no IndexedDB. Unit-testable in node.
 */

export type DocumentId = string;
export type FolderId = string;

/**
 * Everything known about a document except its text.
 *
 * `isUserModified` is a persisted hint, not a source of truth: it records that
 * the user has typed in this file at some point, so the version selector knows
 * not to replace their work with a starter template. The authoritative check
 * compares content against the starter exactly.
 */
export interface DocumentMetadata {
  readonly id: DocumentId;
  readonly name: string;
  readonly parentId: FolderId | null;
  readonly language: string;
  readonly version: string;
  readonly order: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly isUserModified: boolean;
}

export interface FolderMetadata {
  readonly id: FolderId;
  readonly name: string;
  readonly parentId: FolderId | null;
  readonly order: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A document record as it is persisted: metadata plus exactly one content field. */
export interface PersistedDocument extends DocumentMetadata {
  readonly content: string;
}

/**
 * What a metadata update is allowed to change.
 *
 * `content` is absent on purpose, and that absence is load-bearing. `renameTab`
 * used to call a general-purpose update helper that merged the *persisted*
 * record with a name change and handed the merged record back to the caller,
 * who assigned it over the live working copy - silently reverting unsaved text
 * (V-10). With content unreachable from this type, a rename cannot touch it.
 */
export interface DocumentMetadataPatch {
  readonly name?: string;
  readonly parentId?: FolderId | null;
  readonly language?: string;
  readonly version?: string;
  readonly order?: number;
  readonly isUserModified?: boolean;
}

export interface FolderMetadataPatch {
  readonly name?: string;
  readonly parentId?: FolderId | null;
  readonly order?: number;
}

/** One entry of a resolved workspace tree, with its canonical derived path. */
export interface WorkspaceEntry {
  readonly id: string;
  readonly kind: 'file' | 'folder';
  readonly name: string;
  readonly parentId: FolderId | null;
  /** Canonical, relative, forward-slashed, never leading-slashed. */
  readonly path: string;
  readonly depth: number;
  readonly order: number;
}

export interface WorkspaceState {
  readonly activeFileId: DocumentId | null;
  readonly theme: string;
  /**
   * Parents whose children the student has arranged by hand.
   *
   * The empty string means the workspace root, which has no folder record to hang a
   * flag on. Everything else is a folder id.
   *
   * This exists because `order` has always been assigned by creation sequence, so
   * sorting by it outright would reshuffle every project that nobody ever reordered.
   * A parent stays name-sorted until it appears here. Optional, because a workspace
   * written before this existed has no such field.
   */
  readonly manuallyOrderedParents?: readonly string[];
}

export interface Disposable {
  dispose(): void;
}

/** A single revision-guarded write outcome, reported rather than thrown. */
export type SaveOutcome =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'superseded'; readonly revision: number }
  | { readonly status: 'unchanged' }
  | { readonly status: 'failed'; readonly error: Error };
