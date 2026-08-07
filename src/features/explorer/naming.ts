/**
 * Naming rules for files entering the workspace.
 *
 * Pure and free of Monaco, the DOM and storage, so node can test it directly - the
 * same split as `format-core`/`formatting` and `hover-content`/`hover-help`. Both
 * functions here were previously inline in `operations.ts`, where nothing could reach
 * them, and one of them was quietly destroying every non-English file name.
 */

import { normalizeWorkspacePath } from '../../../server/domain/paths.mjs';

/**
 * A file name from the student's computer, made safe for the workspace.
 *
 * The rule is the workspace's own (`server/domain/paths.mjs`), not an ASCII allowlist.
 * The previous `[^A-Za-z0-9._-] -> _` turned `תמונה.png` into `_____.png`, losing the
 * name of every file a Hebrew-speaking student imported - in a product that ships a
 * Hebrew UI, Hebrew keyword help, and a unit test asserting `סקריפט.py` is a valid
 * workspace path.
 *
 * Only what genuinely cannot be stored is changed: path separators (an import is one
 * flat name, never a path) and control characters.
 */
export function importSafeName(rawName: string): string {
  // Written as a code-point filter rather than a character class holding literal
  // control characters: that class is invisible in a diff and does not survive being
  // moved through a shell.
  const flattened = Array.from(rawName)
    .map(character => (character === '/' || character === '\\' ? '_' : character))
    .filter(character => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');

  // Windows strips a trailing dot or space silently, so two distinct names would
  // land on one file.
  const trimmed = flattened.slice(0, 120).replace(/[. ]+$/, '');
  const candidate = trimmed.length > 0 ? trimmed : 'imported-file';

  if (normalizeWorkspacePath(candidate).ok) return candidate;

  // What is left is a reserved device name (`con.txt`, `NUL`) or a name reserved for
  // internal use. Prefixing keeps the original readable instead of mangling it.
  const prefixed = `file_${candidate}`;
  return normalizeWorkspacePath(prefixed).ok ? prefixed : 'imported-file';
}

/** Make a file name unique within a set of existing sibling names. */
export function uniqueFileName(name: string, existing: string[]): string {
  const set = new Set(existing);
  if (!set.has(name)) return name;

  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  let counter = 1;
  let candidate = `${base}_${counter}${extension}`;
  while (set.has(candidate)) {
    counter++;
    candidate = `${base}_${counter}${extension}`;
  }
  return candidate;
}
