import { renderFileTree } from './tree';
import { setExplorerRenderer } from './operations';

let initialized = false;

/** Wire explorer collaborators after the runtime and tab manager exist. */
export function initializeExplorer(): void {
  if (initialized) return;
  initialized = true;
  setExplorerRenderer(renderFileTree);
}

export { renderFileTree };
export { setExpandedFolders } from './state';
