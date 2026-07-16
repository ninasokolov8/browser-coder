import { runtime } from '../app/runtime';
import { normalizeProjectPath } from '../components/project-path';

export interface WorkspaceFile {
  path: string;
  content: string;
  language?: string;
}

/** Collect one deterministic, current snapshot of every persisted project file. */
export async function collectWorkspaceSnapshot(): Promise<WorkspaceFile[]> {
  const storage = runtime.storage;
  if (!storage) return [];

  const storedFiles = await storage.getAllFiles();
  const byPath = new Map<string, WorkspaceFile>();

  for (const file of storedFiles) {
    const normalizedPath = normalizeProjectPath(file.path || file.name);
    if (!normalizedPath) continue;

    const liveModel = runtime.fileModels.get(file.id);
    byPath.set(normalizedPath, {
      path: normalizedPath,
      content: liveModel?.getValue() ?? file.content ?? '',
      language: file.language,
    });
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
