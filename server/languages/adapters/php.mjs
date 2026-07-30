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

import { runToCompletion } from '../../execution/process-runner.mjs';
import { diagnostics, stripJobPaths } from '../adapter-kit.mjs';

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
      // php -l writes its diagnosis to stdout, not stderr.
      const raw = (lint.stdout || lint.stderr || '').trim();
      const cleaned = stripJobPaths(raw, job.dir)
        .replace(/\nErrors parsing[^\n]*$/m, '')
        .trim();
      return diagnostics(cleaned || raw, lint.durationMs);
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
