/**
 * Toolchain detection for contract tests.
 *
 * A test that cannot run because a compiler is absent must report SKIPPED with a
 * reason - never PASSED. The previous suite counted "not yet implemented" as
 * success, which is how a green run coexisted with untested languages.
 *
 * Local development machines routinely differ from the production image (this
 * repo's container has JDK 17, .NET 8, PHP 8; a Windows dev box may have JDK 8,
 * .NET 6 and no PHP at all). Detection is therefore per-tool and reported, so a
 * green local run never implies the language matrix was actually exercised.
 */

import { spawnSync } from 'node:child_process';

/**
 * A tool counts as available only when it exits 0. Requiring a successful exit
 * matters on Windows, where `python3` resolves to the Microsoft Store app-execution
 * alias: it prints an install hint and exits nonzero (49 or 9009). Accepting any
 * output would report Python as present and then fail every Python test with a
 * confusing assertion instead of an honest skip.
 */
function probe(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 20000,
      shell: false,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return null;
    // Some tools (javac -version, java -version) write the banner to stderr.
    const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Java needs BOTH halves of the toolchain, at compatible versions.
 *
 * A mixed install is common on developer machines and produces a deeply
 * confusing failure: javac 17 compiles happily, then the JRE 8 launcher rejects
 * the class file with UnsupportedClassVersionError - which looks like a bug in
 * the adapter rather than a local environment problem. Requiring the runtime's
 * major version to be at least the compiler's turns that into an honest skip.
 */
function javaToolchain() {
  const compiler = probe('javac', ['-version']);
  if (!compiler) return null;
  const runtime = probe('java', ['-version']);
  if (!runtime) return null;

  /**
   * Feature version from a JDK banner.
   *
   * Must read the QUOTED version string, or the first token of `javac X`, and
   * nothing else. Scanning the whole banner for a two-digit number is wrong,
   * because `java -version` also prints the HotSpot internal version:
   *
   *     openjdk version "1.8.0_501"
   *     OpenJDK 64-Bit Server VM (build 25.501-b09, mixed mode)
   *                                     ^^ Java 8 reports 25 here
   *
   * so a loose scan reported this host's JRE 8 as version 25, concluded it was
   * newer than its javac 21, and declared Java available - after which every Java
   * test failed with a compile or class-version error that looked like an adapter
   * bug rather than a local toolchain mismatch.
   */
  const majorOf = text => {
    const firstLine = text.split('\n')[0];
    // `java -version` / `java --version`: the version is always quoted.
    const quoted = firstLine.match(/version\s+"([^"]+)"/);
    // `javac 21.0.8`: the version is the second token.
    const bare = firstLine.match(/^javac\s+(\S+)/);
    const version = quoted?.[1] || bare?.[1];
    if (!version) return null;

    // Java 9+ is "21.0.8"; Java 8 and earlier are "1.8.0_501".
    const legacy = version.match(/^1\.(\d+)/);
    if (legacy) return Number.parseInt(legacy[1], 10);
    const modern = version.match(/^(\d+)/);
    return modern ? Number.parseInt(modern[1], 10) : null;
  };

  const compilerMajor = majorOf(compiler);
  const runtimeMajor = majorOf(runtime);

  // The runtime must be able to load what the compiler emits. A mixed install
  // (javac 17, JRE 8) compiles happily and then fails with
  // UnsupportedClassVersionError, which reads like an adapter bug.
  if (compilerMajor && runtimeMajor && runtimeMajor < compilerMajor) return null;

  // And the compiler must support the highest release the catalog advertises.
  // JDK 8's javac has no `--release` at all, so a JDK 8 host cannot verify the
  // java17 profile even though both halves are present and consistent - which is
  // exactly this authoring machine. Reporting "available" there produces a
  // compile failure that looks like a defect in the Java adapter.
  const HIGHEST_ADVERTISED_RELEASE = 17;
  if (!compilerMajor || compilerMajor < HIGHEST_ADVERTISED_RELEASE) return null;

  return `${compiler.split('\n')[0]} / ${runtime.split('\n')[0]}`;
}

// Probe the exact binaries the server spawns, so availability here means the
// server can actually run that language - not merely that something with a
// similar name is on PATH.
/**
 * C# needs an SDK that can build the framework the generated project targets.
 *
 * `dotnet --version` is not that question. A developer box with .NET 6 answers it
 * happily and then fails every C# test with NETSDK1045 - "The current .NET SDK does not
 * support targeting .NET 8.0" - which reads as a broken test rather than a missing
 * toolchain. Measured: that is exactly what this host does.
 *
 * `--list-sdks` prints one line per installed SDK, so the real question is whether any
 * of them is new enough. Kept in step with `TARGET_FRAMEWORK` in the C# adapter.
 */
const CSHARP_MINIMUM_SDK_MAJOR = 8;

function dotnetToolchain() {
  const listed = probe(process.env.DOTNET_BIN || 'dotnet', ['--list-sdks']);
  if (!listed) return null;

  const newest = Math.max(
    0,
    ...listed
      .split(/\r?\n/)
      .map(line => Number.parseInt(/^(\d+)\./.exec(line.trim())?.[1] ?? '', 10))
      .filter(Number.isFinite),
  );

  return newest >= CSHARP_MINIMUM_SDK_MAJOR ? listed : null;
}

const PROBES = {
  javascript: () => probe(process.execPath, ['--version']),
  typescript: () => probe(process.execPath, ['--version']),
  python: () => probe(process.env.PYTHON_BIN || 'python3', ['--version']),
  java: javaToolchain,
  php: () => probe(process.env.PHP_BIN || 'php', ['--version']),
  csharp: dotnetToolchain,
};

const detected = new Map();

/**
 * Trivial program per language, used to ask a REMOTE server what it can run.
 *
 * When the suite targets a container, probing local binaries answers the wrong
 * question entirely: the host's PATH says nothing about what is installed in the
 * image. Availability is therefore established by actually executing something
 * and checking it produced the expected output - a stronger signal than a version
 * banner, because it exercises the compiler, the runtime, the sandbox environment
 * and the adapter together.
 */
const REMOTE_PROBES = {
  javascript: { version: 'es2022', code: 'console.log("probe-ok")' },
  typescript: { version: 'ts5', code: 'const s: string = "probe-ok";\nconsole.log(s)' },
  python: { version: 'python3', code: 'print("probe-ok")' },
  java: {
    version: 'java17',
    code: 'public class Main { public static void main(String[] a){ System.out.println("probe-ok"); } }',
  },
  php: { version: 'php8', code: '<?php echo "probe-ok";' },
  csharp: { version: 'csharp12', code: 'System.Console.WriteLine("probe-ok");' },
};

/** Probe a remote server once per language, in parallel. */
export async function detectRemoteToolchains(baseUrl) {
  const target = baseUrl.replace(/\/+$/, '');

  const results = await Promise.all(
    Object.entries(REMOTE_PROBES).map(async ([languageId, probeSpec]) => {
      try {
        const response = await fetch(`${target}/api/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: languageId, ...probeSpec }),
          // Generous: a cold C# or Java image pays for a first restore/build.
          signal: AbortSignal.timeout(300000),
        });
        const body = await response.json();
        const ok = body?.exitCode === 0 && String(body?.stdout || '').includes('probe-ok');
        return [
          languageId,
          ok ? `verified by execution on the target (${body.resolvedVersion?.resolved || probeSpec.version})` : null,
          ok ? null : `exit=${body?.exitCode} stderr=${String(body?.stderr || '').slice(0, 220)}`,
        ];
      } catch (error) {
        return [languageId, null, error.message];
      }
    }),
  );

  for (const [languageId, value, reason] of results) {
    detected.set(languageId, value);
    process.stderr.write(
      value
        ? `  probe ${languageId.padEnd(11)} OK\n`
        : `  probe ${languageId.padEnd(11)} FAILED: ${reason}\n`,
    );
  }
}

// Top-level await, deliberately. node:test needs the skip decision at the moment a
// test is DECLARED, during module evaluation - before any before() hook runs. This
// is the only point at which the answer is available in time. Each test file is
// its own process under `node --test`, so this runs once per file.
if (process.env.CONTRACT_TARGET_URL) {
  process.stderr.write('\nProbing target server for language support...\n');
  await detectRemoteToolchains(process.env.CONTRACT_TARGET_URL);
}

/** Version banner for a language's toolchain, or null when it is unavailable. */
export function toolchainVersion(languageId) {
  if (!detected.has(languageId)) {
    const runProbe = PROBES[languageId];
    detected.set(languageId, runProbe ? runProbe() : null);
  }
  return detected.get(languageId);
}

export function hasToolchain(languageId) {
  return toolchainVersion(languageId) !== null;
}

/**
 * Returns node:test options that skip the test with an explicit reason when the
 * toolchain is missing. Use as:
 *
 *   test('python prints', requires('python'), async () => { ... })
 */
export function requires(languageId) {
  if (hasToolchain(languageId)) return {};
  return {
    skip: `${languageId} toolchain unavailable on this host - execution NOT verified`,
  };
}

/**
 * Can this language actually be DEBUGGED here?
 *
 * A separate question from whether it runs, and for three languages the answer
 * differs. Java needs a matching javac/java pair; PHP needs Xdebug, which is a
 * compiled extension rather than a binary on a PATH; C# needs both a .NET SDK that
 * can build the target framework AND a musl-capable debugger that is not packaged
 * anywhere and only exists in the runtime image.
 *
 * Without this, `requires('csharp')` passed on a development host with .NET 6 and no
 * debugger, and the debug test then failed rather than skipping - which trains people
 * to ignore a red suite. The image has all of it and runs every one of these.
 */
const DEBUGGER_PROBES = {
  java: () => hasToolchain('java'),
  javascript: () => hasToolchain('javascript'),
  typescript: () => hasToolchain('typescript'),
  python: () => hasToolchain('python'),
  php: () =>
    probe(process.env.PHP_BIN || 'php', [
      '-dzend_extension=xdebug',
      '-r',
      'echo extension_loaded("xdebug") ? "ok" : "";',
    ]) !== null,
  csharp: () => {
    if (!hasToolchain('csharp')) return false;
    for (const candidate of [process.env.DOTNET_DEBUGGER_BIN, '/opt/dncdbg/dncdbg', 'dncdbg']) {
      if (candidate && probe(candidate, ['--version'])) return true;
    }
    return false;
  },
};

const debuggerDetected = new Map();

export function hasDebugger(languageId) {
  if (debuggerDetected.has(languageId)) return debuggerDetected.get(languageId);
  const check = DEBUGGER_PROBES[languageId];
  const answer = check ? check() === true : false;
  debuggerDetected.set(languageId, answer);
  return answer;
}

/** Like `requires`, but for a test that needs the language's DEBUGGER. */
export function requiresDebugger(languageId) {
  if (hasDebugger(languageId)) return {};
  return {
    skip: `${languageId} debugger unavailable on this host - debugging NOT verified`,
  };
}

export function toolchainReport() {
  const lines = [];
  for (const id of Object.keys(PROBES)) {
    const version = toolchainVersion(id);
    lines.push(
      version
        ? `  ${id.padEnd(11)} available  (${version.split('\n')[0]})`
        : `  ${id.padEnd(11)} MISSING    - language execution tests will be skipped`,
    );
  }
  return lines.join('\n');
}
