/**
 * Python adapter.
 *
 * Consolidates `executePython`, `executePythonMulti`, and the two interactive
 * Python paths into one implementation, so a program cannot behave differently
 * depending on how it was launched.
 *
 * Also the adapter where the turtle graphics channel is wired: the shim is
 * prepended to the entry file and told, via the environment, which
 * service-chosen file to write to. See server/graphics/turtle.mjs for why that
 * direction of information flow is the whole fix for V-01.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runToCompletion } from '../../execution/process-runner.mjs';
import { GRAPHICS_OUT_ENV, usesTurtle } from '../../graphics/turtle.mjs';
import { log } from '../../logging.mjs';
import SECURITY from '../../security/patterns.mjs';
import { diagnostics, stripJobPaths } from '../adapter-kit.mjs';

const LANGUAGES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'languages',
);

const SHIM_PATH = path.join(LANGUAGES_ROOT, 'python', 'turtle_shim.py');
const PREFLIGHT_PATH = path.join(LANGUAGES_ROOT, 'python', 'preflight.py');

/** Separator between the shim and user code. Line count must stay in sync. */
const USER_CODE_SEPARATOR = '\n\n# ── user code ──\n';

let shimSource = null;
function turtleShim() {
  if (shimSource !== null) return shimSource;
  try {
    shimSource = fs.readFileSync(SHIM_PATH, 'utf8');
  } catch (error) {
    log('warn', 'turtle_shim_unavailable', { error: error.message });
    shimSource = '';
  }
  return shimSource;
}

/**
 * Lines the shim occupies before the user's first line.
 *
 * A traceback reports positions in the combined file, so this offset is what
 * turns "line 769" back into the line the student actually wrote.
 */
function shimLineOffset() {
  const shim = turtleShim();
  if (!shim) return 0;
  const prefix = shim + USER_CODE_SEPARATOR;
  let count = 0;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] === '\n') count++;
  return count;
}

/**
 * Rewrite a traceback so line numbers match the editor when the shim was
 * prepended.
 *
 * User-code frames shift back by the offset. Shim-internal frames are dropped
 * along with their indented source snippet and caret line, because they are
 * implementation detail the student never wrote and would only confuse. Frames
 * for other files are already correct and are left alone.
 */
export function adjustTracebackForShim(text, offset, fileMatch) {
  if (!text || !offset) return text || '';
  const lines = text.split('\n');
  const out = [];
  // Tolerates a trailing \r so CRLF and LF both parse.
  const frameRe = /^(\s*File\s+")([^"]*)("\s*,\s+line\s+)(\d+)(.*?)\r?$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(frameRe);
    if (!match) {
      out.push(lines[i]);
      continue;
    }

    const filePath = match[2];
    const lineNumber = Number.parseInt(match[4], 10);
    if (fileMatch && !filePath.includes(fileMatch)) {
      out.push(lines[i]);
      continue;
    }

    if (lineNumber > offset) {
      out.push(match[1] + match[2] + match[3] + (lineNumber - offset) + match[5]);
    } else {
      // Drop the frame and every indented continuation line beneath it.
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (frameRe.test(next) || !/^\s{2,}\S/.test(next)) break;
        i++;
      }
    }
  }

  return out.join('\n');
}

/** Format preflight problems as a Python-style error block. */
function formatProblems(problems, filename) {
  return problems
    .map(problem => {
      const lines = [`  File "${filename}", line ${problem.line}`];
      if (problem.text) {
        lines.push(`    ${problem.text.replace(/\s+$/, '')}`);
        const caretColumn = Math.max(1, Number(problem.col) || 1);
        lines.push(`${' '.repeat(4 + caretColumn - 1)}^`);
      }
      lines.push(problem.msg);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Static pre-run check: refuse to start a program with a syntax error or an
 * undefined name, so nothing runs half-way and then dies on a broken line.
 *
 * Fail-open by design. A checker that is missing, slow or confused must never be
 * the reason valid code is refused, so every failure path returns null and the
 * program runs normally.
 */
async function preflight(ctx, source, displayName) {
  if (!fs.existsSync(PREFLIGHT_PATH)) return null;

  const probeFile = ctx.job.absolute('.preflight-input.py');
  try {
    fs.writeFileSync(probeFile, source, { encoding: 'utf8', mode: 0o600 });

    const result = await runToCompletion({
      command: ctx.config.tools.python,
      args: ['-I', '-S', '-B', PREFLIGHT_PATH, probeFile],
      cwd: ctx.job.dir,
      env: ctx.sandboxEnv,
      timeoutMs: 8000,
      maxOutputChars: 200000,
    });

    if (!result.stdout) return null;

    let problems;
    try {
      problems = JSON.parse(result.stdout.trim());
    } catch {
      return null;
    }
    if (!Array.isArray(problems) || problems.length === 0) return null;

    // A security refusal is not a compile error; it reuses the request-level
    // wording and the `blocked` flag so the two paths are indistinguishable to
    // a caller.
    const securityProblems = problems.filter(problem => problem.kind === 'security');
    if (securityProblems.length > 0) {
      return {
        ...diagnostics(
          `${SECURITY.messages.python}\n\n${formatProblems(securityProblems, displayName)}`,
          result.durationMs,
        ),
        blocked: true,
      };
    }

    return diagnostics(formatProblems(problems, displayName), result.durationMs);
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(probeFile);
    } catch {
      /* nothing to clean */
    }
  }
}

export const pythonAdapter = {
  id: 'python',

  defaultEntryName() {
    return 'main.py';
  },

  async prepare(ctx) {
    const { job, files, entryPoint } = ctx;
    const entryAbsolute = job.absolute(entryPoint);
    const displayName = path.basename(entryPoint);

    if (!job.exists(entryPoint)) {
      throw new Error(`Python entry point was not written: ${entryPoint}`);
    }

    // Runs against the student's original source, before any shim injection, so
    // reported positions are theirs.
    const problems = await preflight(ctx, job.readFile(entryPoint), displayName);
    if (problems) return problems;

    // Prepend the shim when ANY file in the project imports turtle - a helper
    // module may be the one drawing.
    let shimInjected = false;
    const anyTurtle = files.some(file => file.name.endsWith('.py') && usesTurtle(file.content));
    if (anyTurtle && turtleShim()) {
      job.writeFile(entryPoint, turtleShim() + USER_CODE_SEPARATOR + job.readFile(entryPoint));
      shimInjected = true;
    }

    // Make every workspace folder importable, so moving a file into a folder does
    // not break an existing bare import. Entry directory and project root first,
    // then every nested directory in deterministic order, which supports both
    // `from helper import x` and `from pkg.helper import x`.
    const importDirs = Array.from(
      new Set([
        path.dirname(entryAbsolute),
        path.resolve(job.dir),
        ...job.directories().sort((a, b) => a.localeCompare(b)),
      ]),
    );

    const bootstrap = [
      'import runpy, sys',
      `sys.path[:0] = ${JSON.stringify(importDirs)}`,
      `runpy.run_path(${JSON.stringify(entryAbsolute)}, run_name="__main__")`,
    ].join('\n');

    const offset = shimLineOffset();

    return {
      kind: 'launch',
      command: ctx.config.tools.python,
      // -u unbuffered so a prompt with no trailing newline reaches the user
      // immediately; -I isolated; -S no site; -B no .pyc beside the source.
      args: ['-u', '-I', '-S', '-B', '-c', bootstrap],
      cwd: job.dir,
      timeoutMs: ctx.timeoutMs,
      extraEnv: ctx.graphics ? { [GRAPHICS_OUT_ENV]: ctx.graphics.path } : undefined,
      transformStderr: text => {
        let out = stripJobPaths(text, job.dir);
        if (shimInjected) out = adjustTracebackForShim(out, offset, displayName);
        return out;
      },
    };
  },
};

export default pythonAdapter;
