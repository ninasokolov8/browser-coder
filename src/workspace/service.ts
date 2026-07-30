/**
 * WorkspaceService - the one owner of workspace state.
 *
 * Everything that mutates the workspace goes through here, and every mutation is
 * a single method that either fully succeeds or leaves the workspace as it was.
 * The code this replaces spread the same responsibilities across `TabManager`
 * (which held content), `StorageManager` (which also held content), and a dozen
 * call sites in the explorer that combined the two in their own order. Commands
 * were therefore sequences of independent awaits, and any of them could fail
 * halfway - which is exactly what V-13 is.
 *
 * Three rules hold throughout:
 *
 * 1. **Content lives in a document's buffer.** Storage is a destination, never a
 *    source of truth for an open document.
 * 2. **Paths are derived.** No stored path can go stale.
 * 3. **Name collisions are checked against the whole workspace**, not against
 *    whatever happens to be open (N-03).
 *
 * No DOM, no Monaco, no IndexedDB: those arrive through ports. That is what lets
 * the data-loss defects be unit-tested in node.
 */

import { MemoryBuffer } from './buffer.ts';
import { Emitter } from './emitter.ts';
import { WorkspaceDocument } from './document.ts';
import { PersistenceCoordinator } from './persistence.ts';
import {
  buildTree,
  collectSubtree,
  findCollisions,
  sortEntriesForDisplay,
  uniqueName,
  wouldCreateCycle,
} from './tree.ts';
import { normalizeWorkspacePath } from '../../server/domain/paths.mjs';
import type { WorkspaceSnapshot, WorkspaceStore } from './store.ts';
import type { WorkspaceTree } from './tree.ts';
import type {
  Disposable,
  DocumentId,
  DocumentMetadata,
  FolderId,
  FolderMetadata,
  PersistedDocument,
  SaveOutcome,
  WorkspaceEntry,
  WorkspaceState,
} from './types.ts';

export interface WorkspaceServiceOptions {
  store: WorkspaceStore;
  autoSaveDelayMs?: number;
  now?: () => number;
  newId?: (kind: 'file' | 'folder') => string;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CreateDocumentRequest {
  name: string;
  parentId?: FolderId | null;
  language: string;
  version: string;
  content?: string;
  isUserModified?: boolean;
}

export interface HostFile {
  path: string;
  content?: string;
  language?: string;
}

export interface ResolvedLanguage {
  readonly id: string;
  readonly version: string;
}

export interface ReplaceAllOptions {
  /**
   * Decide the language AND version for one host file, together.
   *
   * Deliberately a single callback rather than "detect from extension" plus a
   * fallback. Resolving them separately invites pairing an explicitly-supplied
   * language with a version belonging to whichever language the *extension*
   * suggested - `{ language: 'python', path: 'x.js' }` would get a JavaScript
   * version id, which the server then rejects. The caller owns the language
   * registry, so it is the only place that can answer this coherently.
   */
  resolve: (fileName: string, explicitLanguage: string | undefined) => ResolvedLanguage;
}

export interface ReplaceAllResult {
  readonly documents: readonly WorkspaceDocument[];
  readonly reused: number;
  readonly created: number;
  readonly removed: number;
}

export type WorkspaceChangeReason =
  | 'open'
  | 'create'
  | 'rename'
  | 'move'
  | 'delete'
  | 'replace-all'
  | 'clear'
  | 'language';

export interface WorkspaceChangeEvent {
  readonly reason: WorkspaceChangeReason;
  readonly affected: readonly string[];
}

function defaultNewId(kind: 'file' | 'folder'): string {
  // crypto.randomUUID exists in every supported browser and in node 19+. The
  // previous `Date.now()` + Math.random() scheme could collide inside one
  // millisecond, which a bulk import does routinely.
  const unique =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${kind}_${unique}`;
}

export class WorkspaceService {
  #store: WorkspaceStore;
  #now: () => number;
  #newId: (kind: 'file' | 'folder') => string;
  #persistence: PersistenceCoordinator;

  #documents = new Map<DocumentId, WorkspaceDocument>();
  #folders = new Map<FolderId, FolderMetadata>();
  #state: WorkspaceState = { activeFileId: null, theme: 'vs-dark' };
  #tree: WorkspaceTree = { pathById: new Map(), entries: [], repairs: [] };
  #opened = false;

  #onDidChangeWorkspace = new Emitter<WorkspaceChangeEvent>();

  constructor(options: WorkspaceServiceOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => Date.now());
    this.#newId = options.newId ?? defaultNewId;
    this.#persistence = new PersistenceCoordinator({
      store: options.store,
      autoSaveDelayMs: options.autoSaveDelayMs,
      now: this.#now,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
    });
  }

  readonly onDidChangeWorkspace = (
    listener: (event: WorkspaceChangeEvent) => void,
  ): Disposable => this.#onDidChangeWorkspace.event(listener);

  get persistence(): PersistenceCoordinator {
    return this.#persistence;
  }

  get state(): WorkspaceState {
    return this.#state;
  }

  get tree(): WorkspaceTree {
    return this.#tree;
  }

  // ===== lifecycle =====

  async open(): Promise<void> {
    await this.#store.open();
    const snapshot = await this.#store.loadAll();
    this.#adopt(snapshot);
    this.#opened = true;
    this.#fire('open', []);
  }

  /**
   * Open with an empty workspace, discarding anything persisted.
   *
   * Embedded mode: the host supplies content on every load, so restoring a
   * previous session would show the student files that are not part of the task.
   */
  async openEmpty(): Promise<void> {
    await this.#store.open();
    await this.#store.clearAll();
    this.#adopt({ files: [], folders: [], state: { activeFileId: null, theme: this.#state.theme } });
    this.#opened = true;
    this.#fire('open', []);
  }

  get isOpen(): boolean {
    return this.#opened;
  }

  dispose(): void {
    this.#persistence.dispose();
    for (const document of this.#documents.values()) document.dispose();
    this.#documents.clear();
    this.#onDidChangeWorkspace.dispose();
    this.#store.close();
  }

  // ===== reads =====

  getDocument(id: DocumentId): WorkspaceDocument | null {
    return this.#documents.get(id) ?? null;
  }

  allDocuments(): WorkspaceDocument[] {
    return [...this.#documents.values()];
  }

  getFolder(id: FolderId): FolderMetadata | null {
    return this.#folders.get(id) ?? null;
  }

  allFolders(): FolderMetadata[] {
    return [...this.#folders.values()];
  }

  /** Canonical relative path: `src/utils/math.py`. Never leading-slashed. */
  pathOf(id: string): string | null {
    return this.#tree.pathById.get(id) ?? null;
  }

  findByPath(path: string): WorkspaceDocument | null {
    const normalized = normalizeWorkspacePath(path);
    const wanted = normalized.ok ? normalized.path : path;
    for (const [id, candidate] of this.#tree.pathById) {
      if (candidate === wanted) {
        const document = this.#documents.get(id);
        if (document) return document;
      }
    }
    return null;
  }

  entries(): WorkspaceEntry[] {
    return sortEntriesForDisplay(this.#tree.entries);
  }

  childrenOf(parentId: FolderId | null): WorkspaceEntry[] {
    return sortEntriesForDisplay(this.#tree.entries.filter(entry => entry.parentId === parentId));
  }

  get dirtyDocuments(): WorkspaceDocument[] {
    return this.allDocuments().filter(document => document.isDirty);
  }

  /**
   * Every document's current text, keyed by canonical path.
   *
   * Reads the live buffer, so an unsaved edit is included. That is required for
   * correctness, not convenience: a run must execute what the user can see, and
   * reading persisted content instead is how "I pressed Run and it used my old
   * code" happens.
   */
  snapshotForExecution(): Array<{ path: string; content: string; language: string; id: DocumentId }> {
    const files: Array<{ path: string; content: string; language: string; id: DocumentId }> = [];
    for (const document of this.#documents.values()) {
      const path = this.pathOf(document.id);
      if (!path) continue;
      files.push({
        path,
        content: document.getContent(),
        language: document.language,
        id: document.id,
      });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  // ===== documents =====

  async createDocument(request: CreateDocumentRequest): Promise<WorkspaceDocument> {
    const parentId = request.parentId ?? null;
    const name = uniqueName(request.name, this.#siblingFileNames(parentId));

    const metadata: DocumentMetadata = {
      id: this.#newId('file'),
      name,
      parentId,
      language: request.language,
      version: request.version,
      order: this.#nextOrder(parentId),
      createdAt: this.#now(),
      updatedAt: this.#now(),
      isUserModified: request.isUserModified ?? false,
    };

    const content = request.content ?? '';
    // Persist first. A document that exists in memory but not in storage would be
    // silently lost on reload, and the user has no way to know.
    await this.#store.createDocument({ ...metadata, content });

    const document = new WorkspaceDocument({ metadata, buffer: new MemoryBuffer(content) });
    this.#documents.set(document.id, document);
    this.#persistence.register(document);
    this.#rebuildTree();
    this.#fire('create', [document.id]);
    return document;
  }

  /**
   * Rename a document. Metadata only - the working copy is never touched (V-10),
   * and uniqueness is checked against the whole workspace, not open tabs (N-03).
   */
  async renameDocument(id: DocumentId, requestedName: string): Promise<WorkspaceDocument | null> {
    const document = this.#documents.get(id);
    if (!document) return null;

    const trimmed = requestedName.trim();
    if (!trimmed || trimmed === document.name) return document;

    const name = uniqueName(trimmed, this.#siblingFileNames(document.parentId, id));
    const updatedAt = this.#now();

    await this.#store.updateDocumentMetadata(id, { name }, updatedAt);
    document.applyMetadata({ name }, { updatedAt });
    this.#rebuildTree();
    this.#fire('rename', [id]);
    return document;
  }

  /**
   * Change a document's language and version, and optionally its content.
   *
   * Takes the document id explicitly. The version selector previously captured
   * the active tab, awaited twice, and then wrote to `editor.getModel()` - the
   * model active at that later moment, which may be a different file entirely
   * (V-11). A command that names its target cannot drift onto another one.
   */
  async setDocumentLanguage(
    id: DocumentId,
    language: string,
    version: string,
    options: { content?: string; name?: string; isUserModified?: boolean } = {},
  ): Promise<WorkspaceDocument | null> {
    const document = this.#documents.get(id);
    if (!document) return null;

    const name =
      options.name !== undefined && options.name !== document.name
        ? uniqueName(options.name, this.#siblingFileNames(document.parentId, id))
        : undefined;

    const updatedAt = this.#now();
    const patch = {
      language,
      version,
      ...(name !== undefined ? { name } : {}),
      ...(options.isUserModified !== undefined ? { isUserModified: options.isUserModified } : {}),
    };

    await this.#store.updateDocumentMetadata(id, patch, updatedAt);
    document.applyMetadata(patch, { updatedAt });

    if (options.content !== undefined) {
      // Applied to THIS document's buffer by identity, so two rapid version
      // switches cannot write the second starter into the first file.
      document.setContent(options.content);
      await this.#persistence.flush(id);
    }

    this.#rebuildTree();
    this.#fire('language', [id]);
    return document;
  }

  async setDocumentUserModified(id: DocumentId, isUserModified: boolean): Promise<void> {
    const document = this.#documents.get(id);
    if (!document || document.metadata.isUserModified === isUserModified) return;
    const updatedAt = this.#now();
    await this.#store.updateDocumentMetadata(id, { isUserModified }, updatedAt);
    document.applyMetadata({ isUserModified }, { updatedAt });
  }

  async moveDocument(id: DocumentId, parentId: FolderId | null): Promise<WorkspaceDocument | null> {
    const document = this.#documents.get(id);
    if (!document) return null;
    if (document.parentId === parentId) return document;
    if (parentId !== null && !this.#folders.has(parentId)) return null;

    const name = uniqueName(document.name, this.#siblingFileNames(parentId, id));
    const updatedAt = this.#now();
    const patch = { parentId, order: this.#nextOrder(parentId), ...(name !== document.name ? { name } : {}) };

    await this.#store.updateDocumentMetadata(id, patch, updatedAt);
    document.applyMetadata(patch, { updatedAt });
    this.#rebuildTree();
    this.#fire('move', [id]);
    return document;
  }

  /**
   * Delete documents.
   *
   * Pending writes are cancelled first. Without that, a debounced save for a
   * deleted file lands after the delete and resurrects it - the same hazard the
   * old Clear Cache path had to special-case.
   */
  async deleteDocuments(ids: readonly DocumentId[]): Promise<void> {
    const present = ids.filter(id => this.#documents.has(id));
    if (present.length === 0) return;

    for (const id of present) {
      this.#persistence.cancel(id);
      this.#persistence.unregister(id);
    }

    await this.#store.deleteDocuments(present);

    for (const id of present) {
      this.#documents.get(id)?.dispose();
      this.#documents.delete(id);
    }

    this.#rebuildTree();
    this.#fire('delete', present);
  }

  // ===== folders =====

  async createFolder(name: string, parentId: FolderId | null = null): Promise<FolderMetadata> {
    const folder: FolderMetadata = {
      id: this.#newId('folder'),
      name: uniqueName(name, this.#siblingFolderNames(parentId)),
      parentId,
      order: this.#nextOrder(parentId),
      createdAt: this.#now(),
      updatedAt: this.#now(),
    };

    await this.#store.createFolder(folder);
    this.#folders.set(folder.id, folder);
    this.#rebuildTree();
    this.#fire('create', [folder.id]);
    return folder;
  }

  /**
   * Rename a folder.
   *
   * One name change and one write. No descendant re-pathing, because descendants
   * never stored a path - which is what removes V-15 rather than patching it.
   */
  async renameFolder(id: FolderId, requestedName: string): Promise<FolderMetadata | null> {
    const folder = this.#folders.get(id);
    if (!folder) return null;

    const trimmed = requestedName.trim();
    if (!trimmed || trimmed === folder.name) return folder;

    const name = uniqueName(trimmed, this.#siblingFolderNames(folder.parentId, id));
    const updatedAt = this.#now();

    await this.#store.updateFolderMetadata(id, { name }, updatedAt);
    const updated = { ...folder, name, updatedAt };
    this.#folders.set(id, updated);
    this.#rebuildTree();
    this.#fire('rename', [id]);
    return updated;
  }

  async moveFolder(id: FolderId, parentId: FolderId | null): Promise<FolderMetadata | null> {
    const folder = this.#folders.get(id);
    if (!folder) return null;
    if (folder.parentId === parentId) return folder;
    if (parentId !== null && !this.#folders.has(parentId)) return null;
    if (wouldCreateCycle(id, parentId, this.allFolders())) return null;

    const name = uniqueName(folder.name, this.#siblingFolderNames(parentId, id));
    const updatedAt = this.#now();
    const patch = { parentId, order: this.#nextOrder(parentId), ...(name !== folder.name ? { name } : {}) };

    await this.#store.updateFolderMetadata(id, patch, updatedAt);
    const updated = { ...folder, ...patch, updatedAt };
    this.#folders.set(id, updated);
    this.#rebuildTree();
    this.#fire('move', [id]);
    return updated;
  }

  async deleteFolders(ids: readonly FolderId[]): Promise<void> {
    const present = ids.filter(id => this.#folders.has(id));
    if (present.length === 0) return;

    const subtree = collectSubtree(present, {
      files: this.allDocuments().map(document => document.metadata),
      folders: this.allFolders(),
    });

    for (const fileId of subtree.fileIds) {
      this.#persistence.cancel(fileId);
      this.#persistence.unregister(fileId);
    }

    await this.#store.deleteFoldersRecursive([...subtree.folderIds]);

    for (const fileId of subtree.fileIds) {
      this.#documents.get(fileId)?.dispose();
      this.#documents.delete(fileId);
    }
    for (const folderId of subtree.folderIds) this.#folders.delete(folderId);

    this.#rebuildTree();
    this.#fire('delete', [...subtree.folderIds, ...subtree.fileIds]);
  }

  // ===== whole-workspace commands =====

  /**
   * Replace the workspace with a host-supplied project, atomically (V-13).
   *
   * Two properties the previous implementation did not have:
   *
   * - **Atomic.** It called `clearAll()` and then created files one at a time in
   *   separate transactions. A failure in the middle destroyed the workspace and
   *   left a fragment. Here the replacement snapshot is built and validated in
   *   memory, then committed in one store operation; a failure leaves the
   *   previous workspace fully intact.
   *
   * - **Identity-preserving.** A path that already exists keeps its document, so
   *   a host re-sending the same project does not dispose the editor model,
   *   discard undo history, or jump the user to a different tab. Content is
   *   assigned only where it actually differs.
   */
  async replaceAll(hostFiles: readonly HostFile[], options: ReplaceAllOptions): Promise<ReplaceAllResult> {
    const folders = new Map<string, FolderMetadata>();
    const foldersByPath = new Map<string, FolderMetadata>();
    const records: PersistedDocument[] = [];
    const plan: Array<{ record: PersistedDocument; content: string; reused: boolean }> = [];
    const seenPaths = new Set<string>();

    const existingByPath = new Map<string, WorkspaceDocument>();
    for (const document of this.#documents.values()) {
      const path = this.pathOf(document.id);
      if (path) existingByPath.set(path, document);
    }

    const ensureFolderChain = (segments: readonly string[]): FolderId | null => {
      let parentId: FolderId | null = null;
      let accumulated = '';
      for (const segment of segments) {
        accumulated = accumulated ? `${accumulated}/${segment}` : segment;
        let folder = foldersByPath.get(accumulated);
        if (!folder) {
          folder = {
            id: this.#newId('folder'),
            name: segment,
            parentId,
            order: foldersByPath.size,
            createdAt: this.#now(),
            updatedAt: this.#now(),
          };
          foldersByPath.set(accumulated, folder);
          folders.set(folder.id, folder);
        }
        parentId = folder.id;
      }
      return parentId;
    };

    let order = 0;
    for (const hostFile of hostFiles) {
      // The server's validator, so the IDE cannot hold a project the server will
      // refuse to run.
      const normalized = normalizeWorkspacePath(hostFile.path);
      if (!normalized.ok) {
        throw new Error(`Invalid file path from host: ${normalized.message}`);
      }
      if (seenPaths.has(normalized.path)) {
        throw new Error(`Duplicate file path from host: ${normalized.path}`);
      }
      seenPaths.add(normalized.path);

      const segments = [...normalized.segments];
      const fileName = segments.pop()!;
      const parentId = ensureFolderChain(segments);

      const { id: language, version } = options.resolve(fileName, hostFile.language);
      const existing = existingByPath.get(normalized.path);
      const content = hostFile.content ?? '';

      const record: PersistedDocument = {
        id: existing?.id ?? this.#newId('file'),
        name: fileName,
        parentId,
        language,
        version,
        order: order++,
        createdAt: existing?.metadata.createdAt ?? this.#now(),
        updatedAt: this.#now(),
        isUserModified: false,
        content,
      };

      records.push(record);
      plan.push({ record, content, reused: existing !== undefined });
    }

    const snapshot: WorkspaceSnapshot = {
      files: records,
      folders: [...folders.values()],
      state: this.#state,
    };

    // Reject a project that cannot exist on a real filesystem BEFORE touching
    // storage, so a bad payload is an error rather than a broken workspace.
    const candidateTree = buildTree({ files: records, folders: snapshot.folders });
    const collisions = findCollisions(candidateTree);
    if (!collisions.ok) {
      const [first] = collisions.conflicts;
      throw new Error(`Host project has conflicting paths: ${first.paths.join(', ')}`);
    }

    // In-flight autosaves belong to documents that may be about to disappear.
    this.#persistence.suspend();
    try {
      await this.#store.replaceAll(snapshot);
    } finally {
      this.#persistence.resume();
    }

    // Storage committed. Now reconcile memory to match it.
    const keptIds = new Set(records.map(record => record.id));
    let removed = 0;
    for (const [id, document] of [...this.#documents]) {
      if (keptIds.has(id)) continue;
      this.#persistence.unregister(id);
      document.dispose();
      this.#documents.delete(id);
      removed++;
    }

    this.#folders = folders;

    let reused = 0;
    let created = 0;
    const documents: WorkspaceDocument[] = [];
    for (const entry of plan) {
      const existing = this.#documents.get(entry.record.id);
      if (existing) {
        const { content: _content, ...metadata } = entry.record;
        existing.applyMetadata(metadata, { updatedAt: entry.record.updatedAt });
        if (existing.getContent() !== entry.content) {
          existing.setContent(entry.content);
        }
        // Storage now holds exactly this content, whether or not the buffer moved.
        existing.markSaved(existing.revision);
        documents.push(existing);
        reused++;
        continue;
      }

      const { content, ...metadata } = entry.record;
      const document = new WorkspaceDocument({ metadata, buffer: new MemoryBuffer(content) });
      this.#documents.set(document.id, document);
      this.#persistence.register(document);
      documents.push(document);
      created++;
    }

    this.#rebuildTree();
    this.#fire('replace-all', documents.map(document => document.id));
    return { documents, reused, created, removed };
  }

  /** Delete everything. Stops writers first so nothing can be resurrected. */
  async clearAll(): Promise<void> {
    this.#persistence.suspend();
    try {
      for (const id of [...this.#documents.keys()]) this.#persistence.unregister(id);
      await this.#store.clearAll();

      for (const document of this.#documents.values()) document.dispose();
      this.#documents.clear();
      this.#folders.clear();
      this.#state = { activeFileId: null, theme: this.#state.theme };
      this.#rebuildTree();
    } finally {
      this.#persistence.resume();
    }
    this.#fire('clear', []);
  }

  // ===== persistence passthrough =====

  flush(id: DocumentId): Promise<SaveOutcome> {
    return this.#persistence.flush(id);
  }

  flushAll(): Promise<SaveOutcome[]> {
    return this.#persistence.flushAll();
  }

  async setActiveDocument(id: DocumentId | null): Promise<void> {
    if (this.#state.activeFileId === id) return;
    this.#state = { ...this.#state, activeFileId: id };
    await this.#store.saveState(this.#state);
  }

  async setTheme(theme: string): Promise<void> {
    if (this.#state.theme === theme) return;
    this.#state = { ...this.#state, theme };
    await this.#store.saveState(this.#state);
  }

  // ===== internals =====

  #adopt(snapshot: WorkspaceSnapshot): void {
    for (const document of this.#documents.values()) document.dispose();
    this.#documents.clear();
    this.#folders.clear();

    for (const folder of snapshot.folders) this.#folders.set(folder.id, folder);

    for (const record of snapshot.files) {
      const { content, ...metadata } = record;
      const document = new WorkspaceDocument({ metadata, buffer: new MemoryBuffer(content) });
      this.#documents.set(document.id, document);
      this.#persistence.register(document);
    }

    this.#state = snapshot.state;
    this.#rebuildTree();
  }

  #rebuildTree(): void {
    this.#tree = buildTree({
      files: this.allDocuments().map(document => document.metadata),
      folders: this.allFolders(),
    });

    if (this.#tree.repairs.length > 0) {
      // Reported, not silently absorbed: a repaired tree means persisted data was
      // inconsistent, and that is worth knowing about.
      for (const repair of this.#tree.repairs) {
        console.warn(`[workspace] ${repair.kind}: ${repair.detail}`);
      }
    }
  }

  #siblingFileNames(parentId: FolderId | null, exceptId?: string): string[] {
    const names: string[] = [];
    for (const document of this.#documents.values()) {
      if (document.id === exceptId) continue;
      if (document.parentId === parentId) names.push(document.name);
    }
    // Folders share the namespace: a file and a folder with the same name in one
    // directory produce the file/directory conflict the server rejects.
    for (const folder of this.#folders.values()) {
      if (folder.id === exceptId) continue;
      if (folder.parentId === parentId) names.push(folder.name);
    }
    return names;
  }

  #siblingFolderNames(parentId: FolderId | null, exceptId?: string): string[] {
    return this.#siblingFileNames(parentId, exceptId);
  }

  #nextOrder(parentId: FolderId | null): number {
    let max = -1;
    for (const document of this.#documents.values()) {
      if (document.parentId === parentId) max = Math.max(max, document.metadata.order);
    }
    for (const folder of this.#folders.values()) {
      if (folder.parentId === parentId) max = Math.max(max, folder.order);
    }
    return max + 1;
  }

  #fire(reason: WorkspaceChangeReason, affected: readonly string[]): void {
    this.#onDidChangeWorkspace.fire({ reason, affected });
  }
}
