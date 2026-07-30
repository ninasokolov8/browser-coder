import { runtime } from '../app/runtime';

export interface WorkspaceFile {
  path: string;
  content: string;
  language?: string;
}

/**
 * One deterministic snapshot of every project file, with live content.
 *
 * The previous implementation read persisted records, normalized each path, then
 * inserted into a `Map` keyed by that path - so two records that normalized to the
 * same key silently collapsed and one file vanished from the snapshot, which is
 * the payload sent to the host and to the runner (V-14). It also had to consult
 * `runtime.fileModels` per file to find content that was newer than the record.
 *
 * Both problems are gone at the source: paths are derived from the tree, which
 * rejects collisions before they can exist, and the service reads content from the
 * authoritative buffer. The map keyed by path is no longer needed to deduplicate,
 * because there is nothing to deduplicate.
 */
export async function collectWorkspaceSnapshot(): Promise<WorkspaceFile[]> {
  const workspace = runtime.workspace;
  if (!workspace) return [];

  return workspace.snapshotForExecution().map(file => ({
    path: file.path,
    content: file.content,
    language: file.language,
  }));
}
