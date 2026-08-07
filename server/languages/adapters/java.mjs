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
import { fileURLToPath } from 'node:url';

import { runToCompletion } from '../../execution/process-runner.mjs';
import { diagnostics, filesWithExtension, stripJobPaths } from '../adapter-kit.mjs';

/** Directory the compiler writes classes into, kept apart from sources. */
const CLASSES_DIR = '.classes';

/** Where the JDWP debug adapter lives in the image, next to the language's other files. */
export const JAVA_ADAPTER_DIR = fileURLToPath(new URL('../../../languages/java/', import.meta.url));

/** Environment the debug adapter reads to know what to launch and how. */
export const JAVA_MAIN_ENV = 'BROWSER_CODER_JAVA_MAIN';
export const JAVA_CLASSPATH_ENV = 'BROWSER_CODER_JAVA_CLASSPATH';
export const JAVA_BIN_ENV = 'BROWSER_CODER_JAVA_BIN';

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

  /**
   * Java can be debugged.
   *
   * Through JDWP, the JVM's own debug protocol, spoken by a client written for this
   * project - see languages/java/jdwp.mjs for the wire format and
   * languages/java/debug_adapter.mjs for why a supervising process rather than an
   * in-process hook. No JDI, no jdb, no third-party dependency.
   */
  supportsDebug: true,

  async prepare(ctx) {
    const { job, files, entryPoint, profile } = ctx;
    const startedAt = Date.now();
    const debugging = ctx.debug?.enabled === true;

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
        // javac's default is `-g:source,lines`: enough to name a line in a stack
        // trace, NOT enough to name a local variable. Without the full `-g` the
        // debugger stops on the right line and then reports no locals at all,
        // because there is no LocalVariableTable to read them from.
        ...(debugging ? ['-g'] : []),
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

    const mainClass = binaryNameFor(entryFile);

    /*
     * A debug run launches Node, not Java.
     *
     * The debug adapter is the process the pipeline supervises; it spawns the JVM
     * itself with `-agentlib:jdwp=...,suspend=y` and attaches. That indirection is
     * unavoidable - JDWP is a socket protocol, so somebody has to be on the other end
     * of the socket, and it cannot be the JVM under test.
     *
     * It is safe because the run pipeline kills the process GROUP, so the grandchild
     * JVM dies with its supervisor rather than outliving the job.
     */
    if (debugging) {
      return {
        kind: 'launch',
        command: ctx.config.tools.node,
        args: ['--no-warnings', path.join(JAVA_ADAPTER_DIR, 'debug_adapter.mjs')],
        cwd: job.dir,
        timeoutMs: ctx.config.execution.javaTimeoutMs,
        extraEnv: {
          [JAVA_MAIN_ENV]: mainClass,
          [JAVA_CLASSPATH_ENV]: classesDir,
          [JAVA_BIN_ENV]: ctx.config.tools.java,
        },
        transformStderr: text => stripJobPaths(text, job.dir),
      };
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
        mainClass,
      ],
      cwd: job.dir,
      timeoutMs: ctx.config.execution.javaTimeoutMs,
      transformStderr: text => stripJobPaths(text, job.dir),
    };
  },
};

export default javaAdapter;
