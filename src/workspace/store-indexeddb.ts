/**
 * IndexedDB implementation of WorkspaceStore.
 *
 * Two things this file is careful about.
 *
 * **Transactions are used as transactions.** Every operation issues all of its
 * requests synchronously and then awaits the transaction, so IndexedDB's
 * auto-commit rule (a transaction commits as soon as the microtask queue drains
 * with no pending request) cannot end it early. The code this replaces awaited a
 * *separate* read in the middle of a write sequence, which is why folder renames
 * spanned two transactions and could half-apply (V-15). Here `replaceAll` is one
 * transaction, so host project replacement is genuinely atomic (V-13).
 *
 * **The legacy `path` field is written but never read.** The schema is unchanged
 * (DB_VERSION stays 2) and every record still carries the `/`-prefixed `path`
 * the previous code stored, so reverting this branch leaves a workspace the old
 * code can still open. The new code derives paths from the folder chain instead,
 * and treats the stored field as write-only compatibility baggage. Keeping it
 * correct is this adapter's private business - the domain never mentions it.
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
import type { WorkspaceSnapshot, WorkspaceStore } from './store.ts';

const DEFAULT_DB_NAME = 'BrowserCoderDB';
const DB_VERSION = 2;
const FILES_STORE = 'files';
const FOLDERS_STORE = 'folders';
const STATE_STORE = 'workspace';
const STATE_KEY = 'state';

/** A record as it sits on disk: the domain shape plus the compat path. */
interface StoredFileRecord extends PersistedDocument {
  path?: string;
}

interface StoredFolderRecord extends FolderMetadata {
  path?: string;
  isExpanded?: boolean;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Legacy path shape: leading slash, as the previous implementation wrote it. */
function legacyPath(
  name: string,
  parentId: FolderId | null,
  foldersById: Map<FolderId, StoredFolderRecord>,
): string {
  const segments: string[] = [];
  const seen = new Set<FolderId>();
  let cursor = parentId;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = foldersById.get(cursor);
    if (!folder) break;
    segments.push(folder.name);
    cursor = folder.parentId;
  }

  segments.reverse();
  return `/${[...segments, name].join('/')}`;
}

export class IndexedDbWorkspaceStore implements WorkspaceStore {
  #databaseName: string;
  #db: IDBDatabase | null = null;
  #opening: Promise<void> | null = null;

  constructor(databaseName: string = DEFAULT_DB_NAME) {
    this.#databaseName = databaseName;
  }

  get databaseName(): string {
    return this.#databaseName;
  }

  open(): Promise<void> {
    if (this.#db) return Promise.resolve();
    if (this.#opening) return this.#opening;

    this.#opening = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.#databaseName, DB_VERSION);

      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));

      request.onsuccess = () => {
        this.#db = request.result;
        // A second tab upgrading the schema would otherwise leave this connection
        // holding a version that can no longer be written.
        this.#db.onversionchange = () => this.close();
        resolve();
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(FILES_STORE)) {
          const files = db.createObjectStore(FILES_STORE, { keyPath: 'id' });
          files.createIndex('name', 'name', { unique: false });
          files.createIndex('path', 'path', { unique: false });
          files.createIndex('parentId', 'parentId', { unique: false });
          files.createIndex('language', 'language', { unique: false });
          files.createIndex('order', 'order', { unique: false });
        }

        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          const folders = db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
          folders.createIndex('name', 'name', { unique: false });
          folders.createIndex('path', 'path', { unique: false });
          folders.createIndex('parentId', 'parentId', { unique: false });
          folders.createIndex('order', 'order', { unique: false });
        }

        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'key' });
        }
      };
    }).finally(() => {
      this.#opening = null;
    });

    return this.#opening;
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }

  async loadAll(): Promise<WorkspaceSnapshot> {
    const db = await this.#require();
    const transaction = db.transaction([FILES_STORE, FOLDERS_STORE, STATE_STORE], 'readonly');

    const filesRequest = promisify<StoredFileRecord[]>(
      transaction.objectStore(FILES_STORE).getAll(),
    );
    const foldersRequest = promisify<StoredFolderRecord[]>(
      transaction.objectStore(FOLDERS_STORE).getAll(),
    );
    const stateRequest = promisify<{ key: string; value: WorkspaceState } | undefined>(
      transaction.objectStore(STATE_STORE).get(STATE_KEY),
    );

    const [files, folders, stateRow] = await Promise.all([
      filesRequest,
      foldersRequest,
      stateRequest,
    ]);

    return {
      // Sorted by `order` so the explorer and tab restore are deterministic.
      files: files
        .map(record => this.#toDocument(record))
        .sort((a, b) => a.order - b.order),
      folders: folders
        .map(record => this.#toFolder(record))
        .sort((a, b) => a.order - b.order),
      state: stateRow?.value ?? { activeFileId: null, theme: 'vs-dark' },
    };
  }

  async createDocument(record: PersistedDocument): Promise<void> {
    const db = await this.#require();

    // Folders are read first, in their own transaction, because the compat path
    // needs the chain. Doing it inside the write transaction would risk the
    // auto-commit rule; doing it before costs one extra read and is safe.
    const foldersById = await this.#loadFolderIndex(db);

    const transaction = db.transaction(FILES_STORE, 'readwrite');
    transaction.objectStore(FILES_STORE).add({
      ...record,
      path: legacyPath(record.name, record.parentId, foldersById),
    } satisfies StoredFileRecord);

    await transactionDone(transaction);
  }

  async writeDocumentContent(id: DocumentId, content: string, updatedAt: number): Promise<void> {
    const db = await this.#require();
    const transaction = db.transaction(FILES_STORE, 'readwrite');
    const store = transaction.objectStore(FILES_STORE);

    const existing = await promisify<StoredFileRecord | undefined>(store.get(id));
    if (!existing) {
      // The document was deleted while this write was queued. Recreating it here
      // is exactly the resurrection bug the old debounced save could cause, so
      // the write is dropped instead.
      transaction.abort();
      return;
    }

    store.put({ ...existing, content, updatedAt });
    await transactionDone(transaction);
  }

  async updateDocumentMetadata(
    id: DocumentId,
    patch: DocumentMetadataPatch,
    updatedAt: number,
  ): Promise<void> {
    const db = await this.#require();
    const foldersById = await this.#loadFolderIndex(db);

    const transaction = db.transaction(FILES_STORE, 'readwrite');
    const store = transaction.objectStore(FILES_STORE);

    const existing = await promisify<StoredFileRecord | undefined>(store.get(id));
    if (!existing) {
      transaction.abort();
      return;
    }

    const updated: StoredFileRecord = { ...existing, ...patch, updatedAt };
    updated.path = legacyPath(updated.name, updated.parentId, foldersById);
    store.put(updated);

    await transactionDone(transaction);
  }

  async deleteDocuments(ids: readonly DocumentId[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.#require();
    const transaction = db.transaction(FILES_STORE, 'readwrite');
    const store = transaction.objectStore(FILES_STORE);
    for (const id of ids) store.delete(id);
    await transactionDone(transaction);
  }

  async createFolder(record: FolderMetadata): Promise<void> {
    const db = await this.#require();
    const foldersById = await this.#loadFolderIndex(db);

    const transaction = db.transaction(FOLDERS_STORE, 'readwrite');
    transaction.objectStore(FOLDERS_STORE).add({
      ...record,
      path: legacyPath(record.name, record.parentId, foldersById),
      isExpanded: false,
    } satisfies StoredFolderRecord);

    await transactionDone(transaction);
  }

  /**
   * Rename or move a folder, and refresh every descendant's compat path, in ONE
   * transaction.
   *
   * The domain does not need the descendant writes at all - it derives paths. They
   * exist so a rollback to the previous implementation still finds correct paths.
   * Doing them in the same transaction as the folder change is what makes this
   * safe: the previous code committed the descendants first and the folder second,
   * so an interruption left children re-pathed under a parent that had not moved
   * (V-15).
   */
  async updateFolderMetadata(
    id: FolderId,
    patch: FolderMetadataPatch,
    updatedAt: number,
  ): Promise<void> {
    const db = await this.#require();
    const transaction = db.transaction([FOLDERS_STORE, FILES_STORE], 'readwrite');
    const folderStore = transaction.objectStore(FOLDERS_STORE);
    const fileStore = transaction.objectStore(FILES_STORE);

    const [folders, files] = await Promise.all([
      promisify<StoredFolderRecord[]>(folderStore.getAll()),
      promisify<StoredFileRecord[]>(fileStore.getAll()),
    ]);

    const existing = folders.find(folder => folder.id === id);
    if (!existing) {
      transaction.abort();
      return;
    }

    const foldersById = new Map<FolderId, StoredFolderRecord>();
    for (const folder of folders) foldersById.set(folder.id, folder);

    const updated: StoredFolderRecord = { ...existing, ...patch, updatedAt };
    foldersById.set(id, updated);

    // Recompute from the mutated index, so descendants pick up the new chain.
    for (const folder of foldersById.values()) {
      const path = legacyPath(folder.name, folder.parentId, foldersById);
      if (folder.path === path && folder.id !== id) continue;
      folderStore.put({ ...folder, path });
    }

    for (const file of files) {
      const path = legacyPath(file.name, file.parentId, foldersById);
      if (file.path === path) continue;
      fileStore.put({ ...file, path });
    }

    await transactionDone(transaction);
  }

  async deleteFoldersRecursive(ids: readonly FolderId[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.#require();
    const transaction = db.transaction([FOLDERS_STORE, FILES_STORE], 'readwrite');
    const folderStore = transaction.objectStore(FOLDERS_STORE);
    const fileStore = transaction.objectStore(FILES_STORE);

    const [folders, files] = await Promise.all([
      promisify<StoredFolderRecord[]>(folderStore.getAll()),
      promisify<StoredFileRecord[]>(fileStore.getAll()),
    ]);

    const doomed = new Set<FolderId>(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }

    for (const folderId of doomed) folderStore.delete(folderId);
    for (const file of files) {
      if (file.parentId && doomed.has(file.parentId)) fileStore.delete(file.id);
    }

    await transactionDone(transaction);
  }

  /** One transaction: either the whole new workspace lands, or none of it does. */
  async replaceAll(snapshot: WorkspaceSnapshot): Promise<void> {
    const db = await this.#require();
    const transaction = db.transaction([FILES_STORE, FOLDERS_STORE, STATE_STORE], 'readwrite');
    const fileStore = transaction.objectStore(FILES_STORE);
    const folderStore = transaction.objectStore(FOLDERS_STORE);
    const stateStore = transaction.objectStore(STATE_STORE);

    fileStore.clear();
    folderStore.clear();

    const foldersById = new Map<FolderId, StoredFolderRecord>();
    for (const folder of snapshot.folders) foldersById.set(folder.id, folder);

    for (const folder of snapshot.folders) {
      folderStore.put({
        ...folder,
        path: legacyPath(folder.name, folder.parentId, foldersById),
        isExpanded: false,
      } satisfies StoredFolderRecord);
    }

    for (const file of snapshot.files) {
      fileStore.put({
        ...file,
        path: legacyPath(file.name, file.parentId, foldersById),
      } satisfies StoredFileRecord);
    }

    stateStore.put({ key: STATE_KEY, value: snapshot.state });

    await transactionDone(transaction);
  }

  async clearAll(): Promise<void> {
    const db = await this.#require();
    const transaction = db.transaction([FILES_STORE, FOLDERS_STORE, STATE_STORE], 'readwrite');
    transaction.objectStore(FILES_STORE).clear();
    transaction.objectStore(FOLDERS_STORE).clear();
    transaction.objectStore(STATE_STORE).clear();
    await transactionDone(transaction);
  }

  async saveState(state: WorkspaceState): Promise<void> {
    const db = await this.#require();
    const transaction = db.transaction(STATE_STORE, 'readwrite');
    transaction.objectStore(STATE_STORE).put({ key: STATE_KEY, value: state });
    await transactionDone(transaction);
  }

  // ===== internals =====

  async #require(): Promise<IDBDatabase> {
    await this.open();
    if (!this.#db) throw new Error('IndexedDB is not available');
    return this.#db;
  }

  async #loadFolderIndex(db: IDBDatabase): Promise<Map<FolderId, StoredFolderRecord>> {
    const transaction = db.transaction(FOLDERS_STORE, 'readonly');
    const folders = await promisify<StoredFolderRecord[]>(
      transaction.objectStore(FOLDERS_STORE).getAll(),
    );
    const byId = new Map<FolderId, StoredFolderRecord>();
    for (const folder of folders) byId.set(folder.id, folder);
    return byId;
  }

  /**
   * Read a persisted record into the domain shape.
   *
   * `path` is dropped on the way in - deliberately. A record whose stored path
   * disagrees with its parent chain is not a conflict to resolve, because the
   * chain is the truth and the path is a copy.
   */
  #toDocument(record: StoredFileRecord): PersistedDocument {
    return {
      id: record.id,
      name: record.name,
      parentId: record.parentId ?? null,
      language: record.language,
      version: record.version,
      order: typeof record.order === 'number' ? record.order : 0,
      createdAt: record.createdAt ?? 0,
      updatedAt: record.updatedAt ?? 0,
      isUserModified: record.isUserModified === true,
      content: typeof record.content === 'string' ? record.content : '',
    };
  }

  #toFolder(record: StoredFolderRecord): FolderMetadata {
    return {
      id: record.id,
      name: record.name,
      parentId: record.parentId ?? null,
      order: typeof record.order === 'number' ? record.order : 0,
      createdAt: record.createdAt ?? 0,
      updatedAt: record.updatedAt ?? 0,
    };
  }
}
