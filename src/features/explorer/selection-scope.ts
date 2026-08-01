/**
 * Which items a folder-shaped selection really refers to.
 *
 * Two questions, both answered from the folder tree alone, both previously inline in
 * `operations.ts` behind `await storage.…` calls that made them untestable:
 *
 *  - Given a selection, which items are *top level*? Selecting a folder and something
 *    inside it means the inner item is already coming along; moving it separately
 *    tears it out of the folder the student dragged.
 *  - Given the folders being dragged, which folders may not receive the drop?
 *
 * Pure, so node tests it directly.
 */

export interface ScopedItem {
  readonly id: string;
  readonly parentId: string | null;
}

export interface FolderLink {
  readonly id: string;
  readonly parentId: string | null;
}

/**
 * Drop every item that lives inside another item of the same selection.
 *
 * `selectedFolderIds` is passed rather than derived so a caller that only knows ids
 * (a drag payload) and a caller that has full records (a context-menu selection) can
 * share one implementation.
 */
export function topLevelItems<T extends ScopedItem>(
  items: readonly T[],
  selectedFolderIds: ReadonlySet<string>,
  folderParentById: ReadonlyMap<string, string | null>,
): T[] {
  if (selectedFolderIds.size === 0) return [...items];

  return items.filter(item => {
    let parentId = item.parentId;
    const seen = new Set<string>();
    while (parentId) {
      if (selectedFolderIds.has(parentId)) return false;
      // A corrupt tree must not hang a drag: a repeated node ends the walk.
      if (seen.has(parentId)) return true;
      seen.add(parentId);
      parentId = folderParentById.get(parentId) ?? null;
    }
    return true;
  });
}

/**
 * The given folders and every folder beneath them.
 *
 * Used for two different things: the entries a delete has to cover, and the targets a
 * drag may not be dropped onto.
 */
export function descendantFolderIds(
  rootIds: ReadonlySet<string>,
  folders: readonly FolderLink[],
): Set<string> {
  const included = new Set(rootIds);
  if (included.size === 0) return included;

  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && included.has(folder.parentId) && !included.has(folder.id)) {
        included.add(folder.id);
        changed = true;
      }
    }
  }
  return included;
}
