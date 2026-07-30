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

// Probe the exact binaries the server spawns, so availability here means the
// server can actually run that language - not merely that something with a
// similar name is on PATH.
const PROBES = {
  javascript: () => probe(process.execPath, ['--version']),
  typescript: () => probe(process.execPath, ['--version']),
  python: () => probe(process.env.PYTHON_BIN || 'python3', ['--version']),
  java: () => probe('javac', ['-version']),
  php: () => probe('php', ['--version']),
  csharp: () => probe('dotnet', ['--version']),
};

const detected = new Map();

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
