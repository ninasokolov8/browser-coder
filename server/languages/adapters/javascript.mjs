/**
 * JavaScript adapter.
 *
 * The filesystem grant is the interesting part. The pre-refactor single-file path
 * ran with `--allow-fs-read=<shared temp root>`, which granted read access to
 * every other concurrent job's source (V-24). It is now scoped to this job's own
 * directory, so a program can read its own project files - which it legitimately
 * needs for imports - and nothing else.
 *
 * Note on what that grant is worth: Node's permission model is explicitly NOT a
 * security boundary against malicious code
 * (https://nodejs.org/api/permissions.html). Narrowing it removes an accidental
 * cross-job read; real containment is the sandbox's job. It is defence in depth,
 * not the defence.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnostics, pinModuleType, stripJobPaths } from '../adapter-kit.mjs';
import { runToCompletion } from '../../execution/process-runner.mjs';
import { DEBUG_PROGRAM_ENV } from '../../debug/channel.mjs';
// The same variable Python's guard reads. One name for "the directory a program may
// touch", so the two languages cannot describe confinement differently.
import { WORKSPACE_ENV } from './python.mjs';

/** Where the debug adapter lives in the image, next to the language's other files. */
export const JS_ADAPTER_DIR = path.join(
  fileURLToPath(new URL('../../../languages/javascript/', import.meta.url)),
);

/**
 * Shared launch arguments for running JavaScript under Node.
 * Exported so the TypeScript adapter runs its emitted output identically rather
 * than maintaining a second copy of the flags - the drift between those copies
 * is exactly what this refactor exists to remove.
 */
export function nodeLaunchArgs(job, entryAbsolute) {
  return [
    // Suppress the ExperimentalWarning the permission model emits, which would
    // otherwise appear in every student's stderr.
    '--no-warnings',
    '--experimental-permission',
    // Scoped to THIS job only. Previously the whole shared temp root.
    `--allow-fs-read=${job.dir}`,
    '--max-old-space-size=128',
    entryAbsolute,
  ];
}

/**
 * The same launch, with the debugger in front of the program.
 *
 * ## Why the permission model is absent here
 *
 * Not an oversight, and not a relaxation anyone chose. Node 22 treats the inspector as
 * a permission of its own and denies it whenever the permission model is on - both
 * `Session.connectToMainThread()` and `--inspect-brk` fail with
 * `ERR_ACCESS_DENIED, permission: 'Inspector'` - and there is no `--allow-inspector`.
 * Measured on node v22.18.0, not assumed. So a debug run can have the permission model
 * or a debugger, never both.
 *
 * The filesystem confinement that `--allow-fs-read` provided is therefore replaced,
 * not dropped: `languages/javascript/fs_guard.mjs` confines the program to its job
 * directory from inside, which is exactly how Python has always done it
 * (`fs_guard.py`). A debug run must not be looser than a normal one, or students find
 * out which one is.
 *
 * The program is NOT passed as an argument. The adapter imports it after breakpoints
 * are armed, which is the only ordering that lets a breakpoint on line 1 be hit.
 */
export function nodeDebugLaunchArgs(adapterDir) {
  return [
    '--no-warnings',
    '--max-old-space-size=128',
    path.join(adapterDir, 'debug_adapter.mjs'),
  ];
}

export const javascriptAdapter = {
  id: 'javascript',

  defaultEntryName() {
    // .mjs so a single file is unambiguously an ES module, matching the previous
    // `--input-type=module` behaviour without depending on a package.json above.
    return 'main.mjs';
  },

  /**
   * JavaScript can be debugged.
   *
   * Through V8's own inspector, attached from a worker thread inside the same process
   * the pipeline already spawned - see languages/javascript/debug_adapter.mjs for why
   * that rather than `--inspect-brk` and a supervising process.
   */
  supportsDebug: true,

  async prepare(ctx) {
    const { job, entryPoint } = ctx;

    // Declare the module system explicitly rather than inheriting whatever
    // package.json happens to sit above the job directory. See V-34.
    pinModuleType(job, 'module');

    const entryAbsolute = job.absolute(entryPoint);
    const debugging = ctx.debug?.enabled === true;

    /*
     * Parse before running, the way every other language here does.
     *
     * Node compiles lazily, so a syntax error used to arrive as a RUNTIME crash after
     * the process had started - reported under `phase: 'run'` with a stack trace,
     * rather than as the compile error it is. Every other adapter answers a broken
     * file with `kind: 'diagnostics'`, and JavaScript was the one that did not.
     *
     * `node --check` parses and exits without executing a line, which is both the
     * honest answer for a run and the entire basis of the live check for this
     * language - without it, /api/check could only ever say "looks fine".
     *
     * Only the entry file: --check takes one file, and an import that fails to parse
     * surfaces when that module is the one being edited, which is when the student
     * cares.
     */
    const parse = await runToCompletion({
      command: ctx.config.tools.node,
      args: ['--check', entryAbsolute],
      cwd: job.dir,
      env: ctx.sandboxEnv,
      timeoutMs: 8000,
      maxOutputChars: 100000,
    });

    if (!parse.termination.succeeded) {
      const text = [parse.stderr, parse.stdout].filter(Boolean).join('\n');
      return diagnostics(stripJobPaths(text, job.dir) || 'SyntaxError', parse.durationMs);
    }

    return {
      kind: 'launch',
      command: ctx.config.tools.node,
      args: debugging
        ? nodeDebugLaunchArgs(JS_ADAPTER_DIR)
        : nodeLaunchArgs(job, entryAbsolute),
      cwd: job.dir,
      timeoutMs: ctx.timeoutMs,
      extraEnv: debugging
        ? {
            [DEBUG_PROGRAM_ENV]: entryAbsolute,
            // The one directory the guard allows. Same variable name Python's guard
            // reads, so the two languages describe confinement identically.
            [WORKSPACE_ENV]: path.resolve(job.dir),
          }
        : undefined,
      transformStderr: text => stripJobPaths(text, job.dir),
    };
  },
};
