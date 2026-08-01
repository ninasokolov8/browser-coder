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
import { downloadBlob, fileBytesFor } from '../../components/download.ts';
import {
  ASSET_LANGUAGE_ID,
  DEFAULT_ASSET_LIMITS,
  assetTypeFor,
  bytesToBase64,
  validateAsset,
} from '../../workspace/assets.ts';
import { renderFileTree, showContextMenu } from './tree';
import { captureWorkspacePaths, refactorWorkspaceImports } from './import-refactor';
import { isWorkspaceEntryHidden } from '../workspace-visibility';
import { importSafeName, uniqueFileName } from './naming.ts';
import { descendantFolderIds, topLevelItems } from './selection-scope.ts';
import { lazyRef } from '../../app/lazy';

const tabManager = lazyRef(() => runtime.tabManager, 'tabManager');
const editor = lazyRef(() => runtime.editor, 'editor');
const storage = lazyRef(() => runtime.storage, 'storage');
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
  if (!runtime.currentLang || !runtime.currentVersion) return;

  // An explorer-created file starts EMPTY rather than from the starter template:
  // the user asked for a new file, not for a copy of the language's example.
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
  const folderParentById = new Map(allFolders.map(folder => [folder.id, folder.parentId ?? null]));

  return topLevelItems(items, selectedFolderIds, folderParentById);
}

async function getDescendantIdsForFolders(folderIds: Set<string>): Promise<{ folderIds: Set<string>; fileIds: Set<string> }> {
  const allFolders = await storage.getAllFolders();
  const allFiles = await storage.getAllFiles();
  const foldersToInclude = descendantFolderIds(folderIds, allFolders);
  const filesToInclude = new Set<string>();

  for (const file of allFiles) {
    if (file.parentId && foldersToInclude.has(file.parentId)) {
      filesToInclude.add(file.id);
    }
  }

  return { folderIds: foldersToInclude, fileIds: filesToInclude };
}

/**
 * Record which folders the drag now in progress may not be dropped into.
 *
 * Called from `dragstart` without awaiting - see `explorerState.invalidDropTargetIds`.
 * The dragged folders themselves are included, because dropping a folder onto itself
 * and into itself are the same refusal.
 */
export async function markInvalidDropTargets(draggedIds: string[]): Promise<void> {
  const draggedFolderIds = new Set<string>();
  const allFolders = await storage.getAllFolders();
  const known = new Set(allFolders.map(folder => folder.id));
  for (const id of draggedIds) if (known.has(id)) draggedFolderIds.add(id);

  if (draggedFolderIds.size === 0) {
    explorerState.invalidDropTargetIds = new Set();
    return;
  }

  const { folderIds } = await getDescendantIdsForFolders(draggedFolderIds);
  explorerState.invalidDropTargetIds = folderIds;
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

/**
 * Deliberately a no-op, retained so the call sites still read correctly.
 *
 * This existed because a move or a folder rename changed stored paths, and every
 * open tab held its own copy of that metadata - so each structural change had to
 * be followed by a refresh, and the refresh had to carefully preserve unsaved
 * content while replacing everything else. Paths are now derived from the folder
 * tree and content lives in one buffer, so a tab cannot hold stale metadata and
 * there is nothing to synchronize.
 *
 * Kept rather than deleted at every call site because "after moving files, resync
 * the open tabs" is a reasonable thing for a reader to look for; finding it here,
 * and finding it empty, answers the question.
 */
export async function syncOpenTabsFromStorage(): Promise<void> {
  // Intentionally empty. See above.
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

    tabManager.closeAllTabs();

    // Dispose every Monaco model, including models for files with no open tab.
    // The registry owns them, so releasing is enough.
    for (const [fileId] of Array.from(runtime.fileModels.entries())) {
      runtime.fileModels.delete(fileId);
    }

    // clearAll() suspends the autosave writers, unregisters every document and
    // resumes, so a debounced save cannot land after this and recreate a file the
    // user just deleted.
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
    
    // Hidden entries are excluded, exactly as they are from the tree and the tab
    // strip. X_HIDDEN_ is how a teacher ships a solution file or a marking harness
    // alongside a task; storage and execution still see them, but the Download
    // button used to hand the student X_HIDDEN_solution.py in a ZIP. The one
    // student-facing surface that leaked them was the one that writes to disk.
    const files = (await storage.getAllFiles()).filter(file => !isWorkspaceEntryHidden(file));
    const folders = (await storage.getAllFolders()).filter(folder => !isWorkspaceEntryHidden(folder));

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
      // Binary assets are decoded back to bytes. Passing `file.content` straight in
      // wrote the BASE64 TEXT of an image under a `.png` name, producing an archive
      // whose pictures open in nothing - a corrupt-looking export rather than an
      // obviously wrong one. Source files are unaffected: fileBytesFor returns the
      // string untouched for anything that is not an asset.
      const { data } = fileBytesFor(file.name, file.content);
      zip.file(zipPath, data, { binary: typeof data !== 'string' });
    }

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Through the shared helper, so the ZIP download and a single-file download
    // cannot drift again - and so the Safari revoke timing fix applies to both.
    downloadBlob(`project-${new Date().toISOString().slice(0, 10)}.zip`, zipBlob);

    setOutput(`Downloaded ${files.length} files in ${folders.length} folders as ZIP`);
    setStatus('Downloaded ✅');
  } catch (e) {
    setOutput(`Error downloading project: ${e}`);
    setStatus('Error ❌');
  }
});

// Right-clicking blank explorer space is handled in tree.ts, with a `closest`
// guard that also covers the gaps between rows. A second listener here fired the
// same handler twice for the same click - harmless while both are idempotent, and
// exactly the kind of duplicate that diverges the first time one of them is edited.

// Dropping onto empty explorer space moves items to the workspace root,
// and also accepts external files dragged from the OS/desktop.
fileTreeEl.addEventListener('dragover', (e) => {
  // Same reasoning as the per-item handler: a read-only workspace must not paint a
  // drop target for a write it is going to refuse.
  if (policyState.lockStructure) return;
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
  if (policyState.lockStructure) return;
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

// Import files dragged from the desktop into a target folder (or root).
// Only supported-language files are accepted; everything else is reported
// and skipped. Enforces the same limits Step-Up uses (≤8 MB/file, ≤300 files).
export async function importExternalFiles(fileList: FileList, targetParentId: string | null) {
  if (policyState.lockStructure) return;
  // Source files may be up to 8 MB; an ASSET is held to the smaller documented cap.
  // The importer used to pass 8 MB to validateAsset, overriding the 4 MB that exists
  // because assets ride the run payload as base64 - two 6 MB photos would have made
  // every Run fail on the server's JSON body limit rather than on anything the
  // student did.
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_FILES = 300;

  const files = Array.from(fileList);
  if (files.length === 0) return;

  let workspaceCount = (await storage.getAllFiles()).length;
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    // An asset is decided by its extension AND its bytes. A source file is decided
    // by extension alone, because its content is text either way.
    const asset = assetTypeFor(file.name);
    const detected = asset ? null : tabManager.detectLanguageByExtension(file.name);

    if (!asset && !detected) {
      skipped.push(`${file.name} - unsupported file type`);
      continue;
    }
    if (workspaceCount >= MAX_FILES) {
      skipped.push(`${file.name} - workspace file limit (${MAX_FILES}) reached`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push(`${file.name} - larger than 8 MB`);
      continue;
    }

    let content = '';
    let language: string;
    let versionId: string;

    if (asset) {
      // Read as BYTES and validate the signature before storing anything. Trusting
      // the extension here is what would let `payload.html` renamed to `avatar.png`
      // into the workspace, from where the preview publisher would serve it from a
      // real origin. See src/workspace/assets.ts.
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        skipped.push(`${file.name} - could not be read`);
        continue;
      }

      const verdict = validateAsset(file.name, bytes, DEFAULT_ASSET_LIMITS);
      if (!verdict.ok) {
        skipped.push(`${file.name} - ${verdict.message.replace(`${file.name} `, '')}`);
        continue;
      }

      content = bytesToBase64(bytes);
      language = ASSET_LANGUAGE_ID;
      versionId = verdict.type.extension;
    } else {
      try {
        content = await file.text();
      } catch {
        skipped.push(`${file.name} - could not be read`);
        continue;
      }
      language = detected!.id;
      const version = detected!.versions.find(v => v.default) || detected!.versions[0];
      versionId = version.id;
    }

    const safeName = importSafeName(file.name);
    const siblings = await storage.getChildFiles(targetParentId);
    const finalName = uniqueFileName(safeName, siblings.map(s => s.name));

    await storage.createFile({
      name: finalName,
      parentId: targetParentId,
      language,
      version: versionId,
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

/**
 * Move the current drag selection into a target folder (or the root when null).
 *
 * Three things this has to get right, each of which it used to get wrong:
 *
 *  - **Only top-level items move.** Selecting a folder AND something inside it (one
 *    Shift-click away, since the range runs down the visible rows) used to move both:
 *    the folder went into the target, then the descendant was moved in beside it,
 *    tearing the file out of the folder the student dragged. `createFolderFromSelection`
 *    and `deleteSelectedItems` already reduce to top-level items; this did not.
 *  - **A refused move says so.** Dropping a folder into its own descendant is correctly
 *    refused by the service, but nothing was reported: the highlight vanished and the
 *    tree did not change, which reads as "drag and drop is broken".
 *  - **A no-op is not a success.** Dropping an item back into the folder it is already
 *    in reported "Moved 1 item" while nothing happened - which is also how an attempted
 *    reorder looks, because the tree is sorted by name and has no drop positions.
 */
export async function moveItemsInto(targetFolderId: string | null, draggedIds?: string[]) {
  if (policyState.lockStructure) return;
  const ids = Array.from(new Set(draggedIds?.length ? draggedIds : explorerState.draggingIds));
  if (ids.length === 0) return;

  const allFolders = await storage.getAllFolders();
  const folderById = new Map(allFolders.map(folder => [folder.id, folder]));

  const items: ExplorerSelectionItem[] = [];
  for (const id of ids) {
    const folder = folderById.get(id);
    if (folder) {
      items.push({ id, type: 'folder', name: folder.name, parentId: folder.parentId ?? null });
      continue;
    }
    const file = await storage.getFile(id);
    if (file) items.push({ id, type: 'file', name: file.name, parentId: file.parentId ?? null });
  }

  const toMove = await getTopLevelSelectionItems(items);
  if (toMove.length === 0) {
    explorerState.draggingIds = [];
    return;
  }

  const beforePaths = await captureWorkspacePaths();
  let movedAny = false;
  let refusedCycle = false;
  let alreadyThere = 0;

  for (const item of toMove) {
    // Dropping a folder onto itself is the same gesture as dropping it into itself.
    if (item.id === targetFolderId) {
      refusedCycle = true;
      continue;
    }
    if (item.parentId === targetFolderId) {
      alreadyThere++;
      continue;
    }

    if (item.type === 'folder') {
      const res = await storage.moveFolder(item.id, targetFolderId);
      // `null` here means the service refused a cycle - the only reason it can fail
      // once the parent is known to differ.
      if (res) movedAny = true;
      else refusedCycle = true;
    } else {
      const res = await storage.moveFile(item.id, targetFolderId);
      if (res) movedAny = true;
      // No tab metadata to fix up: a tab's path is derived from the folder tree,
      // so the move is already visible everywhere it is read.
    }
  }

  // Clear drag state only after all asynchronous storage moves finish.
  explorerState.draggingIds = [];

  if (!movedAny) {
    if (refusedCycle) setStatus('A folder cannot be moved inside itself');
    else if (alreadyThere > 0) setStatus('Already in that folder');
    return;
  }

  // A moved folder changes the path of every descendant file. Refresh every
  // open tab from storage so tab metadata and future entry-point selection
  // cannot retain stale paths. Unsaved model contents are preserved.
  await syncOpenTabsFromStorage();

  // The writes have already committed, so the tree MUST be redrawn even if the import
  // rewrite fails - otherwise the file has really moved and the explorer still shows
  // it in the old place, with no error and nothing to click.
  let refactorResult: { replacements: number; warnings: string[] } = { replacements: 0, warnings: [] };
  let refactorError: unknown = null;
  try {
    refactorResult = await refactorWorkspaceImports(beforePaths);
  } catch (error) {
    refactorError = error;
  }

  if (targetFolderId) explorerState.expandedFolders.add(targetFolderId);
  await renderFileTree(tabManager);
  runtime.notifyWorkspaceChanged();

  const moved = toMove.length - alreadyThere - (refusedCycle ? 1 : 0);
  const refactorSuffix = refactorResult.replacements > 0
    ? `; updated ${refactorResult.replacements} import${refactorResult.replacements === 1 ? '' : 's'}`
    : '';
  setStatus(`Moved ${moved} item${moved === 1 ? '' : 's'}${refactorSuffix}`);

  if (refactorError) {
    setOutput(`Files moved, but imports could not be updated: ${refactorError}`);
  } else if (refactorResult.warnings.length > 0) {
    setOutput(refactorResult.warnings.join('\n'));
  }
}

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
