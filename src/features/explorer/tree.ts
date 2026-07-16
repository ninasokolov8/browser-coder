// @ts-nocheck
import { getLanguage } from '../../languages';
import { runtime } from '../../app/runtime';
import { policyState } from '../../app/config';
import { fileTreeEl, contextMenuEl } from '../../components/dom';
import { applyFileLanguage } from '../editor-core';
import { explorerState } from './state';
import { captureWorkspacePaths, refactorWorkspaceImports } from './import-refactor';
import { setOutput, setStatus } from '../../components/output';
import {
  createNewFileInExplorer, createNewFolder, createFolderFromSelection,
  deleteSelectedItems, clearDropHighlights, importExternalFiles, moveItemsInto, getInternalDraggedIds, syncOpenTabsFromStorage, isExternalFileDrag,
} from './operations';

const tabManager = new Proxy({} as any, { get: (_t, p) => (runtime.tabManager as any)[p] });
const storage = new Proxy({} as any, { get: (_t, p) => (runtime.storage as any)[p] });

// ===== File Explorer Rendering =====
export async function renderFileTree(tm = runtime.tabManager!) {
  const tabs = tm.getAllTabs();
  const activeTab = tm.getActiveTab();
  const folders = await storage.getAllFolders();
  const files = await storage.getAllFiles();

  // Build tree structure
  interface TreeNode {
    id: string;
    name: string;
    type: 'file' | 'folder';
    parentId: string | null;
    language?: string;
    children?: TreeNode[];
    tab?: typeof tabs[0];
    folder?: typeof folders[0];
  }

  const folderMap = new Map<string, TreeNode>();
  const rootNodes: TreeNode[] = [];

  // Create folder nodes
  for (const folder of folders) {
    folderMap.set(folder.id, {
      id: folder.id,
      name: folder.name,
      type: 'folder',
      parentId: folder.parentId,
      folder,
      children: [],
    });
  }

  // Assign folder children
  for (const folder of folders) {
    const node = folderMap.get(folder.id)!;
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Create file nodes and assign to folders or root
  for (const file of files) {
    const tab = tabs.find(t => t.file.id === file.id);
    const fileNode: TreeNode = {
      id: file.id,
      name: file.name,
      type: 'file',
      parentId: file.parentId,
      language: file.language,
      tab,
    };

    if (file.parentId && folderMap.has(file.parentId)) {
      folderMap.get(file.parentId)!.children!.push(fileNode);
    } else {
      rootNodes.push(fileNode);
    }
  }

  // Sort: folders first, then files, both alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
  };
  sortNodes(rootNodes);

  // Render HTML
  function renderNode(node: TreeNode, depth: number = 0): string {
    const indent = depth * 12;
    const isActive = node.type === 'file' && activeTab?.file.id === node.id;
    const isExpanded = node.type === 'folder' && explorerState.expandedFolders.has(node.id);
    const isDirty = node.tab?.isDirty;
    const isRenaming = explorerState.renamingItemId === node.id;
    const isSelected = explorerState.selectedIds.has(node.id);

    // Track visible order for Shift-range selection
    explorerState.visibleNodeOrder.push(node.id);

    if (node.type === 'folder') {
      const childrenHtml = isExpanded && node.children
        ? node.children.map(c => renderNode(c, depth + 1)).join('')
        : '';
      
      return `
        <div class="tree-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}" 
             draggable="true"
             data-id="${node.id}" data-type="folder" data-parent="${node.parentId ?? ''}"
             style="padding-left: ${8 + indent}px">
          <span class="tree-item-chevron ${isExpanded ? 'expanded' : ''}">▶</span>
          <span class="tree-item-icon">📁</span>
          ${isRenaming 
            ? `<input class="tree-item-input" type="text" value="${node.name}" data-id="${node.id}" data-type="folder">`
            : `<span class="tree-item-name">${node.name}</span>`
          }
        </div>
        ${isExpanded ? `<div class="tree-children">${childrenHtml}</div>` : ''}
      `;
    } else {
      // Icon reflects the file's own language, whether or not a tab is open
      const lang = getLanguage(node.tab?.file.language || node.language || '');
      const icon = lang?.icon || '📄';
      
      return `
        <div class="tree-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}" 
             draggable="true"
             data-id="${node.id}" data-type="file" data-parent="${node.parentId ?? ''}"
             style="padding-left: ${8 + indent + 16}px">
          <span class="tree-item-icon">${icon}</span>
          ${isRenaming 
            ? `<input class="tree-item-input" type="text" value="${node.name}" data-id="${node.id}" data-type="file">`
            : `<span class="tree-item-name">${node.name}</span>`
          }
          ${isDirty ? '<span class="tree-item-badge">M</span>' : ''}
        </div>
      `;
    }
  }

  if (rootNodes.length === 0) {
    explorerState.visibleNodeOrder = [];
    fileTreeEl.innerHTML = '<div class="tree-empty">No files yet. Click + to create one.</div>';
  } else {
    explorerState.visibleNodeOrder = [];
    fileTreeEl.innerHTML = rootNodes.map(n => renderNode(n)).join('');
  }

  // Attach event handlers
  attachTreeEventHandlers(tm);
}

function attachTreeEventHandlers(tm: TabManager) {
  // Click handlers
  fileTreeEl.querySelectorAll('.tree-item').forEach(el => {
    const itemEl = el as HTMLElement;
    const id = itemEl.dataset.id!;
    const type = itemEl.dataset.type as 'file' | 'folder';

    // Single click - select / open file / toggle folder.
    // Ctrl/Cmd toggles a file in the multi-selection; Shift selects a range.
    itemEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('tree-item-input')) return;

      explorerState.selectedItemId = id;
      explorerState.selectedItemType = type;

      // Ctrl/Cmd-click: toggle this item in the selection set
      if (e.ctrlKey || e.metaKey) {
        if (explorerState.selectedIds.has(id)) explorerState.selectedIds.delete(id);
        else explorerState.selectedIds.add(id);
        explorerState.lastClickedId = id;
        renderFileTree(tm);
        return;
      }

      // Shift-click: select the visible range between last click and this one
      if (e.shiftKey && explorerState.lastClickedId) {
        const start = explorerState.visibleNodeOrder.indexOf(explorerState.lastClickedId);
        const end = explorerState.visibleNodeOrder.indexOf(id);
        if (start !== -1 && end !== -1) {
          const [lo, hi] = start < end ? [start, end] : [end, start];
          explorerState.selectedIds = new Set(explorerState.visibleNodeOrder.slice(lo, hi + 1));
          renderFileTree(tm);
          return;
        }
      }

      // Plain click: single selection + open/toggle
      explorerState.selectedIds = new Set([id]);
      explorerState.lastClickedId = id;

      if (type === 'file') {
        tm.switchToTab(id);
      } else {
        // Toggle folder expansion
        if (explorerState.expandedFolders.has(id)) {
          explorerState.expandedFolders.delete(id);
        } else {
          explorerState.expandedFolders.add(id);
        }
        renderFileTree(tm);
      }
    });

    // Right-click - context menu
    itemEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (policyState.lockStructure) return;
      explorerState.selectedItemId = id;
      explorerState.selectedItemType = type;
      // Keep an existing multi-selection if the right-clicked item is part of
      // it; otherwise reset selection to just this item.
      if (!explorerState.selectedIds.has(id)) {
        explorerState.selectedIds = new Set([id]);
        renderFileTree(tm);
      }
      showContextMenu(e.clientX, e.clientY, type);
    });

    // ===== Drag and drop (VS Code-style file management) =====
    itemEl.addEventListener('dragstart', (e) => {
      if (policyState.lockStructure) { e.preventDefault(); return; }
      // Drag the whole selection when the grabbed item is part of it,
      // otherwise drag just this item (and make it the selection).
      if (!explorerState.selectedIds.has(id)) {
        explorerState.selectedIds = new Set([id]);
        explorerState.selectedItemId = id;
        explorerState.selectedItemType = type;
        explorerState.lastClickedId = id;

        // Never rebuild the explorer DOM during dragstart. Replacing the source
        // node here cancels native HTML drag-and-drop in Chromium/Safari.
        fileTreeEl.querySelectorAll('.tree-item.selected').forEach(node => {
          node.classList.remove('selected');
        });
        itemEl.classList.add('selected');
      }

      explorerState.draggingIds = Array.from(explorerState.selectedIds);
      const payload = explorerState.draggingIds.join(',');
      e.dataTransfer?.setData('application/x-browser-coder-items', payload);
      e.dataTransfer?.setData('text/plain', payload);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      itemEl.classList.add('dragging');
    });

    itemEl.addEventListener('dragend', () => {
      // Drop handlers may perform asynchronous IndexedDB work. Delay cleanup
      // one task so the drop event can first copy the DataTransfer payload.
      setTimeout(() => { explorerState.draggingIds = []; }, 0);
      clearDropHighlights();
      itemEl.classList.remove('dragging');
    });

    // Every item is a drop target:
    //  - drop on a FOLDER  -> move into that folder
    //  - drop on a FILE    -> move into that file's parent (VS Code behaviour),
    //                         so dropping on a root-level file lands in root
    // Works for both internal moves and external OS-file drops.
    itemEl.addEventListener('dragover', (e) => {
      const external = isExternalFileDrag(e);
      if (getInternalDraggedIds(e).length === 0 && !external) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = external ? 'copy' : 'move';
      clearDropHighlights();
      if (type === 'folder') {
        itemEl.classList.add('drop-target');
      } else {
        // Highlight the destination: parent folder, or the whole root zone
        const parentId = itemEl.dataset.parent || '';
        if (parentId) {
          const parentEl = fileTreeEl.querySelector(`.tree-item[data-id="${parentId}"]`);
          parentEl?.classList.add('drop-target');
        } else {
          fileTreeEl.classList.add('root-drop-target');
        }
      }
    });
    itemEl.addEventListener('dragleave', () => {
      itemEl.classList.remove('drop-target');
    });
    itemEl.addEventListener('drop', async (e) => {
      const external = isExternalFileDrag(e);
      if (getInternalDraggedIds(e).length === 0 && !external) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropHighlights();
      const targetParentId = type === 'folder' ? id : (itemEl.dataset.parent || null);
      if (external) {
        await importExternalFiles(e.dataTransfer!.files, targetParentId);
      } else {
        await moveItemsInto(targetParentId, getInternalDraggedIds(e));
      }
    });
  });

  // Handle rename input
  const renameInput = fileTreeEl.querySelector('.tree-item-input') as HTMLInputElement;
  if (renameInput) {
    renameInput.focus();
    renameInput.select();

    const commitRename = async () => {
      const newName = renameInput.value.trim();
      const id = renameInput.dataset.id!;
      const type = renameInput.dataset.type as 'file' | 'folder';

      if (newName) {
        const beforePaths = await captureWorkspacePaths();
        if (type === 'folder') {
          await storage.updateFolder(id, { name: newName });
          // Folder rename rewrites every descendant path. Keep all open tabs
          // synchronized with those new paths.
          await syncOpenTabsFromStorage();
        } else {
          // Re-detect language from the new extension (e.g. "main.php")
          const detected = tabManager.detectLanguageByExtension(newName);
          const langUpdates = detected
            ? {
                language: detected.id,
                version: (detected.versions.find(v => v.default) || detected.versions[0]).id,
              }
            : {};
          const updatedFile = await storage.updateFile(id, { name: newName, ...langUpdates });
          // Update the complete cached file record, including its new path.
          const tab = tm.getTab(id);
          if (tab && updatedFile) {
            tab.file = { ...updatedFile, content: tab.file.content };
            applyFileLanguage(id);
          }
        }
        const refactorResult = await refactorWorkspaceImports(beforePaths);
        runtime.notifyWorkspaceChanged();
        if (refactorResult.replacements > 0) {
          setStatus(`Renamed ${type}; updated ${refactorResult.replacements} import${refactorResult.replacements === 1 ? '' : 's'}`);
        }
        if (refactorResult.warnings.length > 0) {
          setOutput(refactorResult.warnings.join('\n'));
        }
      }
      explorerState.renamingItemId = null;
      renderFileTree(tm);
    };

    renameInput.addEventListener('blur', commitRename);
    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        explorerState.renamingItemId = null;
        renderFileTree(tm);
      }
    });
  }
}


// Right-click on empty explorer space opens the root context menu.
fileTreeEl.addEventListener('contextmenu', (e) => {
  if (policyState.lockStructure) return;
  if ((e.target as HTMLElement).closest('.tree-item')) return;

  e.preventDefault();
  explorerState.selectedItemId = null;
  explorerState.selectedItemType = null;
  explorerState.selectedIds = new Set();
  explorerState.lastClickedId = null;
  showContextMenu(e.clientX, e.clientY, 'folder');
});

// ===== Context Menu =====
function getSelectedTypesFromRenderedTree(): ('file' | 'folder')[] {
  const types: ('file' | 'folder')[] = [];
  for (const id of explorerState.selectedIds) {
    const itemEl = fileTreeEl.querySelector(`.tree-item[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    const type = itemEl?.dataset.type as 'file' | 'folder' | undefined;
    if (type === 'file' || type === 'folder') types.push(type);
  }
  return types;
}

function setContextMenuActionVisible(action: string, visible: boolean): void {
  const item = contextMenuEl.querySelector(`.context-menu-item[data-action="${action}"]`) as HTMLElement | null;
  if (!item) return;
  item.style.display = visible ? '' : 'none';
}

function setContextMenuActionLabel(action: string, label?: string): void {
  const item = contextMenuEl.querySelector(`.context-menu-item[data-action="${action}"]`) as HTMLElement | null;
  if (!item) return;

  if (!item.dataset.defaultHtml) {
    item.dataset.defaultHtml = item.innerHTML;
  }

  if (!label) {
    item.innerHTML = item.dataset.defaultHtml;
    return;
  }

  const icons: Record<string, string> = {
    'new-file': '📄',
    'new-folder': '📁',
    rename: '✏️',
    delete: '🗑️',
  };
  item.textContent = `${icons[action] || ''} ${label}`.trim();
}

function updateContextMenuForSelection(type: 'file' | 'folder') {
  const selectedCount = explorerState.selectedIds.size;

  setContextMenuActionLabel('new-file');
  setContextMenuActionLabel('new-folder');
  setContextMenuActionLabel('rename');
  setContextMenuActionLabel('delete');

  if (selectedCount === 0) {
    // Empty explorer area: only creation actions are relevant.
    setContextMenuActionVisible('new-file', true);
    setContextMenuActionVisible('new-folder', true);
    setContextMenuActionVisible('rename', false);
    setContextMenuActionVisible('delete', false);
    return;
  }

  if (selectedCount > 1) {
    const selectedTypes = getSelectedTypesFromRenderedTree();
    const allFiles = selectedTypes.length > 0 && selectedTypes.every(t => t === 'file');
    const allFolders = selectedTypes.length > 0 && selectedTypes.every(t => t === 'folder');
    const noun = allFiles ? 'file' : allFolders ? 'folder' : 'item';
    const plural = selectedCount === 1 ? noun : `${noun}s`;

    // Multi-selection menu: only batch actions should be shown.
    setContextMenuActionVisible('new-file', false);
    setContextMenuActionVisible('new-folder', true);
    setContextMenuActionVisible('rename', false);
    setContextMenuActionVisible('delete', true);
    setContextMenuActionLabel('new-folder', 'New Folder');
    setContextMenuActionLabel('delete', `Delete all ${selectedCount} ${plural}`);
    return;
  }

  // Single item: keep the existing single-item behaviour.
  setContextMenuActionVisible('new-file', true);
  setContextMenuActionVisible('new-folder', true);
  setContextMenuActionVisible('rename', true);
  setContextMenuActionVisible('delete', true);
}

function showContextMenu(x: number, y: number, type: 'file' | 'folder') {
  if (policyState.lockStructure) return;
  updateContextMenuForSelection(type);

  contextMenuEl.style.left = `${x}px`;
  contextMenuEl.style.top = `${y}px`;
  contextMenuEl.classList.remove('hidden');

  // Adjust position if off-screen
  const rect = contextMenuEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenuEl.style.left = `${x - rect.width}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenuEl.style.top = `${y - rect.height}px`;
  }
}

function hideContextMenu() {
  contextMenuEl.classList.add('hidden');
}

// Close context menu on click outside
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!contextMenuEl.contains(e.target as Node) && !fileTreeEl.contains(e.target as Node)) {
    hideContextMenu();
  }
});

// Context menu actions
contextMenuEl.querySelectorAll('.context-menu-item').forEach(item => {
  item.addEventListener('click', async (e) => {
    e.stopPropagation();
    const action = (item as HTMLElement).dataset.action;
    hideContextMenu();

    switch (action) {
      case 'new-file':
        await createNewFileInExplorer(explorerState.selectedItemType === 'folder' ? explorerState.selectedItemId : null);
        break;
      case 'new-folder':
        if (explorerState.selectedIds.size > 1) {
          await createFolderFromSelection();
        } else {
          await createNewFolder(explorerState.selectedItemType === 'folder' ? explorerState.selectedItemId : null);
        }
        break;
      case 'rename':
        if (explorerState.selectedIds.size === 1 && explorerState.selectedItemId) {
          explorerState.renamingItemId = explorerState.selectedItemId;
          renderFileTree(tabManager);
        }
        break;
      case 'delete':
        await deleteSelectedItems();
        break;
    }
  });
});

