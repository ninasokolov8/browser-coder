import type * as Monaco from 'monaco-editor';
import type { LoadedLanguage, VersionConfig } from '../languages';
import type { TabManager } from '../tabs';
import type { storage as storageType } from '../storage';
import type { MonacoModelRegistry, WorkspaceService } from '../workspace';

export type StorageApi = typeof storageType;

/**
 * Map-shaped read view over the model registry.
 *
 * Several modules capture `runtime.fileModels` at import time, so the object
 * identity has to stay stable. Rather than keep a second map in sync with the
 * registry - a mirror is just another copy that can disagree - this delegates
 * every lookup. There is deliberately no `set`: models are created by the
 * registry, which is the only thing that knows the right URI for a path.
 */
class ModelMapView {
  get(id: string): Monaco.editor.ITextModel | undefined {
    return runtime.models?.peek(id) ?? undefined;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  delete(id: string): boolean {
    const existed = this.has(id);
    runtime.models?.release(id);
    return existed;
  }

  entries(): IterableIterator<[string, Monaco.editor.ITextModel]> {
    const pairs: Array<[string, Monaco.editor.ITextModel]> =
      runtime.models?.all().map(entry => [entry.id, entry.model]) ?? [];
    return pairs[Symbol.iterator]();
  }

  keys(): IterableIterator<string> {
    return (runtime.models?.all().map(entry => entry.id) ?? [])[Symbol.iterator]();
  }

  [Symbol.iterator](): IterableIterator<[string, Monaco.editor.ITextModel]> {
    return this.entries();
  }
}

export const runtime: {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  tabManager: TabManager | null;
  storage: StorageApi | null;
  /** The single owner of workspace state. Prefer this over `storage`. */
  workspace: WorkspaceService | null;
  models: MonacoModelRegistry | null;
  fileModels: ModelMapView;
  currentLang: LoadedLanguage | null;
  currentVersion: VersionConfig | null;
  notifyWorkspaceChanged: () => void;
} = {
  editor: null,
  tabManager: null,
  storage: null,
  workspace: null,
  models: null,
  fileModels: new ModelMapView(),
  currentLang: null,
  currentVersion: null,
  notifyWorkspaceChanged: () => {},
};

export function requireEditor(): Monaco.editor.IStandaloneCodeEditor {
  if (!runtime.editor) throw new Error('Editor has not been initialized');
  return runtime.editor;
}

export function requireTabManager(): TabManager {
  if (!runtime.tabManager) throw new Error('Tab manager has not been initialized');
  return runtime.tabManager;
}

export function requireStorage(): StorageApi {
  if (!runtime.storage) throw new Error('Storage has not been initialized');
  return runtime.storage;
}

export function requireWorkspace(): WorkspaceService {
  if (!runtime.workspace) throw new Error('Workspace has not been initialized');
  return runtime.workspace;
}

export function requireModels(): MonacoModelRegistry {
  if (!runtime.models) throw new Error('Model registry has not been initialized');
  return runtime.models;
}
