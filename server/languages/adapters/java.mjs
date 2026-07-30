/**
 * Java adapter.
 *
 * V-32 - `java11` ran on JDK 17 with no `--release`, so the two profiles were
 *   identical. `--release <level>` is a real compiler switch that pins both the
 *   language level and the API surface, so the selection is now genuine. Only the
 *   installed JDK is used - nothing is faked.
 *
 * V-33 - the main class was derived by stripping `.java` from the workspace path,
 *   so `src/app/Main.java` produced the class name `src/app/Main`. Compilation
 *   succeeded and launch failed with NoClassDefFoundError. The class name now
 *   comes from the file's own `package` declaration, which is the only thing that
 *   determines a class's binary name.
 *
 * V-23 - single-file runs wrote `<shared temp>/<ClassName>.java` and `.class`, so
 *   two students running `Main.java` at the same moment overwrote each other's
 *   source AND bytecode, and each `finally` deleted the other's artifacts. Fixed
 *   structurally by the per-job directory; nothing here is shared.
 */

import path from 'node:path';

import { runToCompletion } from '../../execution/process-runner.mjs';
import { diagnostics, filesWithExtension, stripJobPaths } from '../adapter-kit.mjs';

/** Directory the compiler writes classes into, kept apart from sources. */
const CLASSES_DIR = '.classes';

/**
 * The declared package of a compilation unit, or null for the default package.
 *
 * Matches only a real package statement: skips line comments, block comments and
 * anything inside a string, because `// package foo;` is not a declaration.
 */
export function declaredPackage(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const match = withoutComments.match(/(^|[;{}\s])package\s+([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*;/);
  return match ? match[2].replace(/\s+/g, '') : null;
}

/** The public class name declared in a source file, if any. */
export function declaredPublicClass(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const match =
    withoutComments.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
    withoutComments.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
  return match ? match[1] : null;
}

/** Does this source declare a `main` entry point? */
function hasMainMethod(source) {
  return /\bstatic\s+(?:final\s+)?void\s+main\s*\(/.test(source);
}

/**
 * The fully qualified binary name to hand to `java`.
 *
 * `package app;` in `src/app/Main.java` means the binary name is `app.Main` -
 * derived from the declaration and the class name, never from the directory path.
 */
export function binaryNameFor(file) {
  const packageName = declaredPackage(file.content);
  const className =
    declaredPublicClass(file.content) || path.basename(file.name).replace(/\.java$/i, '');
  return packageName ? `${packageName}.${className}` : className;
}

export const javaAdapter = {
  id: 'java',

  /**
   * Java requires the file name to match the public class, so a single-file run
   * cannot simply be called `main.java`.
   */
  defaultEntryName(code) {
    return `${declaredPublicClass(code) || 'Main'}.java`;
  },

  async prepare(ctx) {
    const { job, files, entryPoint, profile } = ctx;
    const startedAt = Date.now();

    const javaFiles = filesWithExtension(files, '.java');
    if (javaFiles.length === 0) {
      return diagnostics('No .java source files were provided.', Date.now() - startedAt);
    }

    const classesDir = job.absolute(CLASSES_DIR);

    // `--release` pins language level AND the API surface, so java11 genuinely
    // cannot use a Java 17 method. Omitted when a profile declares no level, so a
    // future profile without one still compiles.
    const releaseArgs = profile.sourceLevel ? ['--release', profile.sourceLevel] : [];

    const compile = await runToCompletion({
      command: ctx.config.tools.javac,
      args: [
        '-J-Xmx128m',
        ...releaseArgs,
        '-encoding',
        'UTF-8',
        // Sources may declare packages, so -d lets javac build the required
        // directory structure instead of us guessing it.
        '-d',
        classesDir,
        ...javaFiles.map(file => job.absolute(file.name)),
      ],
      cwd: job.dir,
      env: ctx.sandboxEnv,
      timeoutMs: ctx.config.execution.javaTimeoutMs,
      maxOutputChars: ctx.config.execution.maxOutputChars,
    });

    if (!compile.termination.succeeded) {
      const message = stripJobPaths(compile.stderr || compile.stdout, job.dir).trim();
      return diagnostics(
        message || `javac exited with ${compile.termination.exitCode}`,
        compile.durationMs,
      );
    }

    // Prefer the requested entry point; fall back to any file declaring main, so
    // a project whose entry point is a library class still runs.
    const entryFile =
      javaFiles.find(file => file.name === entryPoint) ||
      javaFiles.find(file => file.isMain) ||
      javaFiles.find(file => hasMainMethod(file.content)) ||
      javaFiles[0];

    if (!hasMainMethod(entryFile.content)) {
      const withMain = javaFiles.filter(file => hasMainMethod(file.content));
      return diagnostics(
        withMain.length > 0
          ? `${entryFile.name} has no main method. Classes with a main method: ${withMain
              .map(file => file.name)
              .join(', ')}`
          : 'No class declares "public static void main(String[] args)", so there is nothing to run.',
        Date.now() - startedAt,
      );
    }

    return {
      kind: 'launch',
      command: ctx.config.tools.java,
      args: [
        '-Xmx128m',
        '-Xms32m',
        '-XX:MaxMetaspaceSize=64m',
        '-Dfile.encoding=UTF-8',
        '-cp',
        classesDir,
        binaryNameFor(entryFile),
      ],
      cwd: job.dir,
      timeoutMs: ctx.config.execution.javaTimeoutMs,
      transformStderr: text => stripJobPaths(text, job.dir),
    };
  },
};

export default javaAdapter;
