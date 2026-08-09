import { getLanguage } from '../../languages';
import { runtime } from '../../app/runtime';
import { policyState } from '../../app/config';
import { fileTreeEl, contextMenuEl } from '../../components/dom';
import { applyFileLanguage } from '../editor-core';
import { explorerState } from './state';
import { captureWorkspacePaths, refactorWorkspaceImports } from './import-refactor';
import { setOutput, setStatus } from '../../components/output';
import { escapeHtml } from '../../components/html-escape.ts';
import { hasHiddenWorkspacePrefix, isWorkspaceEntryHidden, isWorkspacePathHidden } from '../workspace-visibility';
import { lazyRef } from '../../app/lazy';
import { dropPositionFor, sortSiblings, type DropPosition } from './ordering.ts';
import type { TabManager } from '../../tabs';
import {
  createNewFileInExplorer, createNewFolder, createFolderFromSelection,
  deleteSelectedItems, clearDropHighlights, importDroppedItems, moveItemsInto, getInternalDraggedIds, isExternalFileDrag,
  markInvalidDropTargets, importFromPicker, downloadSelectedItem, placeItemsBeside,
} from './operations';
import { t, tn } from '../../i18n/index.ts';
import { formatRewriteWarning } from './reference-warnings.ts';

const tabManager = lazyRef(() => runtime.tabManager, 'tabManager');
const storage = lazyRef(() => runtime.storage, 'storage');

/**
 * Redraw the explorer, at most once per turn of the event loop.
 *
 * There are 26 call sites, and several fire together: a tab update calls it, the
 * workspace-changed notification calls it, and the operation that caused both calls it
 * again itself. Each call re-reads every folder and every file, rebuilds the entire
 * tree as HTML, and re-attaches eight drag/click listeners to every row - so a single
 * save could rebuild a 300-row explorer three times.
 *
 * Coalescing here rather than at the call sites keeps every caller's contract: the
 * returned promise still resolves after the DOM has been rebuilt, which the rename
 * flow depends on (it focuses an input that only exists after the render).
 */
let renderInFlight: Promise<void> | null = null;
let renderAgain = false;

export function renderFileTree(tm = runtime.tabManager!): Promise<void> {
  if (renderInFlight) {
    // A change that arrived while we were drawing needs one more pass, but only one.
    renderAgain = true;
    return renderInFlight;
  }

  renderInFlight = (async () => {
    try {
      // Yield once so the other calls in this same turn collapse into this render.
      await Promise.resolve();
      do {
        renderAgain = false;
        await renderFileTreeNow(tm);
      } while (renderAgain);
    } finally {
      renderInFlight = null;
      renderAgain = false;
    }
  })();

  return renderInFlight;
}

// ===== File Explorer Rendering =====
async function renderFileTreeNow(tm = runtime.tabManager!) {
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
    /** The stored sibling order, honoured only for a parent the student arranged. */
    order: number;
    language?: string;
    children?: TreeNode[];
    tab?: typeof tabs[0];
    folder?: typeof folders[0];
  }

  const allFoldersById = new Map(folders.map(folder => [folder.id, folder]));
  const hiddenFolderIds = new Set<string>();

  // A hidden folder hides its complete subtree, even when descendants do not
  // repeat the prefix. The path check also protects against malformed/orphaned
  // storage records whose parent chain cannot be resolved normally.
  const folderIsHidden = (folder: typeof folders[0]): boolean => {
    if (hiddenFolderIds.has(folder.id)) return true;
    if (hasHiddenWorkspacePrefix(folder.name) || isWorkspacePathHidden(folder.path)) {
      hiddenFolderIds.add(folder.id);
      return true;
    }

    const visited = new Set<string>();
    let current = folder;

    while (current.parentId) {
      if (visited.has(current.id)) break;
      visited.add(current.id);

      const parent = allFoldersById.get(current.parentId);
      if (!parent) break;

      if (
        hiddenFolderIds.has(parent.id) ||
        hasHiddenWorkspacePrefix(parent.name) ||
        isWorkspacePathHidden(parent.path)
      ) {
        hiddenFolderIds.add(parent.id);
        hiddenFolderIds.add(folder.id);
        return true;
      }

      current = parent;
    }

    return false;
  };

  for (const folder of folders) {
    folderIsHidden(folder);
  }

  const folderMap = new Map<string, TreeNode>();
  const rootNodes: TreeNode[] = [];
  const visibleIds = new Set<string>();

  // Create only visible folder nodes. Hidden folders and all descendants stay
  // in storage; they are omitted only from this rendered tree.
  for (const folder of folders) {
    if (hiddenFolderIds.has(folder.id)) continue;

    folderMap.set(folder.id, {
      id: folder.id,
      name: folder.name,
      type: 'folder',
      parentId: folder.parentId,
      order: folder.order,
      folder,
      children: [],
    });
    visibleIds.add(folder.id);
  }

  // Assign visible folder children.
  for (const folder of folders) {
    if (hiddenFolderIds.has(folder.id)) continue;

    const node = folderMap.get(folder.id)!;
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)!.children!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Create visible file nodes and assign them to visible folders or root.
  for (const file of files) {
    const isHidden =
      hasHiddenWorkspacePrefix(file.name) ||
      isWorkspacePathHidden(file.path) ||
      (!!file.parentId && hiddenFolderIds.has(file.parentId));

    if (isHidden) continue;

    const tab = tabs.find(t => t.file.id === file.id);
    const fileNode: TreeNode = {
      id: file.id,
      name: file.name,
      type: 'file',
      parentId: file.parentId,
      order: file.order,
      language: file.language,
      tab,
    };

    visibleIds.add(file.id);

    if (file.parentId && folderMap.has(file.parentId)) {
      folderMap.get(file.parentId)!.children!.push(fileNode);
    } else {
      rootNodes.push(fileNode);
    }
  }

  // Remove stale UI state when an item becomes hidden after a rename or a
  // workspace refresh. This prevents context-menu, range-selection, and drag
  // actions from retaining invisible IDs.
  explorerState.selectedIds = new Set(
    Array.from(explorerState.selectedIds).filter(id => visibleIds.has(id))
  );
  explorerState.expandedFolders = new Set(
    Array.from(explorerState.expandedFolders).filter(id => folderMap.has(id))
  );
  explorerState.draggingIds = explorerState.draggingIds.filter(id => visibleIds.has(id));

  if (explorerState.selectedItemId && !visibleIds.has(explorerState.selectedItemId)) {
    explorerState.selectedItemId = null;
    explorerState.selectedItemType = null;
  }
  if (explorerState.lastClickedId && !visibleIds.has(explorerState.lastClickedId)) {
    explorerState.lastClickedId = null;
  }
  if (explorerState.renamingItemId && !visibleIds.has(explorerState.renamingItemId)) {
    explorerState.renamingItemId = null;
  }

  /*
   * Sort each parent by the student's arrangement when they have made one, and by name
   * otherwise.
   *
   * The `order` field has always been maintained by storage and always discarded here.
   * Honouring it unconditionally would have reshuffled every existing project from
   * alphabetical to creation sequence, so a parent switches to `order` only once
   * something inside it has actually been dragged into place - see ordering.ts.
   */
  const workspace = runtime.workspace;
  const sortNodes = (nodes: TreeNode[], parentId: string | null) => {
    const manual = workspace?.isManuallyOrdered(parentId) ?? false;
    const sorted = sortSiblings(
      nodes.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type,
        order: node.order,
      })),
      manual,
    );

    const byId = new Map(nodes.map(node => [node.id, node]));
    nodes.length = 0;
    for (const entry of sorted) nodes.push(byId.get(entry.id)!);

    for (const node of nodes) {
      if (node.children) sortNodes(node.children, node.id);
    }
  };
  sortNodes(rootNodes, null);

  // The shared escaper covers both positions, so the two names are one function.
  const escapeAttribute = escapeHtml;

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
             role="treeitem" aria-level="${depth + 1}" aria-selected="${isSelected}" aria-expanded="${isExpanded}" tabindex="-1"
             data-id="${escapeAttribute(node.id)}" data-type="folder" data-parent="${escapeAttribute(node.parentId ?? '')}"
             style="padding-left: ${8 + indent}px">
          <span class="tree-item-chevron ${isExpanded ? 'expanded' : ''}">▶</span>
          <span class="tree-item-icon">📁</span>
          ${isRenaming
            ? `<input class="tree-item-input" type="text" value="${escapeAttribute(node.name)}" data-id="${escapeAttribute(node.id)}" data-type="folder">`
            : `<span class="tree-item-name">${escapeHtml(node.name)}</span>`
          }
        </div>
        ${isExpanded ? `<div class="tree-children" role="group">${childrenHtml}</div>` : ''}
      `;
    } else {
      // Icon reflects the file's own language, whether or not a tab is open
      const lang = getLanguage(node.tab?.file.language || node.language || '');
      const icon = lang?.icon || '📄';

      return `
        <div class="tree-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}"
             draggable="true"
             role="treeitem" aria-level="${depth + 1}" aria-selected="${isSelected}" tabindex="-1"
             data-id="${escapeAttribute(node.id)}" data-type="file" data-parent="${escapeAttribute(node.parentId ?? '')}"
             style="padding-left: ${8 + indent + 16}px">
          <span class="tree-item-icon">${icon}</span>
          ${isRenaming
            ? `<input class="tree-item-input" type="text" value="${escapeAttribute(node.name)}" data-id="${escapeAttribute(node.id)}" data-type="file">`
            : `<span class="tree-item-name">${escapeHtml(node.name)}</span>`
          }
          ${isDirty ? '<span class="tree-item-badge">M</span>' : ''}
        </div>
      `;
    }
  }

  if (rootNodes.length === 0) {
    explorerState.visibleNodeOrder = [];
    fileTreeEl.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = t(files.length > 0 || folders.length > 0
      ? 'explorer.noFilesAvailable'
      : 'explorer.noFilesYet');
    fileTreeEl.appendChild(empty);
  } else {
    explorerState.visibleNodeOrder = [];
    fileTreeEl.innerHTML = rootNodes.map(n => renderNode(n)).join('');
  }

  // Attach event handlers
  attachTreeEventHandlers(tm);
  applyRovingTabindex();
}

/**
 * Exactly one row is tabbable, and focus survives a re-render.
 *
 * A tree is ONE tab stop, not one per file - Tab should move past the explorer, and
 * the arrow keys move within it. That is the roving-tabindex pattern every accessible
 * tree uses, and without it a 300-file project puts 300 stops between the sidebar and
 * the editor.
 *
 * Focus also has to be restored by hand, because the tree is rebuilt with `innerHTML`
 * on every change: the focused element is destroyed, and the browser drops focus to
 * `<body>` - so a student navigating with the keyboard would be thrown out of the tree
 * every time autosave fired.
 */
function applyRovingTabindex(): void {
  const rows = [...fileTreeEl.querySelectorAll<HTMLElement>('.tree-item')];
  if (rows.length === 0) return;

  const wanted =
    rows.find(row => row.dataset.id === explorerState.focusedId)
    ?? rows.find(row => row.dataset.id === explorerState.selectedItemId)
    ?? rows.find(row => row.classList.contains('active'))
    ?? rows[0];

  for (const row of rows) row.tabIndex = row === wanted ? 0 : -1;

  // Only take focus back if the tree HAD it. Stealing focus from the editor because a
  // file was saved would be far worse than losing it.
  if (explorerState.treeHadFocus && document.activeElement !== wanted) {
    wanted.focus({ preventScroll: false });
  }
  explorerState.focusedId = wanted.dataset.id ?? null;
}

/** Move focus to a row and make it the tabbable one. */
function focusRow(id: string): void {
  const row = fileTreeEl.querySelector<HTMLElement>(`.tree-item[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  for (const other of fileTreeEl.querySelectorAll<HTMLElement>('.tree-item')) other.tabIndex = -1;
  row.tabIndex = 0;
  explorerState.focusedId = id;
  row.focus();
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
      showContextMenu(e.clientX, e.clientY);
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
      // Started, not awaited: dragstart must stay synchronous or the native drag is
      // cancelled. It resolves off the in-memory folder maps long before a pointer
      // can travel to a target.
      void markInvalidDropTargets(explorerState.draggingIds);
      const payload = explorerState.draggingIds.join(',');
      e.dataTransfer?.setData('application/x-browser-coder-items', payload);
      e.dataTransfer?.setData('text/plain', payload);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      itemEl.classList.add('dragging');
    });

    itemEl.addEventListener('dragend', () => {
      // Drop handlers may perform asynchronous IndexedDB work. Delay cleanup
      // one task so the drop event can first copy the DataTransfer payload.
      setTimeout(() => {
        explorerState.draggingIds = [];
        explorerState.invalidDropTargetIds = new Set();
      }, 0);
      clearDropHighlights();
      itemEl.classList.remove('dragging');
    });

    // Every item is a drop target:
    //  - drop on a FOLDER  -> move into that folder
    //  - drop on a FILE    -> move into that file's parent (VS Code behaviour),
    //                         so dropping on a root-level file lands in root
    // Works for both internal moves and external OS-file drops.
    itemEl.addEventListener('dragover', (e) => {
      // A locked workspace must not advertise a drop it will silently discard. Without
      // preventDefault the browser shows the not-allowed cursor, which is the honest
      // answer. Internal drags are already blocked at the source, but an external file
      // dragged from the desktop reaches here.
      if (policyState.lockStructure) return;
      const external = isExternalFileDrag(e);
      if (getInternalDraggedIds(e).length === 0 && !external) return;
      // A folder cannot go inside itself, so do not paint it as somewhere it can go.
      if (!external && explorerState.invalidDropTargetIds.has(id)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = external ? 'copy' : 'move';
      clearDropHighlights();

      /*
       * Where in the row the pointer is decides between "into this folder" and
       * "between these two rows". An external OS drop is always "into", because there
       * is no ordering question for a file that does not exist here yet.
       */
      const position: DropPosition = external
        ? 'into'
        : dropPositionFor(e.offsetY, itemEl.getBoundingClientRect().height, type);
      itemEl.dataset.dropPosition = position;

      if (position !== 'into') {
        // A line where the item will land, rather than a highlight on a row it is not
        // going into - the two gestures have to look different or a student cannot
        // tell which one they are about to do.
        itemEl.classList.add(position === 'before' ? 'drop-above' : 'drop-below');
        return;
      }

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
      itemEl.classList.remove('drop-target', 'drop-above', 'drop-below');
    });
    itemEl.addEventListener('drop', async (e) => {
      if (policyState.lockStructure) return;
      const external = isExternalFileDrag(e);
      if (getInternalDraggedIds(e).length === 0 && !external) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropHighlights();
      const position = (itemEl.dataset.dropPosition as DropPosition | undefined) ?? 'into';
      delete itemEl.dataset.dropPosition;

      if (external) {
        // The entry API, so a dropped FOLDER arrives with its structure. It has to be
        // read from the event synchronously, which importDroppedItems does first.
        const targetParentId = type === 'folder' ? id : (itemEl.dataset.parent || null);
        await importDroppedItems(e.dataTransfer!, targetParentId);
        return;
      }

      if (position === 'into') {
        const targetParentId = type === 'folder' ? id : (itemEl.dataset.parent || null);
        await moveItemsInto(targetParentId, getInternalDraggedIds(e));
        return;
      }

      // Dropped between two rows: the item lands next to this one, inside whatever
      // parent this row is in - which may be a DIFFERENT parent from the one it came
      // from, so this both moves and orders.
      await placeItemsBeside(id, position, getInternalDraggedIds(e));
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
        } else {
          // Re-detect language from the new extension (e.g. "main.php")
          const detected = tabManager.detectLanguageByExtension(newName);
          const langUpdates = detected
            ? {
                language: detected.id,
                version: (detected.versions.find(v => v.default) || detected.versions[0]).id,
              }
            : {};
          await storage.updateFile(id, { name: newName, ...langUpdates });

          // No cached record to rebuild: the tab reads its name and path from the
          // document and the folder tree. `applyFileLanguage` re-points the Monaco
          // model at the new path, since a URI cannot be renamed in place.
          const tab = tm.getTab(id);
          if (tab) {
            applyFileLanguage(id);

            // A file renamed to X_HIDDEN_ disappears from every normal file
            // navigation surface immediately, while remaining in storage.
            if (isWorkspaceEntryHidden(tab.file)) {
              await tm.closeTab(id);
            }
          }
        }
        const refactorResult = await refactorWorkspaceImports(beforePaths);
        runtime.notifyWorkspaceChanged();
        if (refactorResult.replacements > 0) {
          setStatus(t('explorer.renamedWithImports', {
            type: t(type === 'file' ? 'explorer.file' : 'explorer.folder'),
            imports: tn('explorer.importCount', refactorResult.replacements),
          }));
        }
        if (refactorResult.warnings.length > 0) {
          setOutput(refactorResult.warnings.map(warning => formatRewriteWarning(warning, t)).join('\n'));
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


/*
 * The keyboard contract for a tree.
 *
 * Before this the explorer was reachable only with a mouse: rows were plain divs with
 * no role, no tab stop and no key handling, so a keyboard or screen-reader user could
 * not open a file at all. These are the bindings the ARIA tree pattern specifies, and
 * they are what a student who cannot use a mouse needs in order to use the IDE.
 *
 * Registered on the container rather than per row, so a re-render cannot drop it.
 */
fileTreeEl.addEventListener('focusin', () => {
  explorerState.treeHadFocus = true;
  const row = (document.activeElement as HTMLElement | null)?.closest?.('.tree-item') as HTMLElement | null;
  if (row?.dataset.id) explorerState.focusedId = row.dataset.id;
});

fileTreeEl.addEventListener('focusout', event => {
  // Only when focus actually leaves the tree, not when it moves between rows.
  const next = (event as FocusEvent).relatedTarget as Node | null;
  if (!next || !fileTreeEl.contains(next)) explorerState.treeHadFocus = false;
});

fileTreeEl.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  // A rename input owns its own keys - Enter commits, Escape cancels.
  if (target.classList.contains('tree-item-input')) return;

  const row = target.closest('.tree-item') as HTMLElement | null;
  if (!row) return;

  const order = explorerState.visibleNodeOrder;
  const id = row.dataset.id ?? '';
  const type = row.dataset.type as 'file' | 'folder';
  const at = order.indexOf(id);
  if (at === -1) return;

  const move = (to: number): void => {
    const next = order[Math.max(0, Math.min(order.length - 1, to))];
    if (next) focusRow(next);
  };

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      move(at + 1);
      return;

    case 'ArrowUp':
      event.preventDefault();
      move(at - 1);
      return;

    case 'Home':
      event.preventDefault();
      move(0);
      return;

    case 'End':
      event.preventDefault();
      move(order.length - 1);
      return;

    case 'ArrowRight':
      event.preventDefault();
      // On a collapsed folder, open it. On an open one, step into its first child.
      // On a file, nothing - which is what the pattern says.
      if (type === 'folder' && !explorerState.expandedFolders.has(id)) {
        explorerState.expandedFolders.add(id);
        explorerState.focusedId = id;
        void renderFileTree(tabManager);
      } else if (type === 'folder') {
        move(at + 1);
      }
      return;

    case 'ArrowLeft': {
      event.preventDefault();
      // On an open folder, close it. Otherwise go up to the parent, which is how a
      // student climbs back out of a deep folder without arrowing through everything
      // inside it.
      if (type === 'folder' && explorerState.expandedFolders.has(id)) {
        explorerState.expandedFolders.delete(id);
        explorerState.focusedId = id;
        void renderFileTree(tabManager);
        return;
      }
      const parentId = row.dataset.parent;
      if (parentId && order.includes(parentId)) focusRow(parentId);
      return;
    }

    case 'Enter':
    case ' ':
      event.preventDefault();
      // Same effect as a click, and deliberately routed through it so the two cannot
      // drift: one place decides what opening a row means.
      row.click();
      return;

    case 'F2':
      if (policyState.lockStructure) return;
      event.preventDefault();
      explorerState.selectedItemId = id;
      explorerState.selectedItemType = type;
      explorerState.renamingItemId = id;
      void renderFileTree(tabManager);
      return;

    case 'Delete':
      if (policyState.lockStructure) return;
      event.preventDefault();
      explorerState.selectedItemId = id;
      explorerState.selectedItemType = type;
      explorerState.selectedIds = new Set([id]);
      void deleteSelectedItems();
      return;

    default:
  }
});

// Right-click on empty explorer space opens the root context menu.
fileTreeEl.addEventListener('contextmenu', (e) => {
  if (policyState.lockStructure) return;
  if ((e.target as HTMLElement).closest('.tree-item')) return;

  e.preventDefault();
  explorerState.selectedItemId = null;
  explorerState.selectedItemType = null;
  explorerState.selectedIds = new Set();
  explorerState.lastClickedId = null;
  showContextMenu(e.clientX, e.clientY);
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

const CONTEXT_ACTIONS: Record<string, { icon: string; key: string }> = {
  'new-file': { icon: '📄', key: 'context.newFile' },
  'new-folder': { icon: '📁', key: 'context.newFolder' },
  'import-files': { icon: '⬆️', key: 'context.importFiles' },
  'import-folder': { icon: '📥', key: 'context.importFolder' },
  download: { icon: '⬇️', key: 'context.download' },
  rename: { icon: '✏️', key: 'context.rename' },
  delete: { icon: '🗑️', key: 'context.delete' },
};

function setContextMenuActionLabel(action: string, label?: string): void {
  const item = contextMenuEl.querySelector(`.context-menu-item[data-action="${action}"]`) as HTMLElement | null;
  if (!item) return;
  const config = CONTEXT_ACTIONS[action];
  if (!config) return;
  item.textContent = `${config.icon} ${label ?? t(config.key)}`;
}

function updateContextMenuForSelection() {
  const selectedCount = explorerState.selectedIds.size;

  setContextMenuActionLabel('new-file');
  setContextMenuActionLabel('new-folder');
  setContextMenuActionLabel('import-files');
  setContextMenuActionLabel('import-folder');
  setContextMenuActionLabel('download');
  setContextMenuActionLabel('rename');
  setContextMenuActionLabel('delete');

  // Importing is always available: it targets the selected folder, or the root.
  setContextMenuActionVisible('import-files', true);
  setContextMenuActionVisible('import-folder', true);
  // Downloading needs exactly one thing to download - a file, or a folder as a ZIP.
  setContextMenuActionVisible('download', selectedCount === 1);

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
    const selection = allFiles
      ? tn('explorer.fileCount', selectedCount)
      : allFolders
        ? tn('explorer.folderCount', selectedCount)
        : tn('explorer.itemCount', selectedCount);

    // Multi-selection menu: only batch actions should be shown.
    setContextMenuActionVisible('new-file', false);
    setContextMenuActionVisible('new-folder', true);
    setContextMenuActionVisible('rename', false);
    setContextMenuActionVisible('delete', true);
    setContextMenuActionLabel('new-folder', t('context.newFolder'));
    setContextMenuActionLabel('delete', t('context.deleteAll', { items: selection }));
    return;
  }

  // Single item: keep the existing single-item behaviour.
  setContextMenuActionVisible('new-file', true);
  setContextMenuActionVisible('new-folder', true);
  setContextMenuActionVisible('rename', true);
  setContextMenuActionVisible('delete', true);
}

export function showContextMenu(x: number, y: number) {
  if (policyState.lockStructure) return;
  updateContextMenuForSelection();

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
      case 'import-files':
        await importFromPicker(
          { directory: false },
          explorerState.selectedItemType === 'folder' ? explorerState.selectedItemId : null,
        );
        break;
      case 'import-folder':
        await importFromPicker(
          { directory: true },
          explorerState.selectedItemType === 'folder' ? explorerState.selectedItemId : null,
        );
        break;
      case 'download':
        await downloadSelectedItem();
        break;
      case 'delete':
        await deleteSelectedItems();
        break;
    }
  });
});
