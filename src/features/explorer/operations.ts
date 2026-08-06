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
import { downloadBlob, downloadFile, fileBytesFor } from '../../components/download.ts';
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
import { archiveFolderName, planImport } from './import-plan.ts';
import { descendantFolderIds, topLevelItems } from './selection-scope.ts';
import { placeRelativeTo } from './ordering.ts';
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

/**
 * Download whichever explorer item is selected.
 *
 * There was no way to export one file: the toolbar arrow acts on the active TAB, and
 * the explorer had no download at all - so exporting a file meant opening it first,
 * and exporting a folder was impossible.
 */
export async function downloadSelectedItem(): Promise<void> {
  const id = explorerState.selectedItemId;
  if (!id) return;

  const file = await storage.getFile(id);
  if (file) {
    // `fileBytesFor` decides text-or-bytes from the name, so an image exports as an
    // image here too.
    downloadFile(file.name, file.content);
    setStatus(`Downloaded ${file.name}`);
    return;
  }

  const folder = await storage.getFolder(id);
  if (!folder) return;

  const prefix = `${folder.path}/`;
  const contents = (await storage.getAllFiles())
    .filter(candidate => !isWorkspaceEntryHidden(candidate))
    .filter(candidate => candidate.path.startsWith(prefix));

  if (contents.length === 0) {
    setStatus(`${folder.name} is empty`);
    return;
  }

  const zip = new JSZip();
  for (const candidate of contents) {
    const { data } = fileBytesFor(candidate.name, candidate.content);
    // Relative to the folder being exported, so unpacking gives that folder back
    // rather than the whole path from the workspace root.
    zip.file(candidate.path.slice(prefix.length), data, { binary: typeof data !== 'string' });
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  downloadBlob(`${folder.name}.zip`, blob);
  setStatus(`Downloaded ${folder.name}.zip`);
}

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
    // `importDroppedItems`, not `importExternalFiles`: only the entry API can see
    // inside a dropped folder, and it must be read before this handler yields.
    await importDroppedItems(e.dataTransfer!, null);
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

/**
 * One file on its way into the workspace, wherever it came from.
 *
 * The three sources - a dragged or picked file, a walked directory, a ZIP entry -
 * differ only in how the bytes are obtained and what the path looks like, so they are
 * normalised to this and share one importer. They used to share nothing: only flat
 * `FileList` drops were supported at all.
 */
interface IncomingFile {
  /** Path relative to the import root. A bare name for a flat drop. */
  readonly path: string;
  readonly size: number;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_WORKSPACE_FILES = 300;

function incomingFromFile(file: File, path?: string): IncomingFile {
  return {
    // `webkitRelativePath` is set by a directory picker and is the only place the
    // chosen folder's structure survives.
    path: path ?? (file.webkitRelativePath || file.name),
    size: file.size,
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
    text: () => file.text(),
  };
}

/**
 * Create the folder chain a planned import needs, and answer where each path lives.
 *
 * Existing folders are reused rather than duplicated, so importing `src/a.py` into a
 * workspace that already has `src/` puts the file in the folder the student can see.
 */
async function ensureImportFolders(
  directories: readonly string[],
  rootParentId: string | null,
): Promise<Map<string, string | null>> {
  const idByPath = new Map<string, string | null>([['', rootParentId]]);

  for (const directory of directories) {
    const segments = directory.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parentId = idByPath.get(parentPath) ?? rootParentId;

    const siblings = await storage.getChildFolders(parentId);
    const existing = siblings.find(folder => folder.name === name);
    if (existing) {
      idByPath.set(directory, existing.id);
      continue;
    }

    const created = await storage.createFolder({ name, parentId });
    idByPath.set(directory, created.id);
  }

  return idByPath;
}

/**
 * Store one incoming file, deciding how to read it from its name.
 *
 * An asset is decided by its extension AND its bytes; text is decided by extension
 * alone, because its content is text either way. Returns the stored name, or a
 * "name - reason" line when it was refused.
 */
async function storeIncoming(
  incoming: IncomingFile,
  name: string,
  parentId: string | null,
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const asset = assetTypeFor(name);
  const detected = asset ? null : tabManager.detectLanguageByExtension(name);

  if (!asset && !detected) {
    return { ok: false, reason: `${name} - unsupported file type` };
  }

  let content: string;
  let language: string;
  let versionId: string;

  if (asset) {
    // Read as BYTES and validate the signature before storing anything. Trusting
    // the extension here is what would let `payload.html` renamed to `avatar.png`
    // into the workspace, from where the preview publisher would serve it from a
    // real origin. See src/workspace/assets.ts.
    let bytes: Uint8Array;
    try {
      bytes = await incoming.bytes();
    } catch {
      return { ok: false, reason: `${name} - could not be read` };
    }

    const verdict = validateAsset(name, bytes, DEFAULT_ASSET_LIMITS);
    if (!verdict.ok) {
      return { ok: false, reason: `${name} - ${verdict.message.replace(`${name} `, '')}` };
    }

    content = bytesToBase64(bytes);
    language = ASSET_LANGUAGE_ID;
    versionId = verdict.type.extension;
  } else {
    try {
      content = await incoming.text();
    } catch {
      return { ok: false, reason: `${name} - could not be read` };
    }
    language = detected!.id;
    const version = detected!.versions.find(v => v.default) || detected!.versions[0];
    versionId = version.id;
  }

  const siblings = await storage.getChildFiles(parentId);
  const finalName = uniqueFileName(name, siblings.map(sibling => sibling.name));

  await storage.createFile({
    name: finalName,
    parentId,
    language,
    version: versionId,
    content,
    isUserModified: true,
  });

  return { ok: true, name: finalName };
}

/**
 * Import a set of files, preserving whatever folder structure their paths describe.
 *
 * The single entry point for every source. The plan is computed first, in a pure
 * module, so an illegal path is refused before anything has been written - which
 * matters most for a ZIP, where the paths come from a file the student did not
 * necessarily make.
 */
async function importIncomingFiles(
  incoming: readonly IncomingFile[],
  targetParentId: string | null,
): Promise<void> {
  if (policyState.lockStructure) return;
  if (incoming.length === 0) return;

  const existingFileCount = (await storage.getAllFiles()).length;
  const plan = planImport(
    incoming.map(file => ({ path: file.path, size: file.size })),
    {
      existingFileCount,
      maxFiles: MAX_WORKSPACE_FILES,
      maxBytesPerFile: MAX_IMPORT_BYTES,
    },
  );

  const byPath = new Map(incoming.map(file => [file.path.replace(/\\/g, '/'), file]));
  const folderIds = await ensureImportFolders(plan.directories, targetParentId);

  const imported: string[] = [];
  const skipped: string[] = [...plan.skipped];

  for (const planned of plan.files) {
    const source = byPath.get(planned.path);
    if (!source) continue;

    const parentPath = planned.directories[planned.directories.length - 1] ?? '';
    const parentId = folderIds.get(parentPath) ?? targetParentId;

    const result = await storeIncoming(source, importSafeName(planned.name), parentId);
    if (result.ok) imported.push(result.name);
    else skipped.push(result.reason);
  }

  if (imported.length > 0) {
    if (targetParentId) explorerState.expandedFolders.add(targetParentId);
    for (const id of folderIds.values()) if (id) explorerState.expandedFolders.add(id);
    await renderFileTree(tabManager);
    runtime.notifyWorkspaceChanged();
    setStatus(`Imported ${imported.length} file${imported.length === 1 ? '' : 's'}`);
  }

  if (skipped.length > 0) {
    const lines = ['Some files were not imported:', ...skipped.map(reason => '  • ' + reason)];
    if (imported.length > 0) lines.unshift(`Imported ${imported.length} file(s).`, '');
    setOutput(lines.join('\n'));
  } else if (imported.length === 0) {
    setStatus('Nothing to import');
  }
}

/**
 * Unpack a ZIP into the workspace.
 *
 * Into a folder named after the archive, not into the drop target: extracting a
 * hundred files straight into a student's project leaves nothing to undo, and a single
 * folder can be deleted in one action. It also means a project exported by the
 * Download button can be brought back - before this, re-dropping that ZIP stored it as
 * an opaque asset whose viewer said "this file type has no preview", with the whole
 * project inside a file the IDE could not open.
 */
export async function importArchive(file: File, targetParentId: string | null): Promise<void> {
  if (policyState.lockStructure) return;

  setStatus(`Reading ${file.name}…`);

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (error) {
    setStatus('Could not read the archive');
    setOutput(`${file.name} could not be opened as a ZIP: ${error}`);
    return;
  }

  const incoming: IncomingFile[] = [];
  archive.forEach((path, entry) => {
    if (entry.dir) return;
    incoming.push({
      path,
      // `_data.uncompressedSize` is jszip's own metadata; absent for an entry it has
      // not indexed, in which case the cap is applied after reading instead.
      size: (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0,
      bytes: async () => new Uint8Array(await entry.async('arraybuffer')),
      text: () => entry.async('string'),
    });
  });

  if (incoming.length === 0) {
    setStatus('The archive is empty');
    return;
  }

  const siblings = await storage.getChildFolders(targetParentId);
  const folderName = uniqueFolderName(
    archiveFolderName(importSafeName(file.name)),
    siblings.map(folder => folder.name),
  );
  const folder = await storage.createFolder({ name: folderName, parentId: targetParentId });

  await importIncomingFiles(incoming, folder.id);
}

// Import files dragged from the desktop into a target folder (or root).
// Only supported-language files are accepted; everything else is reported
// and skipped. Enforces the same limits Step-Up uses (<=8 MB/file, <=300 files).
export async function importExternalFiles(fileList: FileList, targetParentId: string | null) {
  if (policyState.lockStructure) return;

  const files = Array.from(fileList);
  if (files.length === 0) return;

  // A lone ZIP is unpacked rather than stored. Dropping several files that happen to
  // include an archive keeps the old behaviour for the rest.
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    await importArchive(files[0], targetParentId);
    return;
  }

  await importIncomingFiles(files.map(file => incomingFromFile(file)), targetParentId);
}

/**
 * Walk a directory dropped from the desktop.
 *
 * `webkitGetAsEntry` is the only way to see inside a dropped folder: `dataTransfer
 * .files` contains one extension-less entry for the directory itself, which is why
 * dragging a folder used to report "project - unsupported file type" and import
 * nothing at all.
 *
 * The entries must be taken from the DataTransfer synchronously - the item list is
 * neutered as soon as the event handler yields - so this is called with entries that
 * the caller has already collected.
 */
async function collectDirectory(
  directory: FileSystemDirectoryEntry,
  prefix: string,
  into: IncomingFile[],
): Promise<void> {
  const reader = directory.createReader();

  for (;;) {
    // readEntries returns at most 100 at a time and signals the end with an empty
    // batch, so a folder of 250 files needs three calls. Reading once is a bug that
    // only shows up on big folders.
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return;

    for (const entry of batch) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        into.push(incomingFromFile(file, path));
      } else if (entry.isDirectory) {
        await collectDirectory(entry as FileSystemDirectoryEntry, path, into);
      }
    }
  }
}

/**
 * Import an OS drop that may contain folders.
 *
 * Falls back to the flat path when the browser does not offer entries, so nothing is
 * lost on a browser without the API.
 */
export async function importDroppedItems(
  transfer: DataTransfer,
  targetParentId: string | null,
): Promise<void> {
  if (policyState.lockStructure) return;

  // Collected synchronously, before the first await: DataTransferItemList does not
  // survive the handler yielding.
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    await importExternalFiles(transfer.files, targetParentId);
    return;
  }

  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) {
    const file = await new Promise<File>((resolve, reject) => {
      (entries[0] as FileSystemFileEntry).file(resolve, reject);
    });
    await importArchive(file, targetParentId);
    return;
  }

  const incoming: IncomingFile[] = [];
  try {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (entry as FileSystemFileEntry).file(resolve, reject);
        });
        incoming.push(incomingFromFile(file, entry.name));
      } else if (entry.isDirectory) {
        await collectDirectory(entry as FileSystemDirectoryEntry, entry.name, incoming);
      }
    }
  } catch (error) {
    setOutput(`Could not read the dropped folder: ${error}`);
  }

  await importIncomingFiles(incoming, targetParentId);
}

/**
 * Import from a file picker, so importing does not require knowing to drag.
 *
 * There was no picker at all: no `<input type="file">` anywhere in the app, and no
 * Import command in the palette, the sidebar or any context menu.
 */
export async function importFromPicker(
  options: { directory: boolean },
  targetParentId: string | null,
): Promise<void> {
  if (policyState.lockStructure) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (options.directory) input.webkitdirectory = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  const chosen = await new Promise<FileList | null>(resolve => {
    // `cancel` is not universally supported, so the promise is also resolved by
    // change; whichever fires first wins and the other is a no-op.
    input.addEventListener('change', () => resolve(input.files), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });

  input.remove();
  if (!chosen || chosen.length === 0) return;

  const files = Array.from(chosen);
  if (!options.directory && files.length === 1 && /\.zip$/i.test(files[0].name)) {
    await importArchive(files[0], targetParentId);
    return;
  }

  await importIncomingFiles(files.map(file => incomingFromFile(file)), targetParentId);
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

/**
 * Drop one or more items next to a specific row, rather than into a folder.
 *
 * This is the half of drag-and-drop that never existed: the tree was sorted by name on
 * every render, so there was no such thing as a position to drop at, and a same-parent
 * drag reported "Moved 1 item" while doing nothing at all.
 *
 * A positional drop can also CHANGE parent - dragging a file from `src/` to sit between
 * two files at the root is one gesture - so the move happens first and the ordering
 * second, against the parent the item ends up in.
 */
export async function placeItemsBeside(
  targetId: string,
  position: 'before' | 'after',
  draggedIds: string[],
): Promise<void> {
  if (policyState.lockStructure) return;

  const workspace = runtime.workspace;
  if (!workspace) return;

  const ids = Array.from(new Set(draggedIds));
  if (ids.length === 0 || ids.includes(targetId)) return;

  // Which parent the target sits in is where everything lands.
  const targetFile = await storage.getFile(targetId);
  const targetFolder = targetFile ? null : await storage.getFolder(targetId);
  if (!targetFile && !targetFolder) return;
  const parentId = (targetFile?.parentId ?? targetFolder?.parentId) ?? null;

  // Only top-level items, for the same reason a plain move reduces them: dragging a
  // folder together with something inside it must not tear the inner item out.
  const folderIds = new Set((await storage.getAllFolders()).map(folder => folder.id));
  const items: ExplorerSelectionItem[] = [];
  for (const id of ids) {
    const folder = folderIds.has(id) ? await storage.getFolder(id) : null;
    if (folder) {
      items.push({ id, type: 'folder', name: folder.name, parentId: folder.parentId ?? null });
      continue;
    }
    const file = await storage.getFile(id);
    if (file) items.push({ id, type: 'file', name: file.name, parentId: file.parentId ?? null });
  }
  const toPlace = await getTopLevelSelectionItems(items);
  if (toPlace.length === 0) return;

  const beforePaths = await captureWorkspacePaths();

  // Move anything that is not already in the destination parent.
  for (const item of toPlace) {
    if (item.parentId === parentId) continue;
    if (item.type === 'folder') {
      const moved = await storage.moveFolder(item.id, parentId);
      if (!moved) {
        setStatus('A folder cannot be moved inside itself');
        return;
      }
    } else {
      await storage.moveFile(item.id, parentId);
    }
  }

  // Then arrange. The display order is rebuilt from what is on screen, because that is
  // what the student was looking at when they let go. `currentSiblingOrder` keeps only
  // the ids that really are children of this parent, so the whole visible list can be
  // handed over as-is.
  let arranged = await currentSiblingOrder(parentId, explorerState.visibleNodeOrder);
  for (const item of toPlace) {
    arranged = placeRelativeTo(arranged, item.id, targetId, position);
  }

  await workspace.reorderChildren(parentId, arranged);

  const refactorResult = await refactorWorkspaceImports(beforePaths).catch(() => ({
    replacements: 0,
    warnings: [] as string[],
  }));

  await renderFileTree(tabManager);
  runtime.notifyWorkspaceChanged();
  setStatus(
    toPlace.length === 1 ? 'Moved 1 item' : `Moved ${toPlace.length} items`,
  );
  if (refactorResult.warnings.length > 0) setOutput(refactorResult.warnings.join('\n'));
}

/**
 * Every child of a parent, in the order the tree is showing them.
 *
 * `visibleNodeOrder` only holds what is on screen, so a collapsed folder's children are
 * absent - fine, because they are not this parent's children. Anything the tree did not
 * list is appended, so a renumber can never silently drop a sibling.
 */
async function currentSiblingOrder(
  parentId: string | null,
  displayed: readonly string[],
): Promise<string[]> {
  const children = [
    ...(await storage.getChildFolders(parentId)).map(folder => folder.id),
    ...(await storage.getChildFiles(parentId)).map(file => file.id),
  ];
  const known = new Set(children);
  const ordered = displayed.filter(id => known.has(id));
  for (const id of children) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export function setExpandedFolders(value: Set<string>): void {
  explorerState.expandedFolders = value;
}
