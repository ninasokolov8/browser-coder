/**
 * Compatibility facade over `WorkspaceService`.
 *
 * This file used to BE the storage layer: it opened IndexedDB, held a copy of
 * every file's content, and let any caller write any field of any record in any
 * order. `src/workspace/` replaces all of that. What remains here is a thin
 * adapter, so the ten modules that still call `storage.getAllFiles()` and friends
 * keep working while the truth lives in exactly one place.
 *
 * Two things make the facade worth having rather than a liability.
 *
 * **It reads through.** `getAllFiles()` returns records whose `content` is the
 * live buffer, so the several call sites that used to hunt for the freshest copy -
 *
 *     const model = runtime.fileModels.get(file.id);
 *     if (model && !model.isDisposed()) return model.getValue();
 *     const tab = tabManager.getTab(file.id);
 *     if (tab) return tab.file.content ?? file.content;
 *     return file.content;
 *
 * - now get the same answer whichever question they ask.
 *
 * **It narrows.** `updateFile` used to accept a partial record and merge it,
 * which is how a rename could carry stale content back over a live edit (V-10).
 * Here each field is routed to the specific service command that owns it, so the
 * merge that caused the defect no longer exists.
 *
 * New code should use `runtime.workspace` directly. This exists to keep the
 * migration in reviewable steps, not as a long-term API.
 */

import type { WorkspaceService } from './workspace';
import type { FolderMetadata } from './workspace';

export interface StoredFile {
  id: string;
  name: string;
  /** Canonical relative path, derived from the folder chain. No leading slash. */
  path: string;
  parentId: string | null;
  language: string;
  version: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  order: number;
  isUserModified: boolean;
}

export interface StoredFolder {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  order: number;
  isExpanded: boolean;
}

export type FileSystemItem = (StoredFile & { type: 'file' }) | (StoredFolder & { type: 'folder' });

export interface WorkspaceState {
  activeFileId: string | null;
  theme: string;
}

/*
 * There was a `dbName` module variable here, with `setDbName`/`getDbName` around it and
 * a comment explaining that this is how an embedded IDE gets an isolated database.
 *
 * Nothing wrote it and nothing read it. The isolation is real but it is done in
 * main.ts, which computes the name from `appConfig.isEmbedded` and passes it to
 * `createWorkspace` - so the comment described a switch that had no wire attached,
 * pointing the next person at the wrong file to change.
 */

let service: WorkspaceService | null = null;

/** Called once at bootstrap, before any consumer touches the facade. */
export function setWorkspaceService(next: WorkspaceService): void {
  service = next;
}

function require(): WorkspaceService {
  if (!service) throw new Error('Workspace service has not been initialized');
  return service;
}

class StorageFacade {
  async init(): Promise<void> {
    const workspace = require();
    if (!workspace.isOpen) await workspace.open();
  }

  // ===== files =====

  async getAllFiles(): Promise<StoredFile[]> {
    const workspace = require();
    return workspace
      .allDocuments()
      .map(document => toStoredFile(document.id, workspace))
      .filter((file): file is StoredFile => file !== null)
      .sort((left, right) => left.order - right.order);
  }

  async getFile(id: string): Promise<StoredFile | null> {
    return toStoredFile(id, require());
  }

  async getChildFiles(parentId: string | null): Promise<StoredFile[]> {
    const files = await this.getAllFiles();
    return files.filter(file => file.parentId === parentId);
  }

  async createFile(
    file: Omit<StoredFile, 'id' | 'createdAt' | 'updatedAt' | 'order' | 'path'>,
  ): Promise<StoredFile> {
    const workspace = require();
    const document = await workspace.createDocument({
      name: file.name,
      parentId: file.parentId,
      language: file.language,
      version: file.version,
      content: file.content,
      isUserModified: file.isUserModified,
    });
    return toStoredFile(document.id, workspace)!;
  }

  /**
   * Route each field to the command that owns it.
   *
   * Deliberately not a merge. A caller passing `{ name }` changes only the name,
   * and cannot carry a stale `content` along with it.
   */
  async updateFile(id: string, updates: Partial<StoredFile>): Promise<StoredFile | null> {
    const workspace = require();
    const document = workspace.getDocument(id);
    if (!document) return null;

    if (updates.content !== undefined && updates.content !== document.getContent()) {
      document.setContent(updates.content);
    }

    if (updates.name !== undefined && updates.name !== document.name) {
      await workspace.renameDocument(id, updates.name);
    }

    if (
      (updates.language !== undefined && updates.language !== document.language) ||
      (updates.version !== undefined && updates.version !== document.version)
    ) {
      await workspace.setDocumentLanguage(
        id,
        updates.language ?? document.language,
        updates.version ?? document.version,
      );
    }

    if (updates.parentId !== undefined && updates.parentId !== document.parentId) {
      await workspace.moveDocument(id, updates.parentId);
    }

    if (
      updates.isUserModified !== undefined &&
      updates.isUserModified !== document.metadata.isUserModified
    ) {
      await workspace.setDocumentUserModified(id, updates.isUserModified);
    }

    if (updates.content !== undefined) await workspace.flush(id);

    return toStoredFile(id, workspace);
  }

  async moveFile(id: string, newParentId: string | null): Promise<StoredFile | null> {
    const workspace = require();
    const document = await workspace.moveDocument(id, newParentId);
    return document ? toStoredFile(document.id, workspace) : null;
  }

  async deleteFile(id: string): Promise<boolean> {
    await require().deleteDocuments([id]);
    return true;
  }

  // ===== folders =====

  async createFolder(folder: { name: string; parentId: string | null }): Promise<StoredFolder> {
    const workspace = require();
    const created = await workspace.createFolder(folder.name, folder.parentId);
    return toStoredFolder(created, workspace);
  }

  async getFolder(id: string): Promise<StoredFolder | null> {
    const workspace = require();
    const folder = workspace.getFolder(id);
    return folder ? toStoredFolder(folder, workspace) : null;
  }

  async getAllFolders(): Promise<StoredFolder[]> {
    const workspace = require();
    return workspace
      .allFolders()
      .map(folder => toStoredFolder(folder, workspace))
      .sort((left, right) => left.order - right.order);
  }

  async getChildFolders(parentId: string | null): Promise<StoredFolder[]> {
    const folders = await this.getAllFolders();
    return folders.filter(folder => folder.parentId === parentId);
  }

  async updateFolder(id: string, updates: Partial<StoredFolder>): Promise<StoredFolder | null> {
    const workspace = require();
    let folder = workspace.getFolder(id);
    if (!folder) return null;

    if (updates.name !== undefined && updates.name !== folder.name) {
      folder = await workspace.renameFolder(id, updates.name);
    }
    if (folder && updates.parentId !== undefined && updates.parentId !== folder.parentId) {
      folder = await workspace.moveFolder(id, updates.parentId);
    }

    return folder ? toStoredFolder(folder, workspace) : null;
  }

  async moveFolder(id: string, newParentId: string | null): Promise<StoredFolder | null> {
    const workspace = require();
    const folder = await workspace.moveFolder(id, newParentId);
    return folder ? toStoredFolder(folder, workspace) : null;
  }

  async deleteFolder(id: string): Promise<boolean> {
    await require().deleteFolders([id]);
    return true;
  }

  // ===== workspace state =====

  // There used to be getWorkspaceState/saveWorkspaceState here, and nothing in the
  // app ever called either one - so the WorkspaceState.theme field they wrote was
  // permanently 'vs-dark' while the real theme lived in localStorage. Anyone
  // fixing a theming bug by writing to the workspace would have seen no effect at
  // all. The theme is per-browser, not per-project (a project must not carry a
  // theme into someone else's IDE), so localStorage is the right home and this
  // path is deleted rather than wired up. See src/components/settings.ts.

  async clearAll(): Promise<void> {
    await require().clearAll();
  }
}

function toStoredFile(id: string, workspace: WorkspaceService): StoredFile | null {
  const document = workspace.getDocument(id);
  if (!document) return null;
  const metadata = document.metadata;

  return {
    id: document.id,
    name: metadata.name,
    path: workspace.pathOf(document.id) ?? metadata.name,
    parentId: metadata.parentId,
    language: metadata.language,
    version: metadata.version,
    // The live buffer, not the persisted row. This is the whole point.
    content: document.getContent(),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    order: metadata.order,
    isUserModified: metadata.isUserModified,
  };
}

function toStoredFolder(folder: FolderMetadata, workspace: WorkspaceService): StoredFolder {
  return {
    id: folder.id,
    name: folder.name,
    path: workspace.pathOf(folder.id) ?? folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    order: folder.order,
    // UI-only state that the explorer keeps in its own module now.
    isExpanded: false,
  };
}

export const storage = new StorageFacade();
