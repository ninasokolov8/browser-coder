/**
 * The workspace boundary, for the language adapters that run beside a student's
 * program.
 *
 * ## Why this is shared rather than copied
 *
 * Three debug adapters translate between "the path the IDE names" and "the path on
 * disk", and every one of them has to refuse a path that leaves the job directory - a
 * value that arrived over a socket is not something to trust on someone else's word,
 * even though the server checked it first.
 *
 * A containment check duplicated per language is precisely the drift this refactor
 * exists to remove: the copies diverge, one of them gets the sibling-prefix case wrong,
 * and nothing notices because each language's tests pass.
 *
 * ## Why it is not in `server/`
 *
 * These functions are loaded by processes that supervise or contain a student's
 * program, not by the API. Importing server code into them would pull the server's
 * configuration and logging into the runtime image's language files, which are copied
 * in separately and are meant to stand alone.
 */

import path from 'node:path';

/**
 * A path from the IDE, resolved inside the workspace, or null if it escapes.
 *
 * Accepts a relative path (the normal case) or an absolute one, and answers the same
 * question either way: does this resolve to something inside the workspace?
 */
export function resolveInWorkspace(root, relative) {
  if (typeof relative !== 'string' || relative === '') return null;
  if (typeof root !== 'string' || root === '') return null;

  const workspace = path.resolve(root);
  const resolved = path.resolve(workspace, relative);
  if (!isInside(workspace, resolved)) return null;
  return resolved;
}

/**
 * An absolute path, as the workspace-relative one the IDE uses - or null when it is
 * outside the workspace entirely.
 *
 * Null is a real answer, not a failure: a frame in a standard-library file is a frame
 * in something the student did not write and cannot open, and the adapters use exactly
 * that to decide which frames to show.
 */
export function workspaceRelative(root, absolute) {
  if (!absolute || typeof absolute !== 'string') return null;
  if (typeof root !== 'string' || root === '') return null;

  const workspace = path.resolve(root);
  const resolved = path.resolve(absolute);
  if (resolved === workspace) return '';
  if (!isInside(workspace, resolved)) return null;

  return resolved.slice(withSeparator(workspace).length).split(path.sep).join('/');
}

function withSeparator(directory) {
  return directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
}

/**
 * Is `candidate` the directory itself or something under it?
 *
 * The separator is the whole point. A bare `startsWith` says `/jobs/abc-2` is inside
 * `/jobs/abc`, which is how a job reads its neighbour's files.
 */
function isInside(directory, candidate) {
  return candidate === directory || candidate.startsWith(withSeparator(directory));
}
