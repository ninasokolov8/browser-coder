export const explorerState = {
  expandedFolders: new Set<string>(),
  selectedItemId: null as string | null,
  selectedItemType: null as 'file' | 'folder' | null,
  renamingItemId: null as string | null,
  selectedIds: new Set<string>(),
  lastClickedId: null as string | null,
  draggingIds: [] as string[],
  visibleNodeOrder: [] as string[],
};

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
