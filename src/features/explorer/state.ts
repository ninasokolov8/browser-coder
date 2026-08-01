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
  /**
   * The row that owns the tree's single tab stop.
   *
   * Separate from `selectedItemId` because keyboard focus and selection are different
   * things in a tree: arrowing down moves focus without opening anything, which is what
   * lets someone browse the project without opening ten files.
   */
  focusedId: null as string | null,
  /**
   * Whether focus was inside the tree when it was last rebuilt.
   *
   * The tree is redrawn with `innerHTML`, which destroys the focused element and drops
   * focus to `<body>`. Restoring it unconditionally would steal focus from the editor
   * every time autosave fired, so it is only restored when the tree already had it.
   */
  treeHadFocus: false,
};

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
