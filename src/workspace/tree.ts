/**
 * The workspace tree: paths derived from structure, never stored.
 *
 * The code this replaces persisted a `path` field on every file and folder, which
 * created two obligations it could not keep. Renaming a folder had to rewrite
 * every descendant's path - and did so across two transactions, so an
 * interruption left the tree internally inconsistent (V-15). And because a
 * stored path could disagree with the tree, execution had to defend itself:
 *
 *     // Do not trust activeTab.file.path here.
 *     // The tab may contain stale path metadata after: [...] moving files
 *
 * A comment telling the next reader not to trust a field is the field admitting
 * it should not exist. Here `path` is computed from the parent chain on demand,
 * so a rename is a single name change and every path that mentions it is correct
 * on the next read. There is nothing to migrate and nothing to distrust.
 *
 * Collision rules come from the same module the server enforces, so the IDE
 * cannot accept a workspace the server will reject.
 */

import { pathCollisionKey } from '../../server/domain/paths.mjs';
import type {
  DocumentMetadata,
  FolderId,
  FolderMetadata,
  WorkspaceEntry,
} from './types.ts';

export interface TreeInput {
  readonly files: readonly DocumentMetadata[];
  readonly folders: readonly FolderMetadata[];
}

export interface TreeRepair {
  readonly kind: 'missing_parent' | 'parent_cycle';
  readonly id: string;
  readonly detail: string;
}

export interface WorkspaceTree {
  /** Canonical relative path per id, for files and folders alike. */
  readonly pathById: ReadonlyMap<string, string>;
  readonly entries: readonly WorkspaceEntry[];
  /** Structural problems found while resolving, reported rather than hidden. */
  readonly repairs: readonly TreeRepair[];
}

/**
 * Resolve a folder's chain to the root, tolerating corrupt structure.
 *
 * A missing or cyclic parent is not hypothetical: a folder delete that raced a
 * move, or an import of a partial workspace, can produce one, and the previous
 * `while (cursor)` walks would either loop forever or silently drop the subtree.
 * Broken links are re-rooted and reported, so the workspace stays usable and the
 * damage is visible.
 */
function resolveFolderChain(
  folderId: FolderId | null,
  folderById: ReadonlyMap<FolderId, FolderMetadata>,
  repairs: TreeRepair[],
): string[] {
  const names: string[] = [];
  const seen = new Set<FolderId>();
  let cursor = folderId;

  while (cursor) {
    if (seen.has(cursor)) {
      repairs.push({
        kind: 'parent_cycle',
        id: cursor,
        detail: `Folder ${cursor} is its own ancestor; the chain was cut here`,
      });
      break;
    }
    seen.add(cursor);

    const folder = folderById.get(cursor);
    if (!folder) {
      repairs.push({
        kind: 'missing_parent',
        id: cursor,
        detail: `Parent folder ${cursor} does not exist; treated as workspace root`,
      });
      break;
    }

    names.push(folder.name);
    cursor = folder.parentId;
  }

  return names.reverse();
}

export function buildTree(input: TreeInput): WorkspaceTree {
  const folderById = new Map<FolderId, FolderMetadata>();
  for (const folder of input.folders) folderById.set(folder.id, folder);

  const repairs: TreeRepair[] = [];
  const pathById = new Map<string, string>();
  const entries: WorkspaceEntry[] = [];

  for (const folder of input.folders) {
    const chain = resolveFolderChain(folder.parentId, folderById, repairs);
    const segments = [...chain, folder.name];
    const path = segments.join('/');
    pathById.set(folder.id, path);
    entries.push({
      id: folder.id,
      kind: 'folder',
      name: folder.name,
      parentId: folder.parentId,
      path,
      depth: segments.length - 1,
      order: folder.order,
    });
  }

  for (const file of input.files) {
    const chain = resolveFolderChain(file.parentId, folderById, repairs);
    const segments = [...chain, file.name];
    const path = segments.join('/');
    pathById.set(file.id, path);
    entries.push({
      id: file.id,
      kind: 'file',
      name: file.name,
      parentId: file.parentId,
      path,
      depth: segments.length - 1,
      order: file.order,
    });
  }

  return { pathById, entries, repairs };
}

/** Explorer display order: folders before files, then `order`, then name. */
export function sortEntriesForDisplay(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name);
  });
}

export interface CollisionReport {
  readonly ok: boolean;
  readonly conflicts: ReadonlyArray<{ readonly key: string; readonly paths: readonly string[] }>;
}

/**
 * Find paths that cannot coexist.
 *
 * Uses the server's collision key, so `Main.java` and `main.java` are a conflict
 * here too. They build on the Linux container and break on every author's
 * machine, and a workspace the IDE accepts but the server rejects is worse than
 * either behaviour alone.
 */
export function findCollisions(tree: WorkspaceTree): CollisionReport {
  const byKey = new Map<string, string[]>();

  for (const entry of tree.entries) {
    const key = pathCollisionKey(entry.path);
    const existing = byKey.get(key);
    if (existing) existing.push(entry.path);
    else byKey.set(key, [entry.path]);
  }

  const conflicts = [...byKey.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => ({ key, paths }));

  return { ok: conflicts.length === 0, conflicts };
}

/**
 * A name that does not collide with `existingNames`, in the same folder.
 *
 * Case-insensitive by collision key, because the reason for uniquifying is that
 * two files cannot share a path - and on the deployment target for these
 * projects, `Main.py` and `main.py` do share one. The previous implementation
 * compared exact strings, so it produced "unique" names that still collided
 * (N-03, together with only checking open tabs rather than the whole workspace).
 */
export function uniqueName(desired: string, existingNames: Iterable<string>): string {
  const taken = new Set<string>();
  for (const name of existingNames) taken.add(pathCollisionKey(name));

  if (!taken.has(pathCollisionKey(desired))) return desired;

  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const extension = dot > 0 ? desired.slice(dot) : '';

  for (let counter = 1; counter < 10_000; counter++) {
    const candidate = `${stem}_${counter}${extension}`;
    if (!taken.has(pathCollisionKey(candidate))) return candidate;
  }

  // Unreachable for any real workspace (the file-count limit is far lower), but
  // returning a colliding name would be worse than a distinctive fallback.
  return `${stem}_${Date.now()}${extension}`;
}

/** Ids of a folder's whole subtree, including the folder itself. */
export function collectSubtree(
  rootFolderIds: Iterable<FolderId>,
  input: TreeInput,
): { folderIds: Set<FolderId>; fileIds: Set<string> } {
  const folderIds = new Set<FolderId>(rootFolderIds);

  // Index children once. The previous implementation re-scanned every folder on
  // each pass of a `while (changed)` loop, which is quadratic in tree depth.
  const childFolders = new Map<FolderId, FolderMetadata[]>();
  for (const folder of input.folders) {
    if (!folder.parentId) continue;
    const siblings = childFolders.get(folder.parentId);
    if (siblings) siblings.push(folder);
    else childFolders.set(folder.parentId, [folder]);
  }

  const queue = [...folderIds];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of childFolders.get(current) ?? []) {
      if (folderIds.has(child.id)) continue; // also breaks a cycle
      folderIds.add(child.id);
      queue.push(child.id);
    }
  }

  const fileIds = new Set<string>();
  for (const file of input.files) {
    if (file.parentId && folderIds.has(file.parentId)) fileIds.add(file.id);
  }

  return { folderIds, fileIds };
}

/** True when moving `folderId` under `targetId` would create a cycle. */
export function wouldCreateCycle(
  folderId: FolderId,
  targetId: FolderId | null,
  folders: readonly FolderMetadata[],
): boolean {
  if (targetId === null) return false;
  if (targetId === folderId) return true;

  const folderById = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set<FolderId>();
  let cursor: FolderId | null = targetId;

  while (cursor) {
    if (cursor === folderId) return true;
    // Corrupt data must not hang the drag handler.
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = folderById.get(cursor)?.parentId ?? null;
  }

  return false;
}
