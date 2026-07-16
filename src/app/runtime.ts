import type * as Monaco from 'monaco-editor';
import type { LoadedLanguage, VersionConfig } from '../languages';
import type { TabManager } from '../tabs';
import type { storage as storageType } from '../storage';

export type StorageApi = typeof storageType;

export const runtime: {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  tabManager: TabManager | null;
  storage: StorageApi | null;
  fileModels: Map<string, Monaco.editor.ITextModel>;
  currentLang: LoadedLanguage | null;
  currentVersion: VersionConfig | null;
  modelCounter: number;
  notifyWorkspaceChanged: () => void;
} = {
  editor: null,
  tabManager: null,
  storage: null,
  fileModels: new Map(),
  currentLang: null,
  currentVersion: null,
  modelCounter: 0,
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
