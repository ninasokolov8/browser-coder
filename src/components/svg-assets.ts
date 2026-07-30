/**
 * Workspace image assets (SVG).
 *
 * SVG files are XML text, so they are stored by the normal text-file storage
 * layer and can be imported by other workspace files. HTML/CSS previews get
 * them straight from the published preview project; programs that name an
 * image at runtime (Python turtle's `bgpic("maze.svg")`) are resolved here,
 * in the browser, and handed to the renderer as a data URL.
 */

import { collectWorkspaceSnapshot } from '../features/workspace';
import { normalizeProjectPath } from './project-path';

/** Turn SVG source text into a data URL usable by <img> and canvas drawImage. */
export function svgToDataUrl(source: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
}

/** Resolve a relative reference (may contain "./" and "../") against a directory. */
function resolveRelative(fromPath: string, reference: string): string {
  const base = reference.startsWith('/')
    ? []
    : normalizeProjectPath(fromPath).split('/').filter(Boolean).slice(0, -1);

  for (const part of reference.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }

  return base.join('/');
}

/**
 * Find an image a program asked for and return it as a data URL, or null when
 * the workspace has no such file.
 *
 * Lookup order follows how students actually write paths: relative to the file
 * that asked for it, then from the project root, then by bare file name
 * anywhere in the project (so `bgpic("maze.svg")` finds `images/maze.svg`).
 *
 * Only SVG is supported: workspace files are stored as text, so bitmap formats
 * (.gif/.png/.jpg) cannot live in a project.
 */
export async function resolveWorkspaceImageUrl(
  reference: string,
  fromPath = '',
): Promise<string | null> {
  const ref = String(reference || '').replace(/[?#].*$/, '').trim();
  if (!ref || !/\.svg$/i.test(ref)) return null;

  const files = await collectWorkspaceSnapshot();
  const byPath = new Map(files.map(file => [normalizeProjectPath(file.path), file]));

  for (const candidate of [resolveRelative(fromPath, ref), normalizeProjectPath(ref)]) {
    const hit = candidate ? byPath.get(candidate) : undefined;
    if (hit) return svgToDataUrl(hit.content);
  }

  const bareName = ref.split('/').pop()!.toLowerCase();
  const hit = files.find(
    file => (normalizeProjectPath(file.path).split('/').pop() || '').toLowerCase() === bareName,
  );

  return hit ? svgToDataUrl(hit.content) : null;
}
