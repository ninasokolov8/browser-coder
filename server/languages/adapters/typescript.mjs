/**
 * TypeScript adapter.
 *
 * Three defects converge here.
 *
 * V-32 - the selected version was ignored. Every profile compiled with
 *   `strict: false` and `target: ES2022`, so `ts5-strict`, `ts5`, `ts-es2020` and
 *   `ts-es2015` were four labels for one behaviour. They now read `strict` and
 *   `monacoTarget` from the profile, which makes the selection real.
 *
 * V-34 - emitted CommonJS was interpreted as ESM. Multi-file runs transpiled to
 *   sibling `.js` files, and Node resolved their module type by walking up to
 *   `/app/package.json`, which declares `"type": "module"`. `require` and
 *   `exports` then failed. Development never reproduced it because the temp
 *   directory sat outside the package. Fixed by pinning the boundary explicitly.
 *
 * "transpileModule is not a semantic typecheck" (section 6.3) - it never was, so
 *   `ts5-strict` could not report a single type error from the server. A real
 *   Program is now built for the whole project, which is what makes strict mode
 *   mean something and is what the "compilation and syntax checks" requirement
 *   actually asks for.
 *
 * Server-side strictness matches what the editor already enforces: Monaco is
 * configured from the same `strict` flag and already blocks a run on error-level
 * markers, so this makes the two agree rather than adding a new restriction.
 */

import path from 'node:path';

import { log } from '../../logging.mjs';
import { diagnostics, pinModuleType, stripJobPaths } from '../adapter-kit.mjs';
import { JS_ADAPTER_DIR, nodeDebugLaunchArgs, nodeLaunchArgs } from './javascript.mjs';
import { WORKSPACE_ENV } from './python.mjs';
import { DEBUG_PROGRAM_ENV } from '../../debug/channel.mjs';

let compiler = null;
let loadAttempted = false;

/**
 * Load the TypeScript compiler lazily.
 *
 * Absence is degraded but not fatal: plain-JS-shaped TypeScript still runs, and
 * Monaco's client-side service still reports errors. Returning null rather than
 * throwing keeps a missing optional dependency from taking the language offline.
 */
async function getCompiler() {
  if (loadAttempted) return compiler;
  loadAttempted = true;
  try {
    const module = await import('typescript');
    compiler = module.default || module;
    log('info', 'ts_compiler_loaded', { version: compiler.version });
  } catch (error) {
    log('warn', 'ts_compiler_unavailable', { error: error.message });
  }
  return compiler;
}

/** Map a profile target string onto a real ScriptTarget. */
function scriptTarget(ts, target) {
  const table = {
    ES5: ts.ScriptTarget.ES5,
    ES2015: ts.ScriptTarget.ES2015,
    ES2016: ts.ScriptTarget.ES2016,
    ES2017: ts.ScriptTarget.ES2017,
    ES2018: ts.ScriptTarget.ES2018,
    ES2019: ts.ScriptTarget.ES2019,
    ES2020: ts.ScriptTarget.ES2020,
    ES2021: ts.ScriptTarget.ES2021,
    ES2022: ts.ScriptTarget.ES2022,
    ESNext: ts.ScriptTarget.ESNext,
  };
  return table[target] ?? ts.ScriptTarget.ES2022;
}

/**
 * The lib set matching a target, so the target restricts the available API too -
 * `Array.prototype.flat` genuinely does not exist under ES2015.
 *
 * DOM is included alongside the ES lib for one specific reason: it is where
 * `console`, `setTimeout` and friends are declared. Without it every program
 * fails with "Cannot find name 'console'", which is a diagnostic about our
 * configuration masquerading as an error in the student's code.
 *
 * DOM rather than @types/node is deliberate: it is what Monaco is configured
 * with (`lib: ["ES2020", "DOM", "DOM.Iterable"]`), so the editor and the server
 * agree on which globals exist. Two different answers to "does console exist" is
 * worse than either answer.
 */
function libsFor(target) {
  const esLib = {
    ES5: 'lib.es5.d.ts',
    ES2015: 'lib.es2015.d.ts',
    ES2016: 'lib.es2016.d.ts',
    ES2017: 'lib.es2017.d.ts',
    ES2018: 'lib.es2018.d.ts',
    ES2019: 'lib.es2019.d.ts',
    ES2020: 'lib.es2020.d.ts',
    ES2021: 'lib.es2021.d.ts',
    ES2022: 'lib.es2022.d.ts',
  }[target] || 'lib.es2022.d.ts';

  return [esLib, 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'];
}

/** Format one diagnostic as `file:line:col - error TSxxxx: message`. */
function formatDiagnostic(ts, diagnostic, jobDir) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const severity = diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning';

  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const relative = stripJobPaths(diagnostic.file.fileName, jobDir) || diagnostic.file.fileName;
    return `${relative}:${line + 1}:${character + 1} - ${severity} TS${diagnostic.code}: ${message}`;
  }
  return `${severity} TS${diagnostic.code}: ${message}`;
}

export const typescriptAdapter = {
  id: 'typescript',

  defaultEntryName() {
    return 'main.ts';
  },

  /**
   * TypeScript can be debugged, through the JavaScript debugger and a source map.
   *
   * It was excluded before for a good reason: it is compiled before it runs, so a
   * breakpoint on a .ts line would have armed against the emitted .js and stopped
   * somewhere else. The map is what removes that objection.
   */
  supportsDebug: true,

  async prepare(ctx) {
    const { job, files, entryPoint, profile } = ctx;
    const startedAt = Date.now();
    const ts = await getCompiler();
    const debugging = ctx.debug?.enabled === true;

    const tsFiles = files.filter(file => file.name.toLowerCase().endsWith('.ts'));
    const isSingleFile = tsFiles.length === 1;

    if (!ts) {
      // Degraded path: run the entry file as-is. Real TypeScript syntax will fail
      // at runtime, which is honest - we cannot compile it.
      pinModuleType(job, 'module');
      return {
        kind: 'launch',
        command: ctx.config.tools.node,
        args: nodeLaunchArgs(job, job.absolute(entryPoint)),
        cwd: job.dir,
        timeoutMs: ctx.timeoutMs,
        transformStderr: text => stripJobPaths(text, job.dir),
      };
    }

    const target = profile.target || 'ES2022';

    // Single file has no relative imports, so ESM is safe and preserves
    // top-level await. A project needs CommonJS, because TypeScript leaves
    // extensionless import specifiers alone and ESM Node requires them - so
    // `import { x } from './helper'` only resolves under CommonJS.
    const useCommonJs = !isSingleFile;

    const compilerOptions = {
      target: scriptTarget(ts, target),
      lib: libsFor(target),
      module: useCommonJs ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      // Real, from the profile. Previously hardcoded false for every version.
      strict: profile.strict,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
      skipLibCheck: true,
      noEmitOnError: false,
      // Emitted only for a DEBUG run. A source map is what lets a breakpoint on a
      // .ts line be armed against the .js line it became, and a stop reported back in
      // the file the student wrote - without one, TypeScript can be run but not
      // debugged, which is why it was excluded from the debuggable set. An ordinary
      // run does not pay for the extra files.
      sourceMap: debugging,
      removeComments: false,
      // Emit next to the source so relative imports keep resolving.
      outDir: undefined,
    };

    const rootNames = tsFiles.map(file => job.absolute(file.name));

    // A real Program, not transpileModule: this is what produces genuine type
    // errors and makes `strict` meaningful.
    let program;
    try {
      program = ts.createProgram(rootNames, compilerOptions);
    } catch (error) {
      return diagnostics(`TypeScript compilation failed: ${error.message}`, Date.now() - startedAt);
    }

    const emitResult = program.emit();

    // Deliberately excludes global/options diagnostics: those describe our
    // configuration, not the student's code, and must not be shown as their error.
    const allDiagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)
      .filter(diagnostic => diagnostic.file !== undefined);

    const errors = allDiagnostics.filter(
      diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
    );

    if (errors.length > 0) {
      const formatted = errors
        .slice(0, 100)
        .map(diagnostic => formatDiagnostic(ts, diagnostic, job.dir))
        .join('\n');
      const overflow =
        errors.length > 100 ? `\n... and ${errors.length - 100} more errors` : '';
      return diagnostics(formatted + overflow, Date.now() - startedAt);
    }

    // Emitted output is CommonJS for a project, so the boundary must say so.
    pinModuleType(job, useCommonJs ? 'commonjs' : 'module');

    const emittedEntry = job.absolute(entryPoint.replace(/\.ts$/i, '.js'));
    const entryToRun = job.exists(entryPoint.replace(/\.ts$/i, '.js'))
      ? emittedEntry
      : job.absolute(entryPoint);

    /*
     * A debug run goes through the JavaScript debug adapter, against the EMITTED file.
     *
     * There is no TypeScript debugger here and there does not need to be one: the
     * program that actually runs is JavaScript, and the source map emitted above is
     * what turns a `.ts` breakpoint into a `.js` one and a `.js` stop back into a `.ts`
     * line. The adapter knows about maps, not about TypeScript.
     */
    if (debugging) {
      return {
        kind: 'launch',
        command: ctx.config.tools.node,
        args: nodeDebugLaunchArgs(JS_ADAPTER_DIR),
        cwd: job.dir,
        timeoutMs: ctx.timeoutMs,
        extraEnv: {
          [DEBUG_PROGRAM_ENV]: entryToRun,
          [WORKSPACE_ENV]: path.resolve(job.dir),
        },
        transformStderr: text => stripJobPaths(text, job.dir),
      };
    }

    return {
      kind: 'launch',
      command: ctx.config.tools.node,
      args: nodeLaunchArgs(job, entryToRun),
      cwd: job.dir,
      timeoutMs: ctx.timeoutMs,
      transformStderr: text =>
        // Map emitted .js frames back to the .ts the student wrote. Without a
        // source map this is a name substitution, not a position fix, but it
        // keeps the file name recognisable.
        stripJobPaths(text, job.dir).replace(
          new RegExp(`${path.basename(entryPoint, '.ts')}\\.js`, 'g'),
          path.basename(entryPoint),
        ),
    };
  },
};
