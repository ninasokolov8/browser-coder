/**
 * UI-only workspace visibility rules.
 *
 * Entries whose own name starts with X_HIDDEN_, or which live anywhere inside
 * an X_HIDDEN_ folder, remain fully present in storage and execution payloads.
 * They are only excluded from student-facing navigation surfaces.
 */
export const HIDDEN_WORKSPACE_PREFIX = 'X_HIDDEN_';

type WorkspaceEntryLike = {
  name?: string | null;
  path?: string | null;
};

export function hasHiddenWorkspacePrefix(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(HIDDEN_WORKSPACE_PREFIX);
}

export function isWorkspacePathHidden(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;

  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some(segment => hasHiddenWorkspacePrefix(segment));
}

export function isWorkspaceEntryHidden(entry: WorkspaceEntryLike | null | undefined): boolean {
  if (!entry) return false;

  return hasHiddenWorkspacePrefix(entry.name) || isWorkspacePathHidden(entry.path);
}
