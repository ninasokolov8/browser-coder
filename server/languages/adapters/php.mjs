/**
 * PHP adapter.
 *
 * `open_basedir` is now the job directory rather than the shared temp root, which
 * is the PHP half of V-24 - previously a program could read every other
 * concurrent job's source.
 *
 * The disable_functions list is deliberately identical between the lint step and
 * the run step. In the pre-refactor code the buffered and interactive paths
 * carried DIFFERENT lists (the interactive one was much shorter), so the same
 * program was subject to different restrictions depending on how it was launched.
 * Having one adapter makes that class of drift impossible.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runToCompletion } from '../../execution/process-runner.mjs';
import { diagnostics, stripJobPaths } from '../adapter-kit.mjs';
import { DEBUG_PROGRAM_ENV } from '../../debug/channel.mjs';
// The same variable Python's guard reads. One name for "the directory a program may
// touch", so the languages cannot describe confinement differently.
import { WORKSPACE_ENV } from './python.mjs';

/** Where the DBGp debug adapter lives in the image, next to the language's other files. */
export const PHP_ADAPTER_DIR = fileURLToPath(new URL('../../../languages/php/', import.meta.url));

/** Environment the debug adapter reads to know what to launch and how. */
export const PHP_BIN_ENV = 'BROWSER_CODER_PHP_BIN';
/** The interpreter flags a normal run would have used, as a JSON array. */
export const PHP_ARGS_ENV = 'BROWSER_CODER_PHP_ARGS';

/**
 * Functions disabled at the interpreter level.
 *
 * Belt and braces alongside the pattern corpus: the corpus can be evaded by
 * dynamic dispatch, whereas `disable_functions` is enforced by the engine.
 * Neither is containment - that is the sandbox's job - but this one cannot be
 * talked out of by clever source.
 */
const DISABLED_FUNCTIONS = [
  'exec', 'passthru', 'shell_exec', 'system', 'proc_open', 'popen',
  'pcntl_exec', 'pcntl_fork', 'curl_exec', 'curl_multi_exec',
  'fsockopen', 'pfsockopen', 'stream_socket_client', 'mail', 'dl',
  'putenv', 'getenv', 'phpinfo', 'eval', 'assert', 'create_function',
  'file_get_contents', 'file_put_contents', 'fopen', 'fwrite', 'readfile',
  'unlink', 'rmdir', 'mkdir', 'chmod', 'chown',
].join(',');

function baseArgs(jobDir) {
  return [
    '-d', `open_basedir=${jobDir}`,
    '-d', 'memory_limit=64M',
    '-d', `disable_functions=${DISABLED_FUNCTIONS}`,
    '-d', 'allow_url_fopen=Off',
    '-d', 'allow_url_include=Off',
  ];
}

export const phpAdapter = {
  id: 'php',

  defaultEntryName() {
    return 'main.php';
  },

  /**
   * PHP needs an opening tag to execute rather than echo its own source.
   * Applied at write time so the file on disk is what actually runs.
   */
  normalizeSingleFile(code) {
    return code.trimStart().startsWith('<?php') ? code : `<?php\n${code}`;
  },

  /**
   * PHP can be debugged.
   *
   * Through Xdebug, over DBGp, spoken by a client written for this project - see
   * languages/php/dbgp.mjs. The one structural oddity is that Xdebug DIALS OUT: the
   * debugger listens and the program connects to it, which is why the debug launch
   * starts a supervising Node process rather than the interpreter.
   */
  supportsDebug: true,

  async prepare(ctx) {
    const { job, entryPoint } = ctx;
    const entryAbsolute = job.absolute(entryPoint);

    // php -l first: a parse error must be reported as a compile failure, not as a
    // program that started and then died.
    const lint = await runToCompletion({
      command: ctx.config.tools.php,
      args: ['-d', `open_basedir=${job.dir}`, '-l', entryAbsolute],
      cwd: job.dir,
      env: ctx.sandboxEnv,
      timeoutMs: 10000,
      maxOutputChars: ctx.config.execution.maxOutputChars,
    });

    if (!lint.termination.succeeded) {
      // BOTH streams, because php -l splits its answer across them:
      //
      //   stderr: PHP Parse error:  syntax error, unexpected token "echo", …
      //           in /job/main.php on line 3
      //   stdout: Errors parsing /job/main.php
      //
      // The previous `lint.stdout || lint.stderr` took stdout because it was
      // non-empty, and then stripped the "Errors parsing" line as noise - leaving
      // NOTHING. Every PHP syntax error reported as the bare string
      // "Errors parsing main.php": no message, no line number, nothing to act on.
      const combined = [lint.stderr, lint.stdout]
        .map(part => (part || '').trim())
        .filter(Boolean)
        .join('\n');

      const cleaned = stripJobPaths(combined, job.dir)
        // Now safe to drop: it is a summary of the real message above it, and it
        // is only removed when something else survives.
        .replace(/^Errors parsing[^\n]*$/gm, '')
        .trim();

      return diagnostics(cleaned || combined, lint.durationMs);
    }

    /*
     * A debug run launches Node, not PHP.
     *
     * Xdebug connects OUT to a listening debugger, so something has to be listening
     * before the interpreter starts. The adapter binds a port, passes it to PHP, and
     * supervises the result. It is handed the same interpreter flags a normal run
     * would have used, so `open_basedir` and `disable_functions` are identical under
     * the debugger - a debug run must not be looser than an ordinary one, or students
     * find out which one is.
     */
    if (ctx.debug?.enabled === true) {
      return {
        kind: 'launch',
        command: ctx.config.tools.node,
        args: ['--no-warnings', path.join(PHP_ADAPTER_DIR, 'debug_adapter.mjs')],
        cwd: job.dir,
        timeoutMs: ctx.timeoutMs,
        extraEnv: {
          [DEBUG_PROGRAM_ENV]: entryAbsolute,
          [WORKSPACE_ENV]: path.resolve(job.dir),
          [PHP_BIN_ENV]: ctx.config.tools.php,
          [PHP_ARGS_ENV]: JSON.stringify(baseArgs(job.dir)),
        },
        transformStderr: text => stripJobPaths(text, job.dir),
      };
    }

    return {
      kind: 'launch',
      command: ctx.config.tools.php,
      args: [
        ...baseArgs(job.dir),
        // Deliberately NO max_execution_time: an interactive program legitimately
        // blocks on input, and PHP's own timer cannot tell waiting from looping.
        // The session idle and lifetime timers are the guard, and they can.
        entryAbsolute,
      ],
      cwd: job.dir,
      timeoutMs: ctx.timeoutMs,
      transformStderr: text => stripJobPaths(text, job.dir),
    };
  },
};

export default phpAdapter;
