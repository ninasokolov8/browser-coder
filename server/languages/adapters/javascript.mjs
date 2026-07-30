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

import { pinModuleType, stripJobPaths } from '../adapter-kit.mjs';

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

export const javascriptAdapter = {
  id: 'javascript',

  defaultEntryName() {
    // .mjs so a single file is unambiguously an ES module, matching the previous
    // `--input-type=module` behaviour without depending on a package.json above.
    return 'main.mjs';
  },

  async prepare(ctx) {
    const { job, entryPoint } = ctx;

    // Declare the module system explicitly rather than inheriting whatever
    // package.json happens to sit above the job directory. See V-34.
    pinModuleType(job, 'module');

    return {
      kind: 'launch',
      command: ctx.config.tools.node,
      args: nodeLaunchArgs(job, job.absolute(entryPoint)),
      cwd: job.dir,
      timeoutMs: ctx.timeoutMs,
      transformStderr: text => stripJobPaths(text, job.dir),
    };
  },
};

export default javascriptAdapter;
