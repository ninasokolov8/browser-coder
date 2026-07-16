// @ts-nocheck
import JSZip from 'jszip';
import { runtime } from '../../app/runtime';
import { policyState } from '../../app/config';
import {
  fileTreeEl, btnNewFile, btnNewFolder, btnRefresh, btnDownloadProject,
  btnClearCache,
} from '../../components/dom';
import { setStatus, setOutput } from '../../components/output';
import { getOrCreateModel, disposeModel, updateEmptyState } from '../editor-core';
import { explorerState } from './state';
import { renderFileTree } from './tree';
import { captureWorkspacePaths, refactorWorkspaceImports } from './import-refactor';

const tabManager = new Proxy({} as any, { get: (_t, p) => (runtime.tabManager as any)[p] });
const editor = new Proxy({} as any, { get: (_t, p) => (runtime.editor as any)[p] });
const storage = new Proxy({} as any, { get: (_t, p) => (runtime.storage as any)[p] });
const fileModels = runtime.fileModels;

const INTERNAL_DRAG_MIME = 'application/x-browser-coder-items';

/** Read internal dragged IDs from DataTransfer, with state as a fallback. */
export function getInternalDraggedIds(e?: DragEvent): string[] {
  const raw = e?.dataTransfer?.getData(INTERNAL_DRAG_MIME)
    || e?.dataTransfer?.getData('text/plain')
    || '';

  const fromTransfer = raw
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  return fromTransfer.length > 0
    ? Array.from(new Set(fromTransfer))
    : Array.from(new Set(explorerState.draggingIds));
}

// ===== File/Folder Operations =====
export async function createNewFileInExplorer(parentId: string | null) {
  if (policyState.lockStructure) return;
  // Create with empty file by default when user manually creates a file (not loading from storage)
  const newTab = await tabManager.createNewFile(runtime.currentLang, runtime.currentVersion, undefined, parentId, true);
  if (newTab) {
    const model = getOrCreateModel(newTab);
    editor.setModel(model);
    updateEmptyState(false);
    // Start renaming immediately
    explorerState.renamingItemId = newTab.file.id;
    if (parentId) explorerState.expandedFolders.add(parentId);
    renderFileTree(tabManager);
    runtime.notifyWorkspaceChanged();
  }
}

export async function createNewFolder(parentId: string | null) {
  if (policyState.lockStructure) return;
  const folder = await storage.createFolder({ name: 'New Folder', parentId });
  if (parentId) explorerState.expandedFolders.add(parentId);
  explorerState.expandedFolders.add(folder.id);
  explorerState.renamingItemId = folder.id;
  renderFileTree(tabManager);
  runtime.notifyWorkspaceChanged();
}

interface ExplorerSelectionItem {
  id: string;
  type: 'file' | 'folder';
  name: string;
  parentId: string | null;
}

function formatSelectionNoun(items: ExplorerSelectionItem[]): string {
  const count = items.length;
  const allFiles = items.every(item => item.type === 'file');
  const allFolders = items.every(item => item.type === 'folder');
  const noun = allFiles ? 'file' : allFolders ? 'folder' : 'item';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

async function getExplorerSelectionItems(): Promise<ExplorerSelectionItem[]> {
  const ids = explorerState.selectedIds.size > 0
    ? Array.from(explorerState.selectedIds)
    : explorerState.selectedItemId
      ? [explorerState.selectedItemId]
      : [];

  const items: ExplorerSelectionItem[] = [];
  for (const id of ids) {
    const file = await storage.getFile(id);
    if (file) {
      items.push({ id: file.id, type: 'file', name: file.name, parentId: file.parentId });
      continue;
    }

    const folder = await storage.getFolder(id);
    if (folder) {
      items.push({ id: folder.id, type: 'folder', name: folder.name, parentId: folder.parentId });
    }
  }

  return items;
}

async function getTopLevelSelectionItems(items: ExplorerSelectionItem[]): Promise<ExplorerSelectionItem[]> {
  const selectedFolderIds = new Set(items.filter(item => item.type === 'folder').map(item => item.id));
  if (selectedFolderIds.size === 0) return items;

  const allFolders = await storage.getAllFolders();
  const folderById = new Map(allFolders.map(folder => [folder.id, folder]));

  return items.filter(item => {
    let parentId = item.parentId;
    while (parentId) {
      if (selectedFolderIds.has(parentId)) return false;
      parentId = folderById.get(parentId)?.parentId ?? null;
    }
    return true;
  });
}

async function getDescendantIdsForFolders(folderIds: Set<string>): Promise<{ folderIds: Set<string>; fileIds: Set<string> }> {
  const allFolders = await storage.getAllFolders();
  const allFiles = await storage.getAllFiles();
  const foldersToInclude = new Set(folderIds);
  const filesToInclude = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of allFolders) {
      if (folder.parentId && foldersToInclude.has(folder.parentId) && !foldersToInclude.has(folder.id)) {
        foldersToInclude.add(folder.id);
        changed = true;
      }
    }
  }

  for (const file of allFiles) {
    if (file.parentId && foldersToInclude.has(file.parentId)) {
      filesToInclude.add(file.id);
    }
  }

  return { folderIds: foldersToInclude, fileIds: filesToInclude };
}

function uniqueFolderName(baseName: string, existingNames: string[]): string {
  const existing = new Set(existingNames);
  if (!existing.has(baseName)) return baseName;

  let counter = 1;
  let candidate = `${baseName}_${counter}`;
  while (existing.has(candidate)) {
    counter++;
    candidate = `${baseName}_${counter}`;
  }
  return candidate;
}

export async function syncOpenTabsFromStorage(): Promise<void> {
  for (const tab of tabManager.getAllTabs()) {
    const storedFile = await storage.getFile(tab.file.id);
    if (!storedFile) continue;

    // Preserve unsaved editor content while refreshing path/parent metadata.
    tab.file = tab.isDirty
      ? { ...storedFile, content: tab.file.content, isUserModified: tab.file.isUserModified }
      : storedFile;
  }
}

export async function createFolderFromSelection() {
  if (policyState.lockStructure) return;

  const selectedItems = await getExplorerSelectionItems();
  if (selectedItems.length <= 1) {
    await createNewFolder(explorerState.selectedItemType === 'folder' ? explorerState.selectedItemId : null);
    return;
  }

  const itemsToMove = await getTopLevelSelectionItems(selectedItems);
  if (itemsToMove.length === 0) return;

  const parentIds = new Set(itemsToMove.map(item => item.parentId));
  const newFolderParentId = parentIds.size === 1
    ? itemsToMove[0].parentId
    : (itemsToMove.find(item => item.id === explorerState.selectedItemId)?.parentId ?? null);

  const siblingFolders = await storage.getChildFolders(newFolderParentId);
  const folderName = uniqueFolderName('New Folder', siblingFolders.map(folder => folder.name));
  const beforePaths = await captureWorkspacePaths();
  const folder = await storage.createFolder({ name: folderName, parentId: newFolderParentId });

  for (const item of itemsToMove) {
    if (item.id === folder.id) continue;

    if (item.type === 'folder') {
      await storage.moveFolder(item.id, folder.id);
    } else {
      await storage.moveFile(item.id, folder.id);
    }
  }

  await syncOpenTabsFromStorage();
  const refactorResult = await refactorWorkspaceImports(beforePaths);

  if (newFolderParentId) explorerState.expandedFolders.add(newFolderParentId);
  explorerState.expandedFolders.add(folder.id);
  explorerState.selectedIds = new Set([folder.id]);
  explorerState.selectedItemId = folder.id;
  explorerState.selectedItemType = 'folder';
  explorerState.renamingItemId = folder.id;

  renderFileTree(tabManager);
  runtime.notifyWorkspaceChanged();
  const refactorSuffix = refactorResult.replacements > 0
    ? `; updated ${refactorResult.replacements} import${refactorResult.replacements === 1 ? '' : 's'}`
    : '';
  setStatus(`Moved ${formatSelectionNoun(selectedItems)} into ${folder.name}${refactorSuffix}`);
  if (refactorResult.warnings.length > 0) {
    setOutput(refactorResult.warnings.join('\n'));
  }
}

export async function deleteSelectedItems() {
  if (policyState.lockStructure) return;

  const selectedItems = await getExplorerSelectionItems();
  if (selectedItems.length === 0) return;

  const selectedDescription = formatSelectionNoun(selectedItems);
  const confirmed = selectedItems.length === 1
    ? confirm(`Are you sure you want to delete this ${selectedItems[0].type}?`)
    : confirm(`Are you sure you want to delete all ${selectedDescription}?`);
  if (!confirmed) return;

  const topLevelItems = await getTopLevelSelectionItems(selectedItems);
  const selectedFolderIds = new Set(topLevelItems.filter(item => item.type === 'folder').map(item => item.id));
  const descendantIds = await getDescendantIdsForFolders(selectedFolderIds);

  const fileIdsToClose = new Set<string>([
    ...topLevelItems.filter(item => item.type === 'file').map(item => item.id),
    ...descendantIds.fileIds,
  ]);

  for (const fileId of fileIdsToClose) {
    if (tabManager.getTab(fileId)) {
      await tabManager.closeTab(fileId);
    }
  }

  for (const item of topLevelItems) {
    if (item.type === 'folder') {
      await storage.deleteFolder(item.id);
    } else {
      await storage.deleteFile(item.id);
    }
  }

  for (const folderId of descendantIds.folderIds) {
    explorerState.expandedFolders.delete(folderId);
  }

  explorerState.selectedIds = new Set();
  explorerState.selectedItemId = null;
  explorerState.selectedItemType = null;
  explorerState.lastClickedId = null;

  renderFileTree(tabManager);
  runtime.notifyWorkspaceChanged();
  setStatus(`Deleted ${selectedDescription}`);
}

// ===== Sidebar Toolbar Buttons =====
btnNewFile.addEventListener('click', () => {
  if (policyState.lockStructure) return;
  createNewFileInExplorer(null);
});
btnNewFolder.addEventListener('click', () => {
  if (policyState.lockStructure) return;
  createNewFolder(null);
});
btnRefresh.addEventListener('click', () => renderFileTree(tabManager));

// Clear Cache - permanently removes every workspace file/folder and resets UI state.
btnClearCache.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to clear ALL cached data? This will delete every file and folder and cannot be undone.'
  );
  if (!confirmed) return;

  btnClearCache.disabled = true;
  setStatus('Clearing workspace...');

  try {
    // Detach Monaco first so model disposal cannot trigger editor callbacks
    // against tabs that are being removed.
    editor.setModel(null);

    // closeAllTabs() also cancels any pending debounced auto-save. This must
    // happen BEFORE clearing IndexedDB, otherwise a delayed save can recreate
    // files immediately after clearAll().
    tabManager.closeAllTabs();

    // Dispose every Monaco model, including models for files that are not
    // currently represented by an open tab.
    for (const [fileId, model] of Array.from(runtime.fileModels.entries())) {
      if (model && !model.isDisposed()) {
        model.dispose();
      }
      runtime.fileModels.delete(fileId);
    }

    // Clear persistent workspace data only after all writers are stopped.
    await storage.clearAll();

    // Defensive verification: do not report success while IndexedDB still
    // contains records. A second clear handles interrupted/late transactions.
    let remainingFiles = await storage.getAllFiles();
    let remainingFolders = await storage.getAllFolders();

    if (remainingFiles.length > 0 || remainingFolders.length > 0) {
      await storage.clearAll();
      remainingFiles = await storage.getAllFiles();
      remainingFolders = await storage.getAllFolders();
    }

    if (remainingFiles.length > 0 || remainingFolders.length > 0) {
      throw new Error(
        `Workspace clear was incomplete (${remainingFiles.length} files, ${remainingFolders.length} folders remain)`
      );
    }

    localStorage.removeItem('browser-coder-settings');

    explorerState.expandedFolders = new Set();
    explorerState.selectedIds = new Set();
    explorerState.selectedItemId = null;
    explorerState.selectedItemType = null;
    explorerState.lastClickedId = null;
    explorerState.renamingItemId = null;
    explorerState.draggingIds = [];

    await renderFileTree(tabManager);
    updateEmptyState(true);

    setOutput('All files, folders, open tabs, editor models, and cached workspace data were deleted.');
    setStatus('Workspace cleared ✅');
    runtime.notifyWorkspaceChanged();
  } catch (error) {
    console.error('Failed to clear workspace', error);
    setOutput(`Error clearing workspace: ${error instanceof Error ? error.message : String(error)}`);
    setStatus('Clear failed ❌');
  } finally {
    btnClearCache.disabled = false;
  }
});

// Download Project - downloads all files as a proper ZIP
btnDownloadProject.addEventListener('click', async () => {
  try {
    setStatus('Preparing ZIP...');
    setOutput('Creating ZIP file...');
    
    const files = await storage.getAllFiles();
    const folders = await storage.getAllFolders();
    
    if (files.length === 0) {
      setOutput('No files to download');
      setStatus('No files');
      return;
    }

    const zip = new JSZip();

    // Create folder structure in ZIP
    for (const folder of folders) {
      // Remove leading slash for ZIP paths
      const zipPath = folder.path.startsWith('/') ? folder.path.slice(1) : folder.path;
      zip.folder(zipPath);
    }

    // Add all files to ZIP
    for (const file of files) {
      // Remove leading slash for ZIP paths
      const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
      zip.file(zipPath, file.content);
    }

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Download the ZIP
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setOutput(`Downloaded ${files.length} files in ${folders.length} folders as ZIP`);
    setStatus('Downloaded ✅');
  } catch (e) {
    setOutput(`Error downloading project: ${e}`);
    setStatus('Error ❌');
  }
});

// Right-click on empty area of file tree
fileTreeEl.addEventListener('contextmenu', (e) => {
  if (policyState.lockStructure) return;
  if (e.target === fileTreeEl) {
    e.preventDefault();
    explorerState.selectedItemId = null;
    explorerState.selectedItemType = null;
    explorerState.selectedIds = new Set();
    explorerState.lastClickedId = null;
    showContextMenu(e.clientX, e.clientY, 'folder');
  }
});

// Dropping onto empty explorer space moves items to the workspace root,
// and also accepts external files dragged from the OS/desktop.
fileTreeEl.addEventListener('dragover', (e) => {
  const external = isExternalFileDrag(e);
  if (getInternalDraggedIds(e).length === 0 && !external) return;
  // Only treat blank area / the container itself as a root drop target
  const overItem = (e.target as HTMLElement).closest('.tree-item');
  if (!overItem) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = external ? 'copy' : 'move';
    clearDropHighlights();
    fileTreeEl.classList.add('root-drop-target');
  }
});
fileTreeEl.addEventListener('dragleave', (e) => {
  if (e.target === fileTreeEl) fileTreeEl.classList.remove('root-drop-target');
});
fileTreeEl.addEventListener('drop', async (e) => {
  const overItem = (e.target as HTMLElement).closest('.tree-item');
  fileTreeEl.classList.remove('root-drop-target');
  if (overItem) return; // item drops are handled by the item's own handler
  const external = isExternalFileDrag(e);
  if (getInternalDraggedIds(e).length === 0 && !external) return;
  e.preventDefault();
  if (external) {
    await importExternalFiles(e.dataTransfer!.files, null);
  } else {
    await moveItemsInto(null, getInternalDraggedIds(e));
  }
});

// True when the drag originates from the OS (files from the desktop),
// rather than an internal explorer item move.
export function isExternalFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
}

// Make a file name unique within a set of existing sibling names.
function uniqueFileName(name: string, existing: string[]): string {
  const set = new Set(existing);
  if (!set.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate = `${base}_${i}${ext}`;
  while (set.has(candidate)) { i++; candidate = `${base}_${i}${ext}`; }
  return candidate;
}

// Import files dragged from the desktop into a target folder (or root).
// Only supported-language files are accepted; everything else is reported
// and skipped. Enforces the same limits Step-Up uses (≤256 KB/file, ≤300 files).
export async function importExternalFiles(fileList: FileList, targetParentId: string | null) {
  if (policyState.lockStructure) return;
  const MAX_BYTES = 256 * 1024;
  const MAX_FILES = 300;

  const files = Array.from(fileList);
  if (files.length === 0) return;

  let workspaceCount = (await storage.getAllFiles()).length;
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const detected = tabManager.detectLanguageByExtension(file.name);
    if (!detected) {
      skipped.push(`${file.name} - unsupported file type`);
      continue;
    }
    if (workspaceCount >= MAX_FILES) {
      skipped.push(`${file.name} - workspace file limit (${MAX_FILES}) reached`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push(`${file.name} - larger than 256 KB`);
      continue;
    }

    let content = '';
    try {
      content = await file.text();
    } catch {
      skipped.push(`${file.name} - could not be read`);
      continue;
    }

    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const siblings = await storage.getChildFiles(targetParentId);
    const finalName = uniqueFileName(safeName, siblings.map(s => s.name));
    const version = detected.versions.find(v => v.default) || detected.versions[0];

    await storage.createFile({
      name: finalName,
      parentId: targetParentId,
      language: detected.id,
      version: version.id,
      content,
      isUserModified: true,
    });
    workspaceCount++;
    imported.push(finalName);
  }

  if (imported.length > 0) {
    if (targetParentId) explorerState.expandedFolders.add(targetParentId);
    renderFileTree(tabManager);
    runtime.notifyWorkspaceChanged();
    setStatus(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`);
  }

  if (skipped.length > 0) {
    const lines = ['Some files were not imported:', ...skipped.map(s => '  • ' + s)];
    if (imported.length > 0) lines.unshift(`Imported ${imported.length} file(s).`, '');
    setOutput(lines.join('\n'));
  }
}

// Clear every drop-target visual state (folders + root zone)
export function clearDropHighlights() {
  fileTreeEl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
  fileTreeEl.classList.remove('root-drop-target');
}

// Move the current drag selection into a target folder (or root when null).
// Skips no-op moves and invalid folder-into-descendant moves (storage guards).
export async function moveItemsInto(targetFolderId: string | null, draggedIds?: string[]) {
  if (policyState.lockStructure) return;
  const ids = Array.from(new Set(draggedIds?.length ? draggedIds : explorerState.draggingIds));
  if (ids.length === 0) return;

  const beforePaths = await captureWorkspacePaths();
  let movedAny = false;
  for (const id of ids) {
    // Don't drop a folder onto itself
    if (id === targetFolderId) continue;
    const folder = await storage.getFolder(id);
    if (folder) {
      const res = await storage.moveFolder(id, targetFolderId);
      if (res) movedAny = true;
    } else {
      const res = await storage.moveFile(id, targetFolderId);
      if (res) movedAny = true;
      // Keep any open tab's cached path/name in sync
      const tab = tabManager.getTab(id);
      if (tab && res) tab.file = res;
    }
  }

  // Clear drag state only after all asynchronous storage moves finish.
  explorerState.draggingIds = [];

  if (movedAny) {
    // A moved folder changes the path of every descendant file. Refresh every
    // open tab from storage so tab metadata and future entry-point selection
    // cannot retain stale paths. Unsaved model contents are preserved.
    await syncOpenTabsFromStorage();
    const refactorResult = await refactorWorkspaceImports(beforePaths);

    if (targetFolderId) explorerState.expandedFolders.add(targetFolderId);
    await renderFileTree(tabManager);
    runtime.notifyWorkspaceChanged();
    const refactorSuffix = refactorResult.replacements > 0
      ? `; updated ${refactorResult.replacements} import${refactorResult.replacements === 1 ? '' : 's'}`
      : '';
    setStatus(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'}${refactorSuffix}`);
    if (refactorResult.warnings.length > 0) {
      setOutput(refactorResult.warnings.join('\n'));
    }
  }
}

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
