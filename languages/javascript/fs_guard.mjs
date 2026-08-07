/**
 * Confine a debugged JavaScript program's file access to its own job directory.
 *
 * ## Why this exists at all
 *
 * A normal JavaScript run is confined by Node's permission model:
 * `--experimental-permission --allow-fs-read=<job dir>`. A debug run cannot use it.
 * Node 22 treats the inspector as a permission of its own and denies it outright -
 * both `Session.connectToMainThread()` and the `--inspect-brk` flag fail with
 * `ERR_ACCESS_DENIED, permission: 'Inspector'`, and there is no `--allow-inspector`.
 * So the choice is: no debugger, or no permission model.
 *
 * Running the debugger with no confinement was not an option. Job directories are all
 * owned by the same uid (`server/execution/job.mjs` says so explicitly and measured
 * it), so an unconfined program can read another student's source. "Run" and "debug"
 * having different security postures is exactly what the Python adapter refuses to
 * allow, for the good reason that students find out which one is looser.
 *
 * So a debug run is confined the same way Python is: at the language level, by the
 * adapter, before the program starts. `languages/python/fs_guard.py` is the model.
 *
 * ## What it is worth
 *
 * Less than the permission model, which is enforced in C++. This is a monkey-patch, and
 * a determined program can look for a path around it. It is defence in depth against a
 * student who wanders, not a boundary against an attacker - the container is that, and
 * the blueprint says the same about the permission model it replaces here.
 *
 * ## The ESM snapshot, which is the whole trick
 *
 * Node builds the ES-module facade for a builtin on its FIRST `import`, copying the
 * function values that exist at that moment. Patching after that leaves
 * `import { readFile } from 'node:fs'` holding the originals.
 *
 * This module therefore reaches `fs` through `createRequire`, never through `import`,
 * so the facade does not exist yet when the patch lands. The student's first
 * `import ... from 'node:fs'` then builds it from the patched values.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// `require`, deliberately: see the note above. An `import` here would freeze the
// originals into the ESM facade and defeat the whole guard.
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const realpath = fs.realpathSync;

/**
 * Functions whose FIRST argument is a path.
 *
 * Listed rather than discovered, so adding a wrapper is a decision. Anything not
 * listed is left alone - which is why the list includes the write side too: a
 * program that can write outside its directory can plant a file another job will read.
 */
const FIRST_ARG_PATH = [
  'access', 'appendFile', 'chmod', 'chown', 'createReadStream', 'createWriteStream',
  'lchmod', 'lchown', 'lstat', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readdir',
  'readFile', 'readlink', 'realpath', 'rm', 'rmdir', 'stat', 'statfs', 'truncate',
  'unlink', 'utimes', 'writeFile', 'cp', 'glob',
];

/** Functions whose first TWO arguments are both paths. */
const TWO_ARG_PATH = ['copyFile', 'link', 'rename', 'symlink'];

export class WorkspaceAccessError extends Error {
  constructor(target) {
    super(
      `Access to "${target}" is not allowed. A program may only read and write files `
      + 'inside its own project.',
    );
    this.name = 'WorkspaceAccessError';
    this.code = 'EACCES';
  }
}

/**
 * Resolve a path argument to a real absolute path, following symlinks as far as they
 * exist.
 *
 * Resolving is what makes the check meaningful: `../../other-job/main.py` and a symlink
 * pointing out of the directory both become the path they actually name. A path that
 * does not exist yet is checked by its nearest existing ancestor, so creating a file
 * cannot escape either.
 */
function resolveReal(target) {
  let resolved = path.resolve(target);
  for (;;) {
    try {
      return realpath(resolved);
    } catch (error) {
      if (error?.code !== 'ENOENT') return resolved;
      const parent = path.dirname(resolved);
      if (parent === resolved) return resolved;
      resolved = parent;
    }
  }
}

/**
 * Install the guard.
 *
 * @param {string} workspace absolute path of the one directory that is allowed
 */
export function installFsGuard(workspace) {
  const root = resolveReal(workspace);

  const allowed = target => {
    // A file descriptor, a Buffer or a URL-shaped value: only strings and file URLs
    // are checked, and anything else is refused rather than waved through. An
    // integer fd would let a program that already has one keep using it, which is
    // fine - it had to open it through a checked call to get it.
    if (typeof target === 'number') return true;

    let name = target;
    if (Buffer.isBuffer(name)) name = name.toString('utf8');

    // A file URL, as an object or as a string. `fileURLToPath` rather than `.pathname`:
    // on Windows the pathname of file:///C:/x is "/C:/x", which resolves to a path
    // that does not exist and is not inside anything - so the check would refuse the
    // program's own source, which is how this was first found.
    if (name instanceof URL || (typeof name === 'string' && name.startsWith('file:'))) {
      try {
        name = fileURLToPath(name);
      } catch {
        return false;
      }
    }

    if (typeof name !== 'string') return false;

    const real = resolveReal(name);
    return real === root || real.startsWith(root + path.sep);
  };

  const guardOne = (original, index) => function guarded(...args) {
    const target = args[index];
    if (!allowed(target)) throw new WorkspaceAccessError(String(target));
    return original.apply(this, args);
  };

  for (const [module, isPromise] of [[fs, false], [fsPromises, true]]) {
    for (const name of FIRST_ARG_PATH) {
      if (typeof module[name] === 'function') module[name] = guardOne(module[name], 0);
      const sync = `${name}Sync`;
      if (!isPromise && typeof module[sync] === 'function') {
        module[sync] = guardOne(module[sync], 0);
      }
    }

    for (const name of TWO_ARG_PATH) {
      if (typeof module[name] === 'function') {
        const first = guardOne(module[name], 0);
        module[name] = guardOne(first, 1);
      }
      const sync = `${name}Sync`;
      if (!isPromise && typeof module[sync] === 'function') {
        const first = guardOne(module[sync], 0);
        module[sync] = guardOne(first, 1);
      }
    }
  }

  // `fs.promises` is the same object as `node:fs/promises`, but the property is a
  // getter on some versions; assigning the patched object keeps the two in step.
  try {
    fs.promises = fsPromises;
  } catch {
    /* read-only on this version: both were patched in place anyway */
  }

  return root;
}

export default installFsGuard;
