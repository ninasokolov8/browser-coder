/**
 * The language adapter contract, plus helpers every adapter needs.
 *
 * This is what replaces the `switch (language)` statements. Before this there
 * were SIX switches and, more importantly, FOUR implementations of every
 * language: single-file buffered, multi-file buffered, single-file interactive,
 * multi-file interactive. They drifted - PHP, C#, TypeScript and Python each
 * passed different flags depending on which of the four a request happened to
 * take, which is why "interactive Python behaves differently from buffered
 * Python" was a real class of bug rather than a coincidence.
 *
 * Two decisions collapse that matrix:
 *
 *  1. A single-file run IS a one-file project. The pipeline always hands an
 *     adapter a file set and an entry point, so there is no single/multi split.
 *  2. Transport is not the adapter's business. An adapter returns how to START a
 *     process; whether the caller buffers the output or streams it is the
 *     caller's concern. So there is no buffered/interactive split either.
 *
 * 6 languages x 4 implementations becomes 6 adapters, and "the same program
 * behaves the same however it was launched" becomes structural.
 *
 * @typedef {object} PrepareContext
 * @property {import('../execution/job.mjs').Job} job    private directory, files already written
 * @property {{name: string, content: string, isMain: boolean}[]} files
 * @property {string} entryPoint                          validated relative path
 * @property {import('./catalog.mjs').VersionProfile} profile
 * @property {object} config                              CONFIG
 * @property {{path: string, env: Record<string,string>}|null} graphics
 *
 * @typedef {{kind: 'diagnostics', stderr: string, phase: 'compile', durationMs: number}
 *          |{kind: 'launch', command: string, args: string[], cwd: string,
 *            timeoutMs: number, extraEnv?: Record<string,string>,
 *            transformStderr?: (text: string) => string}} PreparedRun
 *
 * @typedef {object} LanguageAdapter
 * @property {string} id
 * @property {(code: string, profile: object) => string} defaultEntryName
 * @property {(ctx: PrepareContext) => Promise<PreparedRun>} prepare
 */

import fs from 'node:fs';
import path from 'node:path';

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite absolute job paths out of compiler and runtime output.
 *
 * Users must never see `/app/sandbox/job-run-abc123/main.py`; they see `main.py`.
 * This is presentation, but it is also information hygiene - the internal layout
 * of the execution sandbox is not something a program's error message should
 * disclose.
 */
export function stripJobPaths(text, jobDir) {
  if (!text || !jobDir) return text || '';
  const variants = new Set([jobDir, jobDir.replace(/\\/g, '/')]);
  let out = text;
  for (const variant of variants) {
    const withSeparator = variant.endsWith(path.sep) || variant.endsWith('/')
      ? variant
      : `${variant}${variant.includes('\\') ? '\\' : '/'}`;
    out = out
      .replace(new RegExp(escapeRegExp(withSeparator), 'g'), '')
      .replace(new RegExp(escapeRegExp(variant), 'g'), '');
  }
  return out;
}

/**
 * Pin the module system for a job directory.
 *
 * Fixes V-34. Node resolves the module type of a `.js` file by walking UP the
 * directory tree for the nearest `package.json`. Job directories live under
 * TMPDIR, which in production is `/app/sandbox` - so the walk reached
 * `/app/package.json`, which declares `"type": "module"`, and Node interpreted
 * emitted CommonJS as ESM and failed on `require`/`exports`. Development never
 * reproduced it because the temp directory sat outside the package.
 *
 * Writing an explicit boundary means the adapter states its intent instead of
 * inheriting whatever happens to be above it.
 */
export function pinModuleType(job, type) {
  fs.writeFileSync(
    path.join(job.dir, 'package.json'),
    `${JSON.stringify({ name: 'browser-coder-job', private: true, type }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

/** A diagnostics result: the program was not run. */
export function diagnostics(stderr, durationMs = 0) {
  return { kind: 'diagnostics', stderr, phase: 'compile', durationMs };
}

/** Files in the set whose name ends with one of the given extensions. */
export function filesWithExtension(files, ...extensions) {
  return files.filter(file => extensions.some(ext => file.name.toLowerCase().endsWith(ext)));
}
