/**
 * The persistence port, plus an in-memory implementation for tests.
 *
 * Defining persistence as an interface is what makes the timing defects
 * testable at all. `MemoryWorkspaceStore` can be told to take 50ms on a write,
 * or to fail the third one, so a test can reproduce "the user typed while the
 * save was in flight" deterministically instead of hoping to hit it.
 *
 * The operation set is deliberately coarse. `replaceAll` exists as a single
 * method precisely because host project replacement must be atomic: the old
 * implementation cleared storage and then created files one at a time in
 * separate transactions, so an error midway left the student with a partially
 * destroyed workspace and no way back (V-13). An interface that offers only
 * `clear` and `create` cannot express the correct behaviour, so it offers this
 * instead.
 */

import type {
  DocumentId,
  DocumentMetadataPatch,
  FolderId,
  FolderMetadata,
  FolderMetadataPatch,
  PersistedDocument,
  WorkspaceState,
} from './types.ts';

export interface WorkspaceSnapshot {
  readonly files: PersistedDocument[];
  readonly folders: FolderMetadata[];
  readonly state: WorkspaceState;
}

export interface WorkspaceStore {
  open(): Promise<void>;

  loadAll(): Promise<WorkspaceSnapshot>;

  createDocument(record: PersistedDocument): Promise<void>;

  /**
   * Persist content only.
   *
   * Separate from metadata so a save cannot accidentally rewrite a name or a
   * parent that another command changed while the write was queued - and so the
   * revision guard has exactly one field to protect.
   */
  writeDocumentContent(id: DocumentId, content: string, updatedAt: number): Promise<void>;

  updateDocumentMetadata(
    id: DocumentId,
    patch: DocumentMetadataPatch,
    updatedAt: number,
  ): Promise<void>;

  deleteDocuments(ids: readonly DocumentId[]): Promise<void>;

  createFolder(record: FolderMetadata): Promise<void>;

  updateFolderMetadata(
    id: FolderId,
    patch: FolderMetadataPatch,
    updatedAt: number,
  ): Promise<void>;

  /** Deletes the folders and every document inside them, in one transaction. */
  deleteFoldersRecursive(ids: readonly FolderId[]): Promise<void>;

  /**
   * Replace the entire workspace atomically: either the new contents are all
   * present, or the previous contents are all still there.
   */
  replaceAll(snapshot: WorkspaceSnapshot): Promise<void>;

  clearAll(): Promise<void>;

  saveState(state: WorkspaceState): Promise<void>;

  close(): void;
}

/** Injectable behaviour so tests can drive the timing paths on purpose. */
export interface MemoryStoreBehaviour {
  /** Milliseconds each write waits before committing. */
  writeDelayMs?: number;
  /** Return an Error to fail that call; called with the operation name. */
  failOn?: (operation: string, callIndex: number) => Error | null;
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  #files = new Map<DocumentId, PersistedDocument>();
  #folders = new Map<FolderId, FolderMetadata>();
  #state: WorkspaceState = { activeFileId: null, theme: 'vs-dark' };
  #behaviour: MemoryStoreBehaviour;
  #callCounts = new Map<string, number>();

  /** Every operation in order, so tests can assert on write coalescing. */
  readonly operations: Array<{ operation: string; detail?: unknown }> = [];

  constructor(
    initial: Partial<WorkspaceSnapshot> = {},
    behaviour: MemoryStoreBehaviour = {},
  ) {
    for (const file of initial.files ?? []) this.#files.set(file.id, file);
    for (const folder of initial.folders ?? []) this.#folders.set(folder.id, folder);
    if (initial.state) this.#state = initial.state;
    this.#behaviour = behaviour;
  }

  async open(): Promise<void> {}

  close(): void {}

  async loadAll(): Promise<WorkspaceSnapshot> {
    await this.#gate('loadAll');
    return {
      files: [...this.#files.values()].sort((a, b) => a.order - b.order),
      folders: [...this.#folders.values()].sort((a, b) => a.order - b.order),
      state: this.#state,
    };
  }

  async createDocument(record: PersistedDocument): Promise<void> {
    await this.#gate('createDocument', record.id);
    if (this.#files.has(record.id)) {
      throw new Error(`Document ${record.id} already exists`);
    }
    this.#files.set(record.id, record);
  }

  async writeDocumentContent(
    id: DocumentId,
    content: string,
    updatedAt: number,
  ): Promise<void> {
    await this.#gate('writeDocumentContent', { id, length: content.length });
    const existing = this.#files.get(id);
    if (!existing) throw new Error(`Document ${id} does not exist`);
    this.#files.set(id, { ...existing, content, updatedAt });
  }

  async updateDocumentMetadata(
    id: DocumentId,
    patch: DocumentMetadataPatch,
    updatedAt: number,
  ): Promise<void> {
    await this.#gate('updateDocumentMetadata', { id, patch });
    const existing = this.#files.get(id);
    if (!existing) throw new Error(`Document ${id} does not exist`);
    // Spreading `patch` cannot introduce content: the type has no such field,
    // and the runtime shape is produced by the domain, never by a caller.
    this.#files.set(id, { ...existing, ...patch, updatedAt });
  }

  async deleteDocuments(ids: readonly DocumentId[]): Promise<void> {
    await this.#gate('deleteDocuments', ids);
    for (const id of ids) this.#files.delete(id);
  }

  async createFolder(record: FolderMetadata): Promise<void> {
    await this.#gate('createFolder', record.id);
    this.#folders.set(record.id, record);
  }

  async updateFolderMetadata(
    id: FolderId,
    patch: FolderMetadataPatch,
    updatedAt: number,
  ): Promise<void> {
    await this.#gate('updateFolderMetadata', { id, patch });
    const existing = this.#folders.get(id);
    if (!existing) throw new Error(`Folder ${id} does not exist`);
    this.#folders.set(id, { ...existing, ...patch, updatedAt });
  }

  async deleteFoldersRecursive(ids: readonly FolderId[]): Promise<void> {
    await this.#gate('deleteFoldersRecursive', ids);

    const doomed = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of this.#folders.values()) {
        if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }

    for (const id of doomed) this.#folders.delete(id);
    for (const [id, file] of [...this.#files]) {
      if (file.parentId && doomed.has(file.parentId)) this.#files.delete(id);
    }
  }

  async replaceAll(snapshot: WorkspaceSnapshot): Promise<void> {
    await this.#gate('replaceAll', snapshot.files.length);

    // Build first, swap second - so a failure in the middle of constructing the
    // replacement cannot be observed as a half-empty workspace.
    const files = new Map<DocumentId, PersistedDocument>();
    const folders = new Map<FolderId, FolderMetadata>();
    for (const file of snapshot.files) files.set(file.id, file);
    for (const folder of snapshot.folders) folders.set(folder.id, folder);

    this.#files = files;
    this.#folders = folders;
    this.#state = snapshot.state;
  }

  async clearAll(): Promise<void> {
    await this.#gate('clearAll');
    this.#files.clear();
    this.#folders.clear();
    this.#state = { activeFileId: null, theme: this.#state.theme };
  }

  async saveState(state: WorkspaceState): Promise<void> {
    await this.#gate('saveState', state);
    this.#state = state;
  }

  // ===== test helpers =====

  peekContent(id: DocumentId): string | undefined {
    return this.#files.get(id)?.content;
  }

  peekDocument(id: DocumentId): PersistedDocument | undefined {
    return this.#files.get(id);
  }

  countOperations(operation: string): number {
    return this.operations.filter(entry => entry.operation === operation).length;
  }

  async #gate(operation: string, detail?: unknown): Promise<void> {
    this.operations.push({ operation, detail });

    const index = this.#callCounts.get(operation) ?? 0;
    this.#callCounts.set(operation, index + 1);

    const failure = this.#behaviour.failOn?.(operation, index);
    const delay = this.#behaviour.writeDelayMs ?? 0;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    if (failure) throw failure;
  }
}
