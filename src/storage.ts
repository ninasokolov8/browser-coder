/**
 * IndexedDB-based storage for IDE files and folders
 * Provides persistent storage for user's files across sessions
 */

export interface StoredFile {
  id: string;           // Unique file ID
  name: string;         // Display name (e.g., "main.js", "utils.py")
  path: string;         // Full path (e.g., "/src/main.js")
  parentId: string | null; // Parent folder ID, null for root
  language: string;     // Language ID (javascript, python, etc.)
  version: string;      // Language version ID
  content: string;      // File content
  createdAt: number;    // Timestamp
  updatedAt: number;    // Last modified timestamp
  order: number;        // Display order within parent
  isUserModified: boolean; // True if user has ever edited (not just default starter)
}

export interface StoredFolder {
  id: string;           // Unique folder ID
  name: string;         // Display name
  path: string;         // Full path (e.g., "/src")
  parentId: string | null; // Parent folder ID, null for root
  createdAt: number;
  updatedAt: number;
  order: number;        // Display order within parent
  isExpanded: boolean;  // UI state
}

export type FileSystemItem = (StoredFile & { type: 'file' }) | (StoredFolder & { type: 'folder' });

export interface WorkspaceState {
  activeFileId: string | null;
  theme: string;
}

const DB_NAME = 'BrowserCoderDB';
const DB_VERSION = 2; // Bump version for new folders store
const FILES_STORE = 'files';
const FOLDERS_STORE = 'folders';
const STATE_STORE = 'workspace';

class StorageManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IndexedDB connection
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Files store with indexes
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          const filesStore = db.createObjectStore(FILES_STORE, { keyPath: 'id' });
          filesStore.createIndex('name', 'name', { unique: false });
          filesStore.createIndex('path', 'path', { unique: false });
          filesStore.createIndex('parentId', 'parentId', { unique: false });
          filesStore.createIndex('language', 'language', { unique: false });
          filesStore.createIndex('order', 'order', { unique: false });
        }

        // Folders store
        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          const foldersStore = db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
          foldersStore.createIndex('name', 'name', { unique: false });
          foldersStore.createIndex('path', 'path', { unique: false });
          foldersStore.createIndex('parentId', 'parentId', { unique: false });
          foldersStore.createIndex('order', 'order', { unique: false });
        }

        // Workspace state store
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE, { keyPath: 'key' });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Ensure DB is ready before operations
   */
  private async ensureReady(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  // ========== Folder Operations ==========

  /**
   * Create a new folder
   */
  async createFolder(folder: { name: string; parentId: string | null }): Promise<StoredFolder> {
    const db = await this.ensureReady();
    
    // Build path
    let parentPath = '';
    if (folder.parentId) {
      const parent = await this.getFolder(folder.parentId);
      if (parent) parentPath = parent.path;
    }
    
    // Get next order number within parent
    const siblings = await this.getChildFolders(folder.parentId);
    const maxOrder = siblings.reduce((max, f) => Math.max(max, f.order), -1);

    const newFolder: StoredFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: folder.name,
      path: `${parentPath}/${folder.name}`,
      parentId: folder.parentId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: maxOrder + 1,
      isExpanded: true,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE);
      const request = store.add(newFolder);

      request.onsuccess = () => resolve(newFolder);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a folder by ID
   */
  async getFolder(id: string): Promise<StoredFolder | null> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readonly');
      const store = tx.objectStore(FOLDERS_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all folders
   */
  async getAllFolders(): Promise<StoredFolder[]> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readonly');
      const store = tx.objectStore(FOLDERS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const folders = request.result || [];
        folders.sort((a, b) => a.order - b.order);
        resolve(folders);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get child folders of a parent
   */
  async getChildFolders(parentId: string | null): Promise<StoredFolder[]> {
    const all = await this.getAllFolders();
    return all.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order);
  }

  /**
   * Update a folder
   */
  async updateFolder(id: string, updates: Partial<Omit<StoredFolder, 'id' | 'createdAt'>>): Promise<StoredFolder | null> {
    const db = await this.ensureReady();
    const existing = await this.getFolder(id);
    if (!existing) return null;

    // If name changed, update path and all children paths
    let newPath = existing.path;
    if (updates.name && updates.name !== existing.name) {
      const parentPath = existing.path.substring(0, existing.path.lastIndexOf('/'));
      newPath = `${parentPath}/${updates.name}`;
      
      // Update all descendant paths
      await this.updateDescendantPaths(existing.path, newPath);
    }

    const updated: StoredFolder = {
      ...existing,
      ...updates,
      path: newPath,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE);
      const request = store.put(updated);

      request.onsuccess = () => resolve(updated);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update paths of all descendants when parent folder renamed
   */
  private async updateDescendantPaths(oldPath: string, newPath: string): Promise<void> {
    const db = await this.ensureReady();
    
    // Update folders
    const allFolders = await this.getAllFolders();
    const allFiles = await this.getAllFiles();
    
    const tx = db.transaction([FOLDERS_STORE, FILES_STORE], 'readwrite');
    const folderStore = tx.objectStore(FOLDERS_STORE);
    const fileStore = tx.objectStore(FILES_STORE);

    for (const folder of allFolders) {
      if (folder.path.startsWith(oldPath + '/')) {
        folder.path = newPath + folder.path.substring(oldPath.length);
        folder.updatedAt = Date.now();
        folderStore.put(folder);
      }
    }

    for (const file of allFiles) {
      if (file.path.startsWith(oldPath + '/')) {
        file.path = newPath + file.path.substring(oldPath.length);
        file.updatedAt = Date.now();
        fileStore.put(file);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Delete a folder and all its contents recursively
   */
  async deleteFolder(id: string): Promise<boolean> {
    const db = await this.ensureReady();
    const folder = await this.getFolder(id);
    if (!folder) return false;

    // Get all descendants
    const allFolders = await this.getAllFolders();
    const allFiles = await this.getAllFiles();
    
    const folderIdsToDelete = new Set<string>([id]);
    const fileIdsToDelete = new Set<string>();

    // Find all descendant folders
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of allFolders) {
        if (f.parentId && folderIdsToDelete.has(f.parentId) && !folderIdsToDelete.has(f.id)) {
          folderIdsToDelete.add(f.id);
          changed = true;
        }
      }
    }

    // Find all files in these folders
    for (const file of allFiles) {
      if (file.parentId && folderIdsToDelete.has(file.parentId)) {
        fileIdsToDelete.add(file.id);
      }
    }

    const tx = db.transaction([FOLDERS_STORE, FILES_STORE], 'readwrite');
    const folderStore = tx.objectStore(FOLDERS_STORE);
    const fileStore = tx.objectStore(FILES_STORE);

    for (const folderId of folderIdsToDelete) {
      folderStore.delete(folderId);
    }
    for (const fileId of fileIdsToDelete) {
      fileStore.delete(fileId);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ========== File Operations ==========

  /**
   * Create a new file
   */
  async createFile(file: Omit<StoredFile, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'path'>): Promise<StoredFile> {
    const db = await this.ensureReady();
    
    // Build path
    let parentPath = '';
    if (file.parentId) {
      const parent = await this.getFolder(file.parentId);
      if (parent) parentPath = parent.path;
    }

    // Get next order number within parent
    const siblings = await this.getChildFiles(file.parentId);
    const maxOrder = siblings.reduce((max, f) => Math.max(max, f.order), -1);

    const newFile: StoredFile = {
      ...file,
      id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      path: `${parentPath}/${file.name}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: maxOrder + 1,
      isUserModified: file.isUserModified ?? false,
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const request = store.add(newFile);

      request.onsuccess = () => resolve(newFile);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get child files of a parent folder
   */
  async getChildFiles(parentId: string | null): Promise<StoredFile[]> {
    const all = await this.getAllFiles();
    return all.filter(f => f.parentId === parentId).sort((a, b) => a.order - b.order);
  }

  /**
   * Get a file by ID
   */
  async getFile(id: string): Promise<StoredFile | null> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readonly');
      const store = tx.objectStore(FILES_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all files, sorted by order
   */
  async getAllFiles(): Promise<StoredFile[]> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readonly');
      const store = tx.objectStore(FILES_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result || [];
        files.sort((a, b) => a.order - b.order);
        resolve(files);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a file (content, name, etc.)
   */
  async updateFile(id: string, updates: Partial<Omit<StoredFile, 'id' | 'createdAt'>>): Promise<StoredFile | null> {
    const db = await this.ensureReady();
    const existing = await this.getFile(id);
    if (!existing) return null;

    // If name changed, update path
    let newPath = existing.path;
    if (updates.name && updates.name !== existing.name) {
      const parentPath = existing.path.substring(0, existing.path.lastIndexOf('/'));
      newPath = `${parentPath}/${updates.name}`;
    }

    const updated: StoredFile = {
      ...existing,
      ...updates,
      path: updates.path ?? newPath,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const request = store.put(updated);

      request.onsuccess = () => resolve(updated);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a file
   */
  async deleteFile(id: string): Promise<boolean> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get file system tree structure
   */
  async getFileSystemTree(): Promise<FileSystemItem[]> {
    const folders = await this.getAllFolders();
    const files = await this.getAllFiles();
    
    const items: FileSystemItem[] = [
      ...folders.map(f => ({ ...f, type: 'folder' as const })),
      ...files.map(f => ({ ...f, type: 'file' as const })),
    ];
    
    return items;
  }

  // ========== Workspace State ==========

  /**
   * Get workspace state
   */
  async getWorkspaceState(): Promise<WorkspaceState> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STATE_STORE, 'readonly');
      const store = tx.objectStore(STATE_STORE);
      const request = store.get('state');

      request.onsuccess = () => {
        const result = request.result;
        resolve(result?.value || { activeFileId: null, theme: 'vs-dark' });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save workspace state
   */
  async saveWorkspaceState(state: WorkspaceState): Promise<void> {
    const db = await this.ensureReady();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STATE_STORE, 'readwrite');
      const store = tx.objectStore(STATE_STORE);
      const request = store.put({ key: 'state', value: state });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ========== Utilities ==========

  /**
   * Clear all data (for debugging/reset)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureReady();

    const tx = db.transaction([FILES_STORE, FOLDERS_STORE, STATE_STORE], 'readwrite');
    tx.objectStore(FILES_STORE).clear();
    tx.objectStore(FOLDERS_STORE).clear();
    tx.objectStore(STATE_STORE).clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Export all files as JSON (for backup)
   */
  async exportAll(): Promise<{ files: StoredFile[]; state: WorkspaceState }> {
    const files = await this.getAllFiles();
    const state = await this.getWorkspaceState();
    return { files, state };
  }

  /**
   * Import files from JSON backup
   */
  async importAll(data: { files: StoredFile[]; state: WorkspaceState }): Promise<void> {
    const db = await this.ensureReady();

    const tx = db.transaction([FILES_STORE, STATE_STORE], 'readwrite');
    const filesStore = tx.objectStore(FILES_STORE);
    const stateStore = tx.objectStore(STATE_STORE);

    // Clear existing
    filesStore.clear();
    stateStore.clear();

    // Import files
    for (const file of data.files) {
      filesStore.add(file);
    }

    // Import state
    stateStore.put({ key: 'state', value: data.state });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Singleton export
export const storage = new StorageManager();
