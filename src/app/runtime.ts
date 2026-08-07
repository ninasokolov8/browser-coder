import type * as Monaco from 'monaco-editor';
import type { LoadedLanguage, VersionConfig } from '../languages';
import type { TabManager } from '../tabs';
import type { storage as storageType } from '../storage';
import type { MonacoModelRegistry, WorkspaceService } from '../workspace';
import type { CommandRegistry } from '../commands/registry.ts';
import type { DiagnosticsStore } from '../diagnostics/store.ts';

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
  /** The single enforcement point for user actions (V-17). */
  commands: CommandRegistry | null;
  /** Problems, bound to the revision they were computed for. */
  diagnostics: DiagnosticsStore | null;
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
  commands: null,
  diagnostics: null,
  fileModels: new ModelMapView(),
  currentLang: null,
  currentVersion: null,
  notifyWorkspaceChanged: () => {},
};

/*
 * The accessors. There is one of each, here, deliberately.
 *
 * features/editor-commands.ts, features/execution.ts and features/editor-context-menu.ts
 * each had a private `requireRuntime()`/`requireEditor()` doing the same job with a
 * different message, so "the IDE is not ready" failed in three different ways depending
 * on which module noticed - and any new feature had a fourth version to invent.
 *
 * The message is the one those copies used, because it is the better one: these throws
 * can reach a student through a command handler, and "Editor has not been initialized"
 * is a sentence about our object graph.
 */
const NOT_READY = 'IDE is not ready yet. Please wait for initialization to finish.';

export function requireEditor(): Monaco.editor.IStandaloneCodeEditor {
  if (!runtime.editor) throw new Error(NOT_READY);
  return runtime.editor;
}

export function requireTabManager(): TabManager {
  if (!runtime.tabManager) throw new Error(NOT_READY);
  return runtime.tabManager;
}

export function requireStorage(): StorageApi {
  if (!runtime.storage) throw new Error(NOT_READY);
  return runtime.storage;
}

export function requireWorkspace(): WorkspaceService {
  if (!runtime.workspace) throw new Error(NOT_READY);
  return runtime.workspace;
}

export function requireModels(): MonacoModelRegistry {
  if (!runtime.models) throw new Error(NOT_READY);
  return runtime.models;
}
