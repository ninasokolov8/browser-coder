/**
 * Workspace composition root.
 *
 * The one place that knows how the pieces fit together, so the rest of the app
 * asks for a workspace rather than assembling a store, a coordinator and a model
 * registry in the right order itself.
 */

import { IndexedDbWorkspaceStore } from './store-indexeddb.ts';
import { WorkspaceService } from './service.ts';
import { MonacoModelRegistry } from './monaco/model-registry.ts';
import type { LanguageLookup } from './monaco/model-registry.ts';

export { WorkspaceDocument } from './document.ts';
export { WorkspaceService } from './service.ts';
export { IndexedDbWorkspaceStore } from './store-indexeddb.ts';
export { MonacoModelRegistry } from './monaco/model-registry.ts';
export type {
  FolderMetadata,
} from './types.ts';

export interface Workspace {
  readonly service: WorkspaceService;
  readonly models: MonacoModelRegistry;
  readonly store: IndexedDbWorkspaceStore;
}

export interface CreateWorkspaceOptions {
  databaseName?: string;
  languages: LanguageLookup;
  autoSaveDelayMs?: number;
}

export function createWorkspace(options: CreateWorkspaceOptions): Workspace {
  const store = new IndexedDbWorkspaceStore(options.databaseName);
  const service = new WorkspaceService({
    store,
    autoSaveDelayMs: options.autoSaveDelayMs,
  });
  const models = new MonacoModelRegistry(service, options.languages);
  return { service, models, store };
}
