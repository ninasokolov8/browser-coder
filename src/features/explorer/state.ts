export const explorerState = {
  expandedFolders: new Set<string>(),
  selectedItemId: null as string | null,
  selectedItemType: null as 'file' | 'folder' | null,
  renamingItemId: null as string | null,
  selectedIds: new Set<string>(),
  lastClickedId: null as string | null,
  draggingIds: [] as string[],
  /**
   * Folders the current drag may not be dropped into: the dragged folders themselves
   * and everything beneath them.
   *
   * Filled asynchronously at dragstart, because the answer needs the folder tree and
   * `dragover` is synchronous. It exists so an impossible drop is not painted as a
   * valid target - the drop itself is refused by the service either way, and now
   * reports why, so a set that has not been filled yet is safe rather than wrong.
   */
  invalidDropTargetIds: new Set<string>(),
  visibleNodeOrder: [] as string[],
};

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
